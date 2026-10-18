#!/usr/bin/env bash
# One-shot evidence collection once vLLM is serving Nemotron on Brev.
# Produces the numbers the README / bounty write-ups cite — nothing is copied by hand.
#
#   brev port-forward escape-nemotron --port 8001:8000      # in another terminal
#   API_KEY=<ESCAPE_VLLM_KEY> deploy/vllm/measure.sh [quick|full]
#
# quick (default): endpoint check + smoke/recovery + dev split (v2) + held-out test split (v2)
# full:            quick + test split with baseline harness v1 + concurrency 1 vs 8 throughput + thinking-on A/B
set -euo pipefail
cd "$(dirname "$0")/../.."

MODE="${1:-quick}"
BASE_URL="${BASE_URL:-http://127.0.0.1:8001/v1}"
API_KEY="${API_KEY:-${VLLM_API_KEY:-}}"
MODEL="${MODEL:-escape-nemotron}"
STAMP="$(date +%Y%m%d-%H%M)"
OUT="results/vllm-${STAMP}"
mkdir -p "$OUT"

export PLANNER_PROVIDER=openai-compatible
export PLANNER_BASE_URL="$BASE_URL"
export PLANNER_MODEL="$MODEL"
export PLANNER_API_KEY="$API_KEY"
export PLANNER_ENDPOINT_KIND=self-hosted-vllm
export PLANNER_DEADLINE_MS="${PLANNER_DEADLINE_MS:-30000}"
export PLANNER_THINKING=false

ROOT_URL="${BASE_URL%/v1}"
AUTH=(-H "Authorization: Bearer ${API_KEY}")

echo "== 0. server metadata → $OUT/vllm-meta.json"
{
  echo '{'
  echo "  \"collected_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
  echo "  \"base_url\": \"${BASE_URL}\","
  echo "  \"version\": $(curl -sf "${AUTH[@]}" "${ROOT_URL}/version" || echo null),"
  echo "  \"models\": $(curl -sf "${AUTH[@]}" "${BASE_URL}/models" || echo null)"
  echo '}'
} > "$OUT/vllm-meta.json"
cat "$OUT/vllm-meta.json"

echo "== 1. endpoint check (models, native tool call, error→recovery, latency)"
BASE_URL="$BASE_URL" API_KEY="$API_KEY" MODEL="$MODEL" bash deploy/vllm/check.sh 2>&1 | tee "$OUT/check.txt"

echo "== 2. app smoke test incl. recovery (real planner prompt + tools)"
npx tsx apps/server/src/smoke.ts --recovery --n 10 2>&1 | tee "$OUT/smoke.txt"

bench() { # name, extra args...
  local name="$1"; shift
  echo "== bench: $name ($*)"
  npx tsx apps/eval/src/bench.ts "$@" --out "$OUT/$name" 2>&1 | grep -E '^\[bench\]' || true
}

bench dev-v2 --split dev --harness v2 --concurrency 4
bench test-v2 --split test --harness v2 --concurrency 4

if [ "$MODE" = "full" ]; then
  bench test-v1 --split test --harness v1 --concurrency 4
  bench dev-c1 --split dev --harness v2 --concurrency 1
  bench dev-c8 --split dev --harness v2 --concurrency 8
  PLANNER_THINKING=true bench dev-v2-thinking --split dev --harness v2 --concurrency 4 --thinking on
  echo "== harness comparison (held-out test split): v1 baseline vs v2"
  npx tsx apps/eval/src/compare.ts "$OUT/test-v1/summary.json" "$OUT/test-v2/summary.json" | tee "$OUT/compare-test-v1-v2.md"
fi

echo "== vLLM /metrics snapshot (prefix cache, throughput counters) → $OUT/metrics.txt"
curl -sf "${AUTH[@]}" "${ROOT_URL}/metrics" | grep -E '^vllm:(prefix_cache|gpu_cache_usage|num_requests|prompt_tokens_total|generation_tokens_total|e2e_request_latency_seconds_(sum|count)|time_to_first_token_seconds_(sum|count))' > "$OUT/metrics.txt" || echo "(metrics endpoint unavailable)" > "$OUT/metrics.txt"

echo
echo "Done. Summaries:"
ls -1 "$OUT"/*/summary.md 2>/dev/null
