# Tech stack: Nemotron Lightning × Brev + vLLM × tool calling

How *Escape from Red Hat* uses each piece of the stack, what we have measured, and the cheapest next steps that would strengthen the evidence. Every number below links to a results file in this repo. Anything we have not measured is marked **planned**. Anything we could not verify in sources is marked **[UNVERIFIED]**.

## 1. What runs where

```
Browser (React + Canvas) ──WebSocket──▶ Node 24 server (laptop)
                                         ├─ engine: pure TS, seeded, authoritative world + tool validator
                                         └─ orchestrator: wake a person → their own view → decide → validate → execute → trace
                                                   │  OpenAI-compatible chat.completions + tools
                                                   ▼
                                         brev port-forward escape-nemotron --port 8001:8000
                                                   ▼
                                         Brev VM: 1× H100 80GB HBM3
                                         └─ vLLM 0.27.1 (docker) ─▶ Nemotron 3.5 Lightning 30B-A3B (BF16)
```

- **One generative model.** Nemotron 3.5 Lightning has 30B total parameters, within the 33B cap. There is no draft, critic or router model: scoring and validation are deterministic engine code.
- **Keys stay on the server.** The browser never talks to vLLM.

## 2. Nemotron 3.5 Lightning 30B-A3B: one call per person

**Its job.** Each of the five people (Alex, Maya, Daniel, Rosa, Kenji) is a separate Nemotron agent ([`apps/server/src/agentPrompt.ts`](../apps/server/src/agentPrompt.ts)). When a person notices something new, they get a first-person prompt with only what they know and return **one native tool call for themselves**. The engine validates the call against true world state. Invalid calls change nothing and come back as a structured error with a hint.

**Why it fits:**
- **Small and fast.** The MoE hybrid of Mamba-2, MoE and attention layers has only 3B parameters active per token, so a decision with capped reasoning takes about 1.1 s on one H100, and five people deciding at once share one batch ([model card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16)).
- **Native tool calls.** The output is parsed by vLLM's `qwen3_coder` parser, and the card says the model was trained for "multi-step tool use … and structured output environments".
- **Short, capped reasoning.** Reasoning is on, and each call sends vLLM's `thinking_token_budget` (128 tokens by default, `PLANNER_AGENT_THINKING_BUDGET`): vLLM ends the thinking at the budget and the model writes its tool call. In about 3% of calls the model keeps reasoning in the visible reply after the cap (up to about 1,100 completion tokens); the tool call still parses.

