# Results

Benchmark outputs from `apps/eval`. Every run directory has:
- `summary.md` (human-readable);
- `summary.json` (machine-readable: meta, aggregates and per-case rows);
- `runs/<caseId>.jsonl` (full run logs that can be replayed).

```bash
npm run bench -- --split dev  --provider env --harness v2 --concurrency 1 --out results/dev-v2-c1
npm run bench -- --split dev  --provider env --harness v2 --concurrency 8 --out results/dev-v2-c8   # vLLM throughput comparison
npm run bench -- --split test --provider env --harness v2 --out results/test-v2                     # held-out
npx tsx apps/eval/src/compare.ts results/test-v1/summary.json results/test-v2/summary.json --out results/compare-test-v1-v2.md
npm run replay -- results/<run>/runs/<caseId>.jsonl                                                 # re-simulate a run
```

**Rulesets.** `2026-10-17-vllm-h100/` is **ruleset 1** (static fire + blocker, 240 s limit); its run logs replay only with the ruleset-1 engine (git history before the gameplay-v2 commits). New runs are **ruleset 2** (`escape-office-scenarios-v2`: spreading fire, electrical door failures, fire alarms, losses, no time limit); compare runs only within one ruleset (`compare.ts` warns when the dataset differs).

**Rules for what goes here:**
- Only commit runs made with a real model endpoint. The header says the provider, model, endpoint kind (self-hosted vLLM or hosted API), harness and date.
- `results/tmp/` is git-ignored. Use it for scripted-fixture smoke tests; those are **not** model results.
- Each episode is a single run at temperature > 0, on a small dataset (16 dev and 16 test cases). Report counts alongside rates.
- The clock is lockstep: simulated time excludes inference waiting. Wall-clock and decision latency are reported separately.
