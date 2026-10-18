# Tech stack: Nemotron Lightning × Brev + vLLM × tool calling

How *Escape from Red Hat* uses each piece of the stack, what we have measured, and the cheapest next steps that would strengthen the evidence. Every number below links to a results file in this repo. Anything we have not measured is marked **planned**. Anything we could not verify in sources is marked **[UNVERIFIED]**.

## 1. What runs where

```
Browser (React + Canvas) ──WebSocket──▶ Node 24 server (laptop)
                                         ├─ engine: pure TS, seeded, authoritative world + tool validator
                                         └─ orchestrator: wake → planner view → decide → validate → execute → trace
                                                   │  OpenAI-compatible chat.completions + tools
                                                   ▼
                                         brev port-forward escape-nemotron --port 8001:8000
                                                   ▼
                                         Brev VM: 1× H100 80GB HBM3
                                         └─ vLLM 0.27.1 (docker) ─▶ Nemotron 3.5 Lightning 30B-A3B (BF16)
```

- **One generative model.** Nemotron 3.5 Lightning has 30B total parameters, within the 33B cap. There is no draft, critic or router model: scoring and validation are deterministic engine code.
- **Keys stay on the server.** The browser never talks to vLLM.

## 2. Nemotron 3.5 Lightning 30B-A3B: the central planner

**Its job.** On every decision the model receives a compact *planner view*: what each person has seen or been told, who is busy, and the recent results. It returns **one native tool call for one named person** (Alex, Maya, Daniel, Rosa or Kenji). The engine validates the call against true world state. Invalid calls change nothing and come back as a structured error with a hint.

**Why it fits:**
- **Small and fast.** The MoE hybrid of Mamba-2, MoE and attention layers has only 3B parameters active per token, so a central decision takes about 0.7 s on one H100. That is fast enough for a live scene with spreading fire ([model card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16)).
- **Native tool calls.** The output is parsed by vLLM's `qwen3_coder` parser, and the card says the model was trained for "multi-step tool use … and structured output environments".
- **Thinking off.** Per-request `chat_template_kwargs.enable_thinking=false` keeps latency low.

