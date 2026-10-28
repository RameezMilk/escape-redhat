# Results

Benchmark outputs from `apps/eval`. Every run directory has:
- `summary.md` (human-readable);
- `summary.json` (machine-readable: meta, aggregates and per-case rows);
- `runs/<caseId>.jsonl` (full run logs that can be replayed). Committed runs are archived as `runs.tar.gz` (raw requests make them large): `tar xzf <dir>/runs.tar.gz -C <dir>` restores `runs/`.

```bash
npm run bench -- --split dev  --provider env --mode agents --concurrency 4 --out results/agents-dev
npm run bench -- --split test --provider env --mode agents --concurrency 4 --out results/agents-test   # held-out
npx tsx apps/eval/src/compare.ts results/<a>/summary.json results/<b>/summary.json --out results/compare.md
npm run replay -- results/<run>/runs/<caseId>.jsonl                                                       # re-simulate a run
```

**What's here.** `2026-10-18-office-v2-vllm-h100/` holds the agents-mode runs on the office-v2 ground floor with five people (`escape-office-scenarios-v3`), measured on self-hosted Nemotron 3.5 Lightning (vLLM, one H100): `agents-dev/` and `agents-test/`. Older office-v1 result sets were removed; they live in git history (tag `office-v1-final`). Compare runs only within one dataset (`compare.ts` warns when the dataset differs).

**Rules for what goes here:**
- Only commit runs made with a real model endpoint. The header says the provider, model, endpoint kind (self-hosted vLLM or hosted API), harness and date.
- `results/tmp/` is git-ignored. Use it for scripted-fixture smoke tests; those are **not** model results.
- Each episode is a single run at temperature > 0, on a small dataset (16 dev and 16 test cases). Report counts alongside rates.
- The clock is lockstep: simulated time excludes inference waiting. Wall-clock and decision latency are reported separately.
