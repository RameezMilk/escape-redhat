#!/usr/bin/env bash
# Serve Nemotron 3.5 Lightning 30B-A3B with vLLM on ONE GPU (Brev H100 80–96 GB recommended).
# Run this ON the GPU machine. Flags come from the NVIDIA model card's vLLM recipe (BF16, 1x H100),
# plus a modest context (16K) and an API key. Record what you actually ran in MODEL_MANIFEST.md.
#
#   export VLLM_API_KEY=$(openssl rand -hex 16)   # keep it; put the same value in the app's .env as PLANNER_API_KEY
#   export HF_REVISION=<full commit sha from https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16/commits/main>
#   ./serve.sh
set -euo pipefail

: "${VLLM_API_KEY:?set VLLM_API_KEY (any random string; the app sends it as a Bearer token)}"
HF_REVISION="${HF_REVISION:-main}"   # pin a sha for reproducibility
IMAGE="${IMAGE:-vllm/vllm-openai:v0.27.1}"   # v0.27.1 = model card's named version (released 2026-08-11)
MODEL="${MODEL:-nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16}"
PORT="${PORT:-8000}"

if [ "$HF_REVISION" = "main" ]; then
  echo "WARNING: HF_REVISION not pinned; record the resolved sha in MODEL_MANIFEST.md" >&2
fi

docker rm -f nemotron-vllm >/dev/null 2>&1 || true
docker run -d --name nemotron-vllm --restart unless-stopped \
  --gpus all --ipc=host -p "${PORT}:8000" \
  -v "${HOME}/.cache/huggingface:/root/.cache/huggingface" \
  "${IMAGE}" \
  --model "${MODEL}" --revision "${HF_REVISION}" \
  --served-model-name nemotron-3.5-lightning \
  --max-model-len 16384 --max-num-seqs 32 \
  --enable-prefix-caching --async-scheduling \
  --mamba-backend flashinfer --mamba-ssm-cache-dtype float16 \
  --enable-mamba-cache-stochastic-rounding --mamba-cache-philox-rounds 5 \
  --reasoning-parser nemotron_v3 --tool-call-parser qwen3_coder --enable-auto-tool-choice \
  --api-key "${VLLM_API_KEY}"

echo "Started container nemotron-vllm. First start downloads ~66 GB of weights. Follow with:"
echo "  docker logs -f nemotron-vllm"
echo "Then run ./check.sh (on this machine, or through an SSH tunnel from your laptop)."

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
