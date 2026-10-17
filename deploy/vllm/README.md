# Serving Nemotron 3.5 Lightning on Brev with vLLM

**Goal:** one GPU, one checkpoint, one OpenAI-compatible endpoint. The Escape from Red Hat server calls this endpoint; the browser never does.

## 1. Pick the machine (human action: this costs money)

| Choice | Recommendation | Why |
|---|---|---|
| GPU | **1× H100 80–96 GB** (A100 80 GB is the fallback) | The BF16 weights are about 65.8 GB. The model card states a single-H100 (or A100 80 GB) deployment |
| Host | x86_64, ≥64 GB RAM (128 GB if the price is close), ~200 GB SSD | Weights plus the container image, with headroom |
| Provider | Flexible ports and stop/start, if prices are close | Restarts and port exposure. See the capacity warning below |
| Not | 1× L40S (44–48 GB) | BF16 does not fit, and NVFP4 on L40S is unvalidated |

**Steps.**
1. The captain redeems the credit: Brev console → Billing → Redeem Code.
2. Invite teammates to the org.
3. Read the **live hourly price** in the console before launching. Brev prices are not public.

**Budget.** Spend at most (credit − $30 reserve) ÷ hours remaining.

| Hourly rate | 19.5 h (Sat 15:30 → Sun 11:00) |
|---|---|
| $4 | $78 |
| $5 | $98 |
| $6.5 | $127 (ceiling for $160 credit) |

**Capacity warning (Brev docs).** If you stop an instance and capacity becomes unavailable, you cannot reach its data until capacity returns. Push results to Git before stopping. The morning recording needs the GPU **up**.

## 2. Start vLLM (on the GPU box)

```bash
git clone <this repo> && cd <repo>/deploy/vllm
export VLLM_API_KEY=$(openssl rand -hex 16)          # save it
export HF_REVISION=<sha from the HF model page "commits">  # pin it
./serve.sh
docker logs -f nemotron-vllm                           # wait for "Application startup complete"
```

**Key flags** (from the model card):
- `--tool-call-parser qwen3_coder --enable-auto-tool-choice`: native OpenAI `tool_calls`. The model emits XML that the parser converts.
- `--reasoning-parser nemotron_v3`: reasoning goes to `message.reasoning`.

**Our additions:**
- `--max-model-len 16384`: prompts are about 4K tokens; the card's 256K is unnecessary.
- `--max-num-seqs 32`: room for benchmark concurrency.
- `--served-model-name nemotron-3.5-lightning`.
- `--api-key`.

**Thinking is turned off per request**, not at the server: `chat_template_kwargs: {"enable_thinking": false}`. Reasoning tokens count toward `max_tokens`. With thinking on, raise `max_tokens`, or `content` and `tool_calls` can come back empty.

## 3. Reach it from the laptop

```bash
ssh -N -L 8000:localhost:8000 <brev-instance-ssh-alias>   # or `brev port-forward`
```

Then set these in the repo-root `.env`:

```
PLANNER_PROVIDER=openai-compatible
PLANNER_BASE_URL=http://localhost:8000/v1
PLANNER_MODEL=nemotron-3.5-lightning
PLANNER_API_KEY=<VLLM_API_KEY>
PLANNER_ENDPOINT_KIND=self-hosted-vllm
```

## 4. Validate before claiming integration

```bash
BASE_URL=http://localhost:8000/v1 API_KEY=$VLLM_API_KEY ./check.sh
```

The check runs:
1. Model listing.
2. One native tool call.
3. A tool error followed by the model's corrected call.
4. p50/p95 latency over 20 sequential calls.
5. `docker restart nemotron-vllm`, then rerun.

Paste the outputs into `MODEL_MANIFEST.md`. Then run the app benchmark:

```bash
npm run bench -- --split dev --provider env --concurrency 1   # and --concurrency 8 for the throughput comparison
```

## 5. Fallbacks (in order)

1. **NVFP4 on the same H100.** W4A16 kernels; the command is commented in `serve.sh`. Re-run the dev split to check quality before using it.
2. **A100 80 GB.** Use the card's A100 recipe (in `serve.sh` comments).
3. **Hosted NVIDIA API Catalog, same model** (`nvidia/nemotron-3.5-lightning-30b-a3b` at `https://integrate.api.nvidia.com/v1`). Disclose it as hosted. This keeps an eligible model but weakens the vLLM and "local solution" bounty claims.

**Not used:**
- The Red Hat AI Inference image `registry.redhat.io/rhaii/vllm-cuda-rhel9:3.5.1`. It packages vLLM 0.24.0, below the 0.27.1 minimum for this model.
- Speculative draft models. They aren't needed and would count toward the 33B parameter cap.

If nothing is serving by about 17:45 Saturday, report the exact error and ask a mentor.

## Collect the evidence (once vLLM is serving)

```bash
ssh -N -L 8000:localhost:8000 <brev-instance>        # terminal 1
BASE_URL=http://localhost:8000/v1 API_KEY=<vllm --api-key> deploy/vllm/measure.sh full   # terminal 2
```

Writes `results/vllm-<timestamp>/`: server metadata (`/version`, `/models`), endpoint check, app smoke + recovery test,
dev and held-out test benchmarks (harness v2), baseline harness v1 on the test split + comparison, concurrency 1 vs 8
throughput, thinking-on A/B, and a `/metrics` snapshot (prefix-cache and token counters). `quick` skips the last four.
