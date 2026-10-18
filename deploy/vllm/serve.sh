#!/usr/bin/env bash
# Serve Nemotron 3.5 Lightning 30B-A3B (BF16) with vLLM on ONE H100. This is the exact configuration that ran for the
# submitted demo and results (Brev, 1x H100 80GB HBM3, 2026-10-17); see MODEL_MANIFEST.md for measured values.
# Flags adapt the NVIDIA model card's single-H100 BF16 recipe to a small context/concurrency for 3 game characters.
# Run ON the GPU VM:
#
#   export ESCAPE_ROOT="$HOME/escape-inference"; mkdir -p "$ESCAPE_ROOT/hf-cache" "$ESCAPE_ROOT/vllm-cache"
#   python3 -c "import secrets;print('ESCAPE_VLLM_KEY='+secrets.token_urlsafe(32))" > "$ESCAPE_ROOT/server.env"; chmod 600 "$ESCAPE_ROOT/server.env"
#   ./serve.sh
#
# Laptop (game backend):  brev port-forward escape-nemotron --port 8001:8000
#   .env → PLANNER_BASE_URL=http://127.0.0.1:8001/v1  PLANNER_MODEL=escape-nemotron  PLANNER_API_KEY=<ESCAPE_VLLM_KEY>
set -euo pipefail

ESCAPE_ROOT="${ESCAPE_ROOT:-$HOME/escape-inference}"
# shellcheck disable=SC1091
. "$ESCAPE_ROOT/server.env"
: "${ESCAPE_VLLM_KEY:?missing ESCAPE_VLLM_KEY in $ESCAPE_ROOT/server.env}"
IMAGE="${IMAGE:-vllm/vllm-openai:v0.27.1}"   # resolved digest on 2026-10-17: sha256:0a51ea5b4ae2dc5d81890e5173f54203d2a3ae0cfffe51b8fd2afd4391bfd967

docker run -d \
  --name escape-nemotron \
  --restart unless-stopped \
  --gpus all \
  --ipc=host \
  -p 127.0.0.1:8000:8000 \
  -v "$ESCAPE_ROOT/hf-cache:/root/.cache/huggingface" \
  -v "$ESCAPE_ROOT/vllm-cache:/root/.cache/vllm" \
  -e HF_HUB_DOWNLOAD_TIMEOUT=120 \
  -e HF_HUB_ETAG_TIMEOUT=60 \
  "$IMAGE" \
  --model nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16 \
  --served-model-name escape-nemotron \
  --host 0.0.0.0 \
  --port 8000 \
  --dtype bfloat16 \
  --max-model-len 8192 \
  --max-num-seqs 8 \
  --max-num-batched-tokens 8192 \
  --gpu-memory-utilization 0.90 \
  --enable-prefix-caching \
  --async-scheduling \
  --mamba-backend flashinfer \
  --mamba-ssm-cache-dtype float16 \
  --enable-mamba-cache-stochastic-rounding \
  --mamba-cache-philox-rounds 5 \
  --reasoning-parser nemotron_v3 \
  --tool-call-parser qwen3_coder \
  --enable-auto-tool-choice \
  --api-key "$ESCAPE_VLLM_KEY"

echo "Started escape-nemotron (first start downloads ~62 GB of weights; ~10 min to load on H100). Follow with:"
echo "  docker logs --follow --tail 80 escape-nemotron"
echo "Then: curl -f http://127.0.0.1:8000/health"

# ---------------------------------------------------------------------------------------------
# Fallback 1 — NVFP4 checkpoint on 1x H100 (W4A16 'humming' kernels; Hopper has no FP4 tensor cores).
# Verbatim flags from the NVFP4 card's "1x H100 (max throughput)" recipe + our name/context/key.
# Requires a quality check on the dev split before use in the demo.
#
# docker run -d --name nemotron-vllm --gpus all --ipc=host -p 8000:8000 \
#   -e VLLM_HUMMING_MOE_GEMM_TYPE=indexed \
#   -v ~/.cache/huggingface:/root/.cache/huggingface vllm/vllm-openai:v0.27.1 \
#   --model nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4 \
#   --served-model-name nemotron-3.5-lightning --max-model-len 16384 \
#   --max-num-seqs 256 --max-num-batched-tokens 16384 \
#   --enable-prefix-caching --async-scheduling \
#   --mamba-backend flashinfer --moe-backend humming --linear-backend humming \
#   --mamba-ssu-algorithm horizontal --mamba-cache-mode align \
#   --mamba-ssm-cache-dtype float16 \
#   --enable-mamba-cache-stochastic-rounding --mamba-cache-philox-rounds 5 \
#   --reasoning-parser nemotron_v3 --tool-call-parser qwen3_coder --enable-auto-tool-choice \
#   --api-key "$VLLM_API_KEY"
#
# Fallback 2 — A100 80 GB: same NVFP4 command but add --quantization modelopt_fp4, use
#   --mamba-ssu-algorithm simple and --max-num-batched-tokens 32768, and drop
#   --enable-mamba-cache-stochastic-rounding, --mamba-cache-philox-rounds and --mamba-ssm-cache-dtype float16.
#
# Fallback 3 — no GPU serving: hosted NVIDIA API Catalog (same model id nvidia/nemotron-3.5-lightning-30b-a3b
#   at https://integrate.api.nvidia.com/v1). Disclose as hosted; weakens the vLLM / "local" bounty claims.
# NOT used: Red Hat AI Inference image registry.redhat.io/rhaii/vllm-cuda-rhel9:3.5.1 (ships vLLM 0.24.0 < 0.27.1),
#           DSpark speculative draft model (unnecessary; would count toward the 33B parameter cap).
