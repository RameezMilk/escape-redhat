# Deploying the model

The game server talks to any OpenAI-compatible chat-completions endpoint through one adapter
(`apps/server/src/providers/openaiCompatible.ts`). Switching models is a `.env` change, not a code change. Both
profiles are in [`.env.example`](../.env.example).

| | A. Hosted API (default) | B. Self-hosted (this folder) |
|---|---|---|
| Model | OpenAI GPT-4.1 | NVIDIA Nemotron 3.5 Lightning 30B-A3B |
| Runs on | OpenAI's servers | One rented H100 on NVIDIA Brev, served by vLLM 0.27.1 |
| Setup | API key in `.env` | Rent the GPU, run `serve.sh`, open a tunnel (~15-20 min) |
| Data | Prompts leave our network | Prompts never leave our machine |
| Cost | Per token | Per GPU-hour (pays off at sustained volume) |
| Reasoning text in the trace | No | Yes (capped at 128 tokens per decision) |
| Ops burden | None | We own uptime, the tunnel and upgrades |

## A. Hosted API

1. `cp .env.example .env` and paste the key into `PLANNER_API_KEY`.
2. `npm run smoke -w @escape/server -- --recovery --n 5` checks the endpoint: health, a real tool call, a recovery
   after a rejected call, and latency.

## B. Self-hosted Nemotron on vLLM ([`vllm/`](vllm/))

| File | What it does |
|---|---|
| [`vllm/README.md`](vllm/README.md) | Runbook: pick the machine, start vLLM, tunnel to the laptop, validate, fallbacks |
| [`vllm/serve.sh`](vllm/serve.sh) | Starts vLLM in Docker on the GPU VM with the exact flags the measured results used |
| [`vllm/check.sh`](vllm/check.sh) | Validates the server: model listed, native tool call, error → recovery |
| [`vllm/measure.sh`](vllm/measure.sh) | Collects latency and benchmark evidence into `results/` |
| [`vllm/MODEL_MANIFEST.md`](vllm/MODEL_MANIFEST.md) | What was served: checkpoint, parameters, flags |

Then switch `.env` to profile B. The measured Nemotron results are in
[`results/2026-10-18-office-v2-vllm-h100/`](../results/2026-10-18-office-v2-vllm-h100/).
