# Results

Benchmark outputs from `apps/eval`. Every run directory has:
- `summary.md` (human-readable);
- `summary.json` (machine-readable: meta, aggregates and per-case rows);
- `runs/<caseId>.jsonl` (full run logs that can be replayed). Committed runs are archived as `runs.tar.gz` (raw requests make them large): `tar xzf <dir>/runs.tar.gz -C <dir>` restores `runs/`.

```bash
npm run bench -- --split dev  --provider env --harness v2 --concurrency 1 --out results/dev-v2-c1
npm run bench -- --split dev  --provider env --harness v2 --concurrency 8 --out results/dev-v2-c8   # vLLM throughput comparison
npm run bench -- --split test --provider env --harness v2 --out results/test-v2                     # held-out
npx tsx apps/eval/src/compare.ts results/test-v1/summary.json results/test-v2/summary.json --out results/compare-test-v1-v2.md
npm run replay -- results/<run>/runs/<caseId>.jsonl                                                 # re-simulate a run
```

**Rulesets.** `2026-10-17-vllm-h100/` is **ruleset 1** (static fire + blocker, 240 s limit); its run logs replay only with the ruleset-1 engine (git history before the gameplay-v2 commits). `2026-10-17-ruleset2-vllm-h100/` and `2026-10-17-ruleset3-vllm-h100/` are **ruleset 2/3 on office-v1 with three people** (`escape-office-scenarios-v2`: spreading fire, electrical door failures, fire alarms, losses, no time limit); their run logs replay only with the office-v1 engine (git tag `office-v1-final`). `2026-10-18-office-v2-vllm-h100/` and later are the **office-v2 ground floor with five people** (`escape-office-scenarios-v3`). Compare runs only within one dataset (`compare.ts` warns when the dataset differs).

**Rules for what goes here:**
- Only commit runs made with a real model endpoint. The header says the provider, model, endpoint kind (self-hosted vLLM or hosted API), harness and date.
- `results/tmp/` is git-ignored. Use it for scripted-fixture smoke tests; those are **not** model results.
- Each episode is a single run at temperature > 0, on a small dataset (16 dev and 16 test cases). Report counts alongside rates.
- The clock is lockstep: simulated time excludes inference waiting. Wall-clock and decision latency are reported separately.