**An honest stretch.** NVIDIA positions Lightning as the *execution layer*: frontier models plan, Lightning executes ([NVIDIA blog](https://developer.nvidia.com/blog/nvidia-nemotron-3-5-lightning-delivers-fast-accurate-specialized-task-execution-for-long-running-agents)). We deliberately stretch it into a real-time planner, and we back that with a held-out benchmark rather than vendor claims. The card's own table shows Qwen 3.6 35B-A3B ahead on most agentic rows, so we do **not** claim Lightning is the best tool-caller.

**How we optimise it (harness v2, all in [`apps/server/src/prompt.ts`](../apps/server/src/prompt.ts)):**
- **A short state digest at the top of every prompt:** who is urgent near known fire, who is waiting, who can hear whom, hazards, alarm status, open items.
- **Per-turn action masking:** each tool's `actor_id` enum lists only people who can act now, for example `pull_alarm` only when standing at the station.
- **Recovery feedback:** every error code carries an actionable hint, and the next prompt tells the model "your last call was rejected — don't repeat it".
- **Wake on news:** the planner is called only when something new happened, not every tick.

**Measured** (one run per case, concurrency 4, thinking off, held-out test split; v1 is the baseline harness):

| Ruleset | Harness | Verified success (normal cases) | Invalid-call rate | Decisions / episode | p50 / p95 decision latency | Source |
|---|---|---|---|---|---|---|
| **Current: office-v2 ground floor, five people** (ruleset 3 rules, decision cap 100) | v1 | 9/14 (57/80 people out) | 42.2% | 82.7 | 726 / 1116 ms | [test-v1](../results/2026-10-18-office-v2-vllm-h100/test-v1/summary.md) |
| office-v2 | **v2** | **13/14 (77/80 people out)** | 32.6% | **29.9** | 730 / 1078 ms | [test-v2](../results/2026-10-18-office-v2-vllm-h100/test-v2/summary.md) |
| office-v2, per-agent (reasoning ≤128 tokens, concurrency 1) | — | 12/14 (76/80 people out) | 11.7% | 61.1 | 1080 / 2067 ms | [agents-test](../results/2026-10-18-office-v2-vllm-h100/agents-test/summary.md) |
| 1: static fire + blocker | v1 | 5/14 | 26.8% | 38.2 | 668 / 1002 ms | [test-v1](../results/2026-10-17-vllm-h100/test-v1/summary.md) |
| 1 | **v2** | **12/14** | **9.6%** | **28.0** | 670 / 1148 ms | [test-v2](../results/2026-10-17-vllm-h100/test-v2/summary.md) |
| 2: spreading fire, doors, alarm | v1 | 6/14 (26/48 people out) | 33.5% | 51.0 | 709 / 1147 ms | [test-v1](../results/2026-10-17-ruleset2-vllm-h100/test-v1/summary.md) |
| 2 | **v2** | **9/14 (33/48 people out)** | 41.4% | **29.1** | 649 / 1219 ms | [test-v2](../results/2026-10-17-ruleset2-vllm-h100/test-v2/summary.md) |
| 3 (office-v1, three people; history): + room-limited voice, one hallway alarm, instincts, burning walls | v1 | 6/14 (23/48 people out) | 50.9% | 54.1 | 713 / 1117 ms | [test-v1](../results/2026-10-17-ruleset3-vllm-h100/test-v1/summary.md) |
| 3 | **v2** | **11/14 (37/48 people out)** | 51.9% | **24.1** | 720 / 1174 ms | [test-v2](../results/2026-10-17-ruleset3-vllm-h100/test-v2/summary.md) |

- **No false successes.** No harness or mode ever produced a false success on the trapped-by-design cases.
- **Zero provider errors** in every saved benchmark run, and zero malformed responses from the central planner. Per-agent mode had 31 malformed responses in about 1,740 decisions (office-v2 dev + test), each followed by a fresh decision.
- **office-v2 is the current game** (rows 1–3; older rows are history, measured with three people and a slower fire). Baseline → v2: 9/14 → 13/14, people lost on normal cases 3 → 1, about a third of the decisions, and the alarm pulled 17.1 s after the first sighting instead of 30.0 s ([per-case comparison](../results/2026-10-18-office-v2-vllm-h100/compare-test-v1-vs-v2.md)). Dev split: v2 15/15, per-agent 15/15.
- **Ruleset 3 on office-v1 (history).** The high invalid-call rate there is mostly people retrying routes that fire or a dead door had already cut, plus re-entry attempts the engine refuses. v2 needs less than half the decisions and repeats a rejected call a third as often (63 vs 184). The README's Results section carries the latest numbers.

### Per-agent mode: each person reasons for themselves (`PLANNER_MODE=agents`)

Instead of one planner directing everyone, each of the five people gets **their own Nemotron call with reasoning on** ([`apps/server/src/agentPrompt.ts`](../apps/server/src/agentPrompt.ts)).
- **Personal view only** (`engine.agentView`): what *that* person has seen, been told, or can hear in their room, plus the siren — never anyone else's private knowledge.
- **No hard-coded instincts.** The engine's shout / back-away / pull-in-passing / no-re-entry rules are switched off (`EngineOptions.instincts=false`). Each person's prompt makes them responsible for those things instead: get away from fire, raise the alarm if you know of a fire and haven't heard the siren, warn your room, don't go back in.
- **Parallel decisions, actor pinned.** Everyone who is ready decides at once (headless: asked in parallel, applied in a fixed order for determinism); a call is always executed for the person who made it. The trace shows `Nemotron → Maya (own decision) → move` and a collapsible "thinking" block with the model's reasoning.
- **Reasoning cap.** Decision latency is almost all reasoning decode, so each call sends vLLM's `thinking_token_budget` (default 128 tokens, `PLANNER_AGENT_THINKING_BUDGET`; `0` = uncapped): vLLM ends the thinking at the budget and the model then writes its tool call. In about 3% of calls the model keeps reasoning in the visible reply after the cap (up to ~1,100 completion tokens); the tool call still parses.
- **Measured, reasoning capped at 128 tokens** (office-v2, one run per case, concurrency 1): test 12/14 normal successes, 0/2 false successes, 76/80 people out, 11.7% invalid calls, 61.1 decisions per episode, decision p50 / p95 1080 / 2067 ms; dev 15/15. Sources: [agents-test](../results/2026-10-18-office-v2-vllm-h100/agents-test/summary.md), [agents-dev](../results/2026-10-18-office-v2-vllm-h100/agents-dev/summary.md).
- **History, reasoning uncapped (office-v1, not a benchmark):** reasoning p50 2.5–3.4 s, p95 12.5–15 s per decision (~640 completion tokens, p95 ~2,900). Headless hero 2/2 verified success. With the clock running during inference people stood still for seconds next to fire (one live run: 0/3 escaped), so agents mode **holds the sim clock while anyone is thinking** by default. Prompt + 4k of thinking can exceed the 8k context; the digest drops the raw JSON and the provider retries a context-length 400 with the output budget that fits.

## 3. Brev + vLLM: the serving layer

**Exact command.** See [`deploy/vllm/serve.sh`](../deploy/vllm/serve.sh). The image is `vllm/vllm-openai:v0.27.1`, digest `sha256:0a51ea5b…`.

| Flag | Why |
|---|---|
| `--tool-call-parser qwen3_coder --enable-auto-tool-choice` | Turns Nemotron's XML tool calls into OpenAI `tool_calls`, as in the card recipe. We send `tool_choice: auto` |
| `--reasoning-parser nemotron_v3` | Separates reasoning from content when thinking is on (A/B option) |
| `--max-model-len 8192`, `--max-num-batched-tokens 8192` | Central v2 prompts are about 5.2–5.4K tokens median and at most 6.4K on the five-person ground floor (system plus tools plus view); per-agent prompts about 3.2K. The card's 256K context isn't needed, but the central planner's 1,024-token output budget leaves under 1K of headroom |
| `--max-num-seqs 8` | Five people can decide in parallel in agents mode, so all five requests fit in one batch; still small next to 58.9 GiB of BF16 weights |
| `--enable-prefix-caching` | The system prompt and the 10 tool schemas are a stable shared prefix on every call |
| `--async-scheduling`, `--mamba-*` flags | Taken from the card's single-H100 recipe, including the FP16 Mamba SSM cache |
| `--api-key`, `-p 127.0.0.1:8000` | Private: the server is reachable only through `brev port-forward` |

**Measured throughput and latency** (ruleset 1, dev split, harness v2, same server):

| Concurrent episodes | Episodes / min | Decision p50 / p95 | Source |
|---|---|---|---|
| 1 | 5.66 | 462 / 625 ms | [dev-v2-c1](../results/2026-10-17-vllm-h100/dev-v2-c1/summary.md) |
| 4 | **13.81** (2.4×) | 585 / 1043 ms | [dev-v2](../results/2026-10-17-vllm-h100/dev-v2/summary.md) |

vLLM batching of concurrent rollouts gives 2.4× the episode throughput, for about 120 ms on the median decision.

**Why BF16.** The card calls BF16 the customization checkpoint and recommends NVFP4 for production serving ([NVFP4 card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4)). We served BF16 for fidelity while tuning the harness. The NVFP4 A/B on the same H100 is **planned**.

**Why upstream vLLM.** Red Hat AI Inference 3.5.1 packages vLLM 0.24.0, but this model needs at least 0.27.1.

## 4. Tool calling

| Tool | One line |
|---|---|
| `observe` | Look around; may create evidence of what is seen |
| `consult_plan` | Read a section of the fictional emergency plan, with source-linked rule cards |
| `notify` | Speak: reaches only people in the same room; must cite evidence the speaker knows |
| `plan_route` | Route using only what that person knows; never sees unknown hazards |
| `move` | Start moving, either auto-planned or from a `route_id`; stops safely when a hazard is discovered |
| `pull_alarm` | At a pull station (main hallway or reception): alerts everyone and says nothing about where the fire is |
| `request_assistance` | Daniel asks Alex for help (consent) |
| `assist` | Alex links with Daniel once next to him; they move together on accessible tiles |
| `check_in` | Counts only when physically inside the assembly area |
| `verify_roster` | Warden only; the **only** way an episode can succeed |

**Model proposes, engine decides.** The model never mutates the world directly. Every call passes:
1. strict JSON Schemas with `additionalProperties:false`;
2. **zod** validation;
3. engine checks against canonical state.

Rejections come back as observations: `INVALID_ARGUMENT`, `UNKNOWN_EVIDENCE`, `ROUTE_UNAVAILABLE`, `STALE_STATE`, `ACTOR_BUSY`, `OUT_OF_RANGE`, `ASSISTANCE_NOT_ACCEPTED`, `NOT_AUTHORIZED`. Game and simulation agents use the same pattern ([RPG-MCP](https://glama.ai/mcp/servers/@Mnehmos/rpg-mcp/blob/ea933ed6a4b58565dd0d6f34b777961f0509410e/README.md), [llmgine](https://aiagentssimplified.substack.com/p/what-agentic-actually-costs-to-wire)).

**Honest trace.** Every proposal is shown, including rejected, malformed and stale-discarded ones. Recoveries carry a ↻ badge. People's survival instincts (shouting "Fire!" to their room, backing away from flames, pulling the alarm as they pass it) are **engine rules labelled "instinct"**, never attributed to the model.

**How our scenarios map onto BFCL categories** ([BFCL v3](https://gorilla.cs.berkeley.edu/blogs/13_bfcl_v3_multi_turn.html), [category definitions](https://evalscope.readthedocs.io/en/latest/benchmarks/bfcl_v3.html)) and onto τ-bench reliability ([τ-bench](https://arxiv.org/abs/2406.12045)):

| Category | In our game | Status |
|---|---|---|
| simple / multiple | Choosing among 10 tools for one named person each turn | ✓ covered |
| multi-turn recovery | Dead door, then `ROUTE_UNAVAILABLE`, then re-plan; a rejected call, then a corrected one | ✓ measured (recoveries, re-plans) |
| missing knowledge or parameter | Must cite evidence the speaker actually knows; unalerted people can't evacuate | ✓ engine-enforced |
| missing function | Masking removes tools that aren't applicable this turn | ◐ partial |
| parallel | One call per person in one turn; extra calls are logged as "ignored" today | ○ planned |
| irrelevance / abstain | Distractor messages or non-emergencies where the right answer is no evacuation | ○ planned |
| long context | Each decision is a fresh, compact prompt by design | ○ planned stress test |
| reliability (pass^k) | Repeat each case k times | ○ planned |

## 5. Winning patterns, and where we stand

| Pattern | Evidence | Us |
|---|---|---|
| Numbers beat polish: quantitative evaluation won the Nemotron hackathon | [Nota AI](https://blog.nota.ai/insights/nemotron-hackathon-winner) | ✓ held-out v1-vs-v2 tables |
| Deep, *visible* use of the sponsor stack is a scored axis | [LangChain contest](https://www.nvidia.com/en-us/ai-data-science/generative-ai/developer-contest-with-langchain/), [LlamaIndex contest](https://developer.nvidia.com/llamaindex-developer-contest) | ✓ self-hosted vLLM; the top bar shows provider and p50 |
| Error recovery is rewarded | [NeMo Agent Toolkit winners](https://developer.nvidia.com/blog/hackathon-winners-bring-agentic-ai-to-life-with-the-nvidia-nemo-agent-toolkit/), [Emergence rubric](https://github.com/advik-bhatt/emergence-hackathon-info/blob/main/devpost-enterprise-agents-hackathon.md) | ✓ hints, recoveries, re-plans |
| Judge by final state, not just the transcript | [BFCL v3](https://gorilla.cs.berkeley.edu/blogs/13_bfcl_v3_multi_turn.html) | ✓ success only via verified roster and engine state |
| Model proposes, engine decides | RPG-MCP, llmgine (above) | ✓ core architecture |
| Publish a held-out before/after with artifacts | [Sommelier](https://abdelstark-sommelier.static.hf.space/index.html) | ✓ summaries plus replayable run logs |
| Report reliability (pass^k), not one best run | [τ-bench](https://arxiv.org/abs/2406.12045), [r/LocalLLaMA thread](https://reddit.sentinel-team.org/posts/1uuxsdl/snapshots/2026-07-17T18%3A53%3A30.39359Z) | ○ one run per case today |
| Attribute failures to causes | [Toolhound](https://reddit.sentinel-team.org/posts/1um8dbk/snapshots/2026-07-03T19%3A50%3A30.28358Z), [sub-2B study](https://arxiv.org/abs/2609.07370) | ◐ error codes counted; no histogram yet |
| Prefix-cache economics are the vLLM agent story | [llm-d](https://llm-d.ai/blog/kvcache-wins-you-can-see), [Red Hat talk](https://www.ai.engineer/talks/YXowceUKYJI-kv-cache-aware-routing-p-d-disaggregation) | ◐ caching on; hit rate not measured yet |
| Benchmark a concurrency sweep against SLOs | [Red Hat Developer](https://developers.redhat.com/articles/2026/03/03/practical-strategies-vllm-performance-tuning) | ◐ 1 vs 4 measured |
| One-click reproducibility | [Brev Launchables](https://docs.nvidia.com/brev/latest/concepts/launchables.md) | ○ planned |
| Honest small-model fit | [Build Small](https://huggingface.co/organizations/build-small-hackathon) | ✓ 3B active, one GPU, sub-second decisions |

## 6. Cheap, extendable opportunities (ranked by effort)

| # | Extension | Effort | Evidence it would produce |
|---|---|---|---|
| 1 | **Prefix-cache panel**: scrape `/metrics` before and after a bench; report `vllm:prefix_cache_hits / vllm:prefix_cache_queries` with TTFT ([metrics](https://docs.vllm.ai/en/latest/design/metrics.html)). Caveat: hybrid Mamba models resume cache only at block boundaries ([APC docs](https://docs.vllm.ai/en/latest/features/automatic_prefix_caching.html)) | 30 min (`deploy/vllm/measure.sh` already snapshots `/metrics`) | Hit rate, TTFT with vs without `--enable-prefix-caching` |
| 2 | **Reasoning on/off A/B** on the held-out split (`--thinking on`) | 30 min | Success, invalid rate, tokens and latency per decision |
| 3 | **pass^k**: k = 4 repeats per test case | 1 h of GPU | Reliability rather than a best single run |
| 4 | **Failure-cause histogram**: parse / schema / engine-rejected / wrong-decision / recovered | 1 h (data is already in run logs) | Shows which failures are the model's and which are the harness's |
| 5 | **Concurrency sweep** at 1/8/32 headless buildings (raise `--max-num-seqs`); optionally GuideLLM ([guide](https://lucaberton.com/blog/guidellm-vllm-benchmark-slo-kubernetes/)) | 1–2 h | Episodes/min and P95 decision latency curve |
| 6 | **Parallel tool calls**: one call per person per turn | 2 h (engine already validates each call independently) | Fewer turns per episode; a BFCL "parallel" category |
| 7 | **BF16 vs NVFP4** on the same H100 | 1 h plus a restart | Same-accuracy / higher-throughput row (the card shows about 2 points on PinchBench; Hopper throughput **[UNVERIFIED]**) |
| 8 | **Constrained-decoding ladder**: on a rejected call, retry with a named `tool_choice` or strict schema; count how often each rung fires | 2 h | Recovery-rate gain. vLLM guarantees *parseable* calls, not *good* ones ([tool calling docs](https://docs.vllm.ai/en/latest/features/tool_calling.html)) |
| 9 | **Speculative decoding**: built-in MTP vs none at low and high concurrency; acceptance rate from `vllm:spec_decode_*` ([spec metrics](https://docs.vllm.ai/en/stable/api/vllm/v1/spec_decode/metrics/)). A DSpark draft would add parameters (size **[UNVERIFIED]**) against the 33B cap | 2 h | Latency at concurrency 1 vs 32 |
| 10 | **LoRA per harness**: v1/v2 as adapters on one server (`NemotronHForCausalLM` is listed as LoRA-capable, [supported models](https://docs.vllm.ai/en/latest/models/supported_models.html); Lightning in 0.27.1 **[UNVERIFIED]**) | half a day | Multi-adapter serving demo |
| 11 | **Brev Launchable**: one-click VM with `serve.sh` and a public repo; no secrets in the image or logs | 1 h | "Launch on Brev" badge; judges can reproduce |
| 12 | **Customer floor-plan import**: the ASCII-to-JSON map builder is the extension point | 1 day | The product story beyond the hackathon office |

## 7. Pitfalls we avoid

- **No over-claiming.** Lightning isn't presented as the strongest tool-caller, and vendor speed figures are quoted as vendor figures ([OpenRouter note](https://openrouter.ai/blog/insights/nemotron-3-5-lightning/)).
- **Validity ≠ quality.** Parseable JSON is not a good decision; our score is the engine's end state. Format constraints can affect reasoning ([study](https://arxiv.org/abs/2408.02442), [counterpoint](https://blog.dottxt.ai/say-what-you-mean.html)).
- **Harness bugs are not model failures.** The parser and image are pinned, raw responses are logged per decision, and scripted mode is labelled "not a model".
- **No cherry-picking.** Held-out split, one run per case disclosed, and dev used only for tuning.
- **BF16 is justified,** and NVFP4 is listed as a next step.
- **No secrets** in the repo, run logs or any future Launchable. Keys live only in `.env` and on the VM.
- **Narration.** The trace shows what the agent did and why, and instinct versus model is always labelled ([Docker's tool-calling evaluation](https://www.docker.com/blog/local-llm-tool-calling-a-practical-evaluation/) lists the usual small-model failures we test for).

## Sources

The model cards, NVIDIA and vLLM docs, contest pages and community posts are linked inline above. Facts we could not confirm are marked **[UNVERIFIED]**. Unmeasured items are **planned**.
