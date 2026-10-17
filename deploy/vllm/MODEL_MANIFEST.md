# Model and deployment manifest

Fill this in at deploy time with what actually ran. Never paste API keys.

## Model

| Field | Value |
|---|---|
| Checkpoint | `nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16` |
| HF revision (full sha) | _fill_ |
| License | OpenMDW-1.1 (per model card) |
| Parameters | 30B total / 3B active (hybrid Mamba-2 + MoE + attention), per model card |
| Served name | `nemotron-3.5-lightning` |

## Parameter accounting (event rule: ≤ 33B total across all generative models)

| Model | Role | Total params | Counted |
|---|---|---|---|
| Nemotron 3.5 Lightning 30B-A3B | the only generative model: central planner | 30B | yes |
| Speculative draft model | none | 0 | — |
| Verifier / critic / router model | none (scoring is deterministic engine code) | 0 | — |
| **Total** | | **30B ≤ 33B** | |

Claude was used only as a coding assistant during development. It does not run in the product.

## Serving

| Field | Value |
|---|---|
| Provider / instance type | _fill (Brev …)_ |
| GPU | _fill (e.g. 1× H100 80 GB / 94 GB NVL)_ |
| Host RAM / disk | _fill_ |
| Hourly price (from console) | _fill_ |
| Container image | `vllm/vllm-openai:v0.27.1` @ digest _fill_ (`docker inspect --format '{{index .RepoDigests 0}}' vllm/vllm-openai:v0.27.1`) |
| Full flags | _paste the exact `docker run` line_ |
| max-model-len / max-num-seqs | 16384 / 32 |
| Tool parser / reasoning parser | `qwen3_coder` / `nemotron_v3` |
| Thinking | off per request (`chat_template_kwargs.enable_thinking=false`) unless noted |
| Sampling (app defaults) | temperature 0.6, top_p 0.95, max_tokens 1024 |

## Measurements (paste raw outputs; keep units)

| Check | Result |
|---|---|
| `GET /v1/models` | _fill_ |
| Native tool call returned (`check.sh` step 2) | _fill_ |
| Error → recovery call (`check.sh` step 3) | _fill_ |
| Latency, 20 sequential calls, p50 / p95 | _fill_ |
| Restart time to healthy | _fill_ |
| Bench dev split, concurrency 1: episodes/min, decision p50/p95 | _fill (results/…)_ |
| Bench dev split, concurrency 8: episodes/min, decision p50/p95 | _fill (results/…)_ |
| Thinking on vs off (same split): success, p50 | _fill or "not run"_ |