**An honest stretch.** NVIDIA positions Lightning as the *execution layer*: frontier models plan, Lightning executes ([NVIDIA blog](https://developer.nvidia.com/blog/nvidia-nemotron-3-5-lightning-delivers-fast-accurate-specialized-task-execution-for-long-running-agents)). We stretch it into five real-time decision-makers, and we back that with a held-out benchmark rather than vendor claims. The card's own table shows Qwen 3.6 35B-A3B ahead on most agentic rows, so we do **not** claim Lightning is the best tool-caller.

**How it works:**
- **Personal view only** (`engine.agentView`): what *that* person has seen, been told, or can hear in their room, plus the siren. Never anyone else's private knowledge.
- **No hard-coded reflexes** (`EngineOptions.instincts=false`). Each person's prompt makes them responsible for getting away from fire, raising the alarm if they know of a fire and have not heard the siren, warning their room and not going back in.
- **Parallel decisions, actor pinned.** Everyone who is ready decides at once (headless: asked in parallel, applied in a fixed order for determinism), and a call is always executed for the person who made it. The trace shows `Nemotron → Maya (own decision) → move` with a collapsible block of the model's reasoning.
- **Recovery feedback and wake on news.** Every error code carries an actionable hint, and a person is called again only when something new happened to them.

**Measured** (office-v2 ground floor, five people, one run per case, temperature 0.6, concurrency 1):

| Split | Everyone out, normal cases | False success, trapped cases | People out | Invalid calls | Decisions per run | p50 / p95 decision latency | Source |
|---|---|---|---|---|---|---|---|
| **Test (held out)** | **12/14** | **0/2** | **76/80** | 11.7% | 61.1 | 1080 / 2067 ms | [agents-test](../results/2026-10-18-office-v2-vllm-h100/agents-test/summary.md) |
| Dev | 15/15 | 0/1 | 79/80 | 10.1% | 47.9 | 1135 / 2067 ms | [agents-dev](../results/2026-10-18-office-v2-vllm-h100/agents-dev/summary.md) |

- **No false successes** on the trapped-by-design cases, and **zero provider errors**. 31 malformed replies in about 1,740 decisions, each followed by a fresh decision.
- **The alarm was pulled in every run**, on average 18.7 s (test) and 10.7 s (dev) after the fire was first seen.
- **The sim clock is held while anyone thinks** by default. In an early live run with uncapped reasoning and the clock running, people stood still for seconds next to the fire and nobody escaped. The backup replay [`runs/demo-hero.jsonl`](../runs/demo-hero.jsonl) is a live run with the 128-token cap and the clock running in which everyone got out.

## 3. Brev + vLLM: the serving layer

**Exact command.** See [`deploy/vllm/serve.sh`](../deploy/vllm/serve.sh). The image is `vllm/vllm-openai:v0.27.1`, digest `sha256:0a51ea5b…`.

| Flag | Why |
|---|---|
| `--tool-call-parser qwen3_coder --enable-auto-tool-choice` | Turns Nemotron's XML tool calls into OpenAI `tool_calls`, as in the card recipe. We send `tool_choice: auto` |
| `--reasoning-parser nemotron_v3` | Separates each person's reasoning (capped at 128 tokens) from their tool call |
| `--max-model-len 8192`, `--max-num-batched-tokens 8192` | A person's prompt is about 3.2K tokens (median) and at most 3.8K (system plus tools plus their view), plus up to 128 reasoning tokens and the reply; the card's 256K context isn't needed |
| `--max-num-seqs 8` | All five people can decide in parallel, so their requests fit in one batch; still small next to 58.9 GiB of BF16 weights |
| `--enable-prefix-caching` | The system prompt and the 10 tool schemas are a stable shared prefix on every call |
| `--async-scheduling`, `--mamba-*` flags | Taken from the card's single-H100 recipe, including the FP16 Mamba SSM cache |
| `--api-key`, `-p 127.0.0.1:8000` | Private: the server is reachable only through `brev port-forward` |

**Why BF16.** The card calls BF16 the customization checkpoint and recommends NVFP4 for production serving ([NVFP4 card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4)). We served BF16 for fidelity while developing the agents. The NVFP4 A/B on the same H100 is **planned**.

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

**Honest trace.** Every proposal is shown, including rejected, malformed and stale-discarded ones, each attributed to the person who made it. Recoveries carry a ↻ badge.

**How our scenarios map onto BFCL categories** ([BFCL v3](https://gorilla.cs.berkeley.edu/blogs/13_bfcl_v3_multi_turn.html), [category definitions](https://evalscope.readthedocs.io/en/latest/benchmarks/bfcl_v3.html)) and onto τ-bench reliability ([τ-bench](https://arxiv.org/abs/2406.12045)):

| Category | In our game | Status |
|---|---|---|
| simple / multiple | Each person chooses among 10 tools for themselves each turn | ✓ covered |
| multi-turn recovery | Dead door, then `ROUTE_UNAVAILABLE`, then re-plan; a rejected call, then a corrected one | ✓ measured (recoveries, re-plans) |
| missing knowledge or parameter | Must cite evidence the speaker actually knows; unalerted people can't evacuate | ✓ engine-enforced |
| missing function | Masking removes tools that aren't applicable this turn | ◐ partial |
| parallel | Five people decide at the same time, one call each | ✓ covered |
| irrelevance / abstain | Distractor messages or non-emergencies where the right answer is no evacuation | ○ planned |
| long context | Each decision is a fresh, compact prompt by design | ○ planned stress test |
| reliability (pass^k) | Repeat each case k times | ○ planned |

## 5. Winning patterns, and where we stand

| Pattern | Evidence | Us |
|---|---|---|
| Numbers beat polish: quantitative evaluation won the Nemotron hackathon | [Nota AI](https://blog.nota.ai/insights/nemotron-hackathon-winner) | ✓ held-out test split with replayable runs |
| Deep, *visible* use of the sponsor stack is a scored axis | [LangChain contest](https://www.nvidia.com/en-us/ai-data-science/generative-ai/developer-contest-with-langchain/), [LlamaIndex contest](https://developer.nvidia.com/llamaindex-developer-contest) | ✓ self-hosted vLLM on Brev; every decision visible in the trace |
| Error recovery is rewarded | [NeMo Agent Toolkit winners](https://developer.nvidia.com/blog/hackathon-winners-bring-agentic-ai-to-life-with-the-nvidia-nemo-agent-toolkit/), [Emergence rubric](https://github.com/advik-bhatt/emergence-hackathon-info/blob/main/devpost-enterprise-agents-hackathon.md) | ✓ hints, recoveries, re-plans |
| Judge by final state, not just the transcript | [BFCL v3](https://gorilla.cs.berkeley.edu/blogs/13_bfcl_v3_multi_turn.html) | ✓ success only via verified roster and engine state |
| Model proposes, engine decides | RPG-MCP, llmgine (above) | ✓ core architecture |
| Publish a held-out before/after with artifacts | [Sommelier](https://abdelstark-sommelier.static.hf.space/index.html) | ◐ held-out results and replayable run logs; no before/after comparison in agents mode yet |
| Report reliability (pass^k), not one best run | [τ-bench](https://arxiv.org/abs/2406.12045), [r/LocalLLaMA thread](https://reddit.sentinel-team.org/posts/1uuxsdl/snapshots/2026-07-17T18%3A53%3A30.39359Z) | ○ one run per case today |
| Attribute failures to causes | [Toolhound](https://reddit.sentinel-team.org/posts/1um8dbk/snapshots/2026-07-03T19%3A50%3A30.28358Z), [sub-2B study](https://arxiv.org/abs/2609.07370) | ◐ error codes counted; no histogram yet |
| Prefix-cache economics are the vLLM agent story | [llm-d](https://llm-d.ai/blog/kvcache-wins-you-can-see), [Red Hat talk](https://www.ai.engineer/talks/YXowceUKYJI-kv-cache-aware-routing-p-d-disaggregation) | ◐ caching on; hit rate not measured yet |
| Benchmark a concurrency sweep against SLOs | [Red Hat Developer](https://developers.redhat.com/articles/2026/03/03/practical-strategies-vllm-performance-tuning) | ○ planned |
| One-click reproducibility | [Brev Launchables](https://docs.nvidia.com/brev/latest/concepts/launchables.md) | ○ planned |
| Honest small-model fit | [Build Small](https://huggingface.co/organizations/build-small-hackathon) | ✓ 3B active, one GPU, about one second per decision |

## 6. Cheap, extendable opportunities (ranked by effort)

| # | Extension | Effort | Evidence it would produce |
|---|---|---|---|
| 1 | **Prefix-cache panel**: scrape `/metrics` before and after a bench; report `vllm:prefix_cache_hits / vllm:prefix_cache_queries` with TTFT ([metrics](https://docs.vllm.ai/en/latest/design/metrics.html)). Caveat: hybrid Mamba models resume cache only at block boundaries ([APC docs](https://docs.vllm.ai/en/latest/features/automatic_prefix_caching.html)) | 30 min (`deploy/vllm/measure.sh` already snapshots `/metrics`) | Hit rate, TTFT with vs without `--enable-prefix-caching` |
| 2 | **Reasoning budget sweep**: 64 / 128 / 256 tokens on the held-out split | 1 h of GPU | Success and invalid-call rate against latency per decision |
| 3 | **pass^k**: k = 4 repeats per test case | 1 h of GPU | Reliability rather than a best single run |
| 4 | **Failure-cause histogram**: parse / schema / engine-rejected / wrong-decision / recovered | 1 h (data is already in run logs) | Shows which failures are the model's and which are the harness's |
| 5 | **Concurrency sweep** at 1/8/32 headless buildings (raise `--max-num-seqs`); optionally GuideLLM ([guide](https://lucaberton.com/blog/guidellm-vllm-benchmark-slo-kubernetes/)) | 1–2 h | Episodes/min and P95 decision latency curve |
| 6 | **BF16 vs NVFP4** on the same H100 | 1 h plus a restart | Same-accuracy / higher-throughput row (the card shows about 2 points on PinchBench; Hopper throughput **[UNVERIFIED]**) |
| 7 | **Constrained-decoding ladder**: on a rejected call, retry with a named `tool_choice` or strict schema; count how often each rung fires | 2 h | Recovery-rate gain. vLLM guarantees *parseable* calls, not *good* ones ([tool calling docs](https://docs.vllm.ai/en/latest/features/tool_calling.html)) |
| 8 | **Speculative decoding**: built-in MTP vs none at low and high concurrency; acceptance rate from `vllm:spec_decode_*` ([spec metrics](https://docs.vllm.ai/en/stable/api/vllm/v1/spec_decode/metrics/)). A DSpark draft would add parameters (size **[UNVERIFIED]**) against the 33B cap | 2 h | Latency at concurrency 1 vs 32 |
| 9 | **Brev Launchable**: one-click VM with `serve.sh` and a public repo; no secrets in the image or logs | 1 h | "Launch on Brev" badge; judges can reproduce |
| 10 | **Customer floor-plan import**: the ASCII-to-JSON map builder is the extension point | 1 day | The product story beyond the hackathon office |

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
