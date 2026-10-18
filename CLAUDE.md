# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"Escape from Red Hat": a pixel-art office-evacuation exercise (NVIDIA × Red Hat Small Models Hack). A deterministic TypeScript engine owns the world: the office-v2 ground floor (GPU server room, Red Hat conference room, kitchen, main hallway, cubicles, reception; a street with a crosswalk and the bus-stop assembly point across it), spreading fire, seven electric sliding doors, three manual exits, two fire-alarm pull stations (hallway, reception), and five people: Alex the warden, Maya, Daniel who uses a wheelchair, Rosa the receptionist and Kenji the IT engineer. NVIDIA Nemotron 3.5 Lightning 30B-A3B, self-hosted on vLLM (Brev H100), chooses validated tool calls. Two decision modes:
- `central` (code default): one planner call directs all five people from a merged team view.
- `agents` (`PLANNER_MODE=agents`): each person makes their own reasoning call from their own personal view; the engine's hard-coded survival instincts are off.

The project presents **agents mode only** (README, docs, demo, `.env.example`). Central mode stays in the code for the tests, the scripted fixture and the bench default; don't put central-planner results back in the user-facing docs.

`README.md` (quick start, results, limitations) and `docs/tech-stack.md` (serving/tool-calling details with measured numbers) are the user-facing docs.

## Commands

npm workspaces monorepo; run everything from the repo root. Node ≥ 20.

```bash
npm install                      # .npmrc pins resolution to packages published before 2026-10-03 (hackathon 2-week reuse rule) — don't override it
npm run dev                      # server (tsx watch, :8787) + web (Vite, :5173; proxies /ws and /api to :8787)
npm run start                    # server only; it also serves the built web/dist
npm run build                    # web production build
npm run typecheck                # packages, server src, eval, data, scripts — NOT the web app or server tests:
npx tsc -p apps/web/tsconfig.json --noEmit       # web
npx tsc -p apps/server/tsconfig.json --noEmit    # server incl. apps/server/test
npm test                         # vitest: packages/*/test, apps/server/test, apps/eval/test

npx vitest run packages/engine/test/fire.test.ts         # one file
npx vitest run apps/server -t "replays identically"      # by test name

npm run smoke -w @escape/server -- --recovery --n 10     # real endpoint: one tool-call round trip, recovery check, latency
npm run bench -- --split dev --provider env --harness v2 --concurrency 4 --out results/<dir>   # --mode agents, --thinking on|off, --cases a,b, --limit K
npm run replay -- runs/<episodeId>.jsonl                  # re-simulate a saved run; exit 1 on divergence
npm run data:map                 # rebuild data/maps/office-v2.json from office-v2.ascii + office-v2.spec.ts, and packages/contracts/src/map-ids.generated.ts
npm run data:scenarios           # regenerate data/scenarios/cases.{dev,test}.jsonl (+ provenance)
```

- **Configuration.** Copy `.env.example` to `.env` (gitignored). `PLANNER_PROVIDER=scripted` runs a deterministic rule policy, clearly labelled "SCRIPTED fixture — not a model"; tests use it.
- **Self-hosted model.** Set `PLANNER_PROVIDER=openai-compatible` and point it at vLLM through `brev port-forward escape-nemotron --port 8001:8000`. The tunnel drops occasionally: re-run it, then restart the server, because the model health check runs only at startup.
  - `brev port-forward` returns once the tunnel is up and leaves an `ssh` process holding it.
  - Check it with `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8001/v1/models`: `401` means up, `000` means down.
- **Agents mode.** Its settings are separate from the central `PLANNER_*` values in `.env`: `PLANNER_AGENT_THINKING`, `PLANNER_AGENT_THINKING_BUDGET` (reasoning-token cap per decision, default 128; `0` = uncapped), `PLANNER_AGENT_MAX_DECISIONS` and `PLANNER_AGENT_FREEZE_WHILE_THINKING`.
  - **Live testing setup:** `PLANNER_MODE=agents PLANNER_AGENT_FREEZE_WHILE_THINKING=false npm run start -w @escape/server` (real-time clock) plus `npm run dev -w @escape/web`, then open :5173. Shell env vars win over `.env`.
  - **Latency is almost all reasoning decode:** about 0.3 s plus 4.5 ms per completion token on the H100. Uncapped, the median was 715 tokens (3.5 s).
  - **Reasoning controls:** vLLM 0.27.1 honours the `thinking_token_budget` request field. The chat template's `reasoning_effort` / `low_effort` flags had no reliable effect, and turning thinking off makes the model pick `observe` almost every time.
  - **Wasted decisions:** about three-quarters of uncapped decisions moved no one (`observe`, `plan_route`, rejected calls). That is the next latency lever after the cap.
- **Web URL parameters.** `?intro=0` skips the start screen. `?fixture=1` streams canned UI data with no server. `?gallery=1` shows every procedural sprite (furniture, decor, outfits) for visual review.
- **Bench limitation.** `npm run bench` only loads the `dev` and `test` splits. `demo-hero` is split `demo` and has no events (the presenter places the fire and the power cut live), so it is never benchmarked; `dev-00-hero` is its scripted stand-in (`hero-story.json`).
- **Rehearsal helpers.** `scripts/auto-electrical.mjs` cuts the reception door's power once someone is moving through the main hallway (`--door`, `--when-zone`, `--url`; door tiles come from the current map). `scripts/watch-trace.mjs` tails the trace.
- **vLLM serving.** See `deploy/vllm/`.

## Architecture

**`packages/contracts`** holds every type and protocol shared by engine, server, web and eval:
- `types.ts`: `PlannerView` (team view), `AgentView` (one person's view), `TraceRow`, `WorldEvent`, `ProviderInfo`, `Snapshot`.
- `tools.ts`: `TOOL_DEFS`, the OpenAI tool schemas sent to the model, plus `TOOL_ARG_SCHEMAS`, the strict zod validators the engine applies.
- `engine-api.ts`: the `Engine` interface, `EngineOptions` and `ACTOR_PROFILES` (roles come from the profiles: `WARDEN_ID` and `ASSISTANCE` = {person, buddy} are derived, never hard-coded).
- `protocol.ts`: the WebSocket messages.
- `map-ids.generated.ts` (written by `npm run data:map`; don't edit): `ZONE_IDS`, `DOOR_IDS`, `ALARM_STATION_IDS`, `DEFAULT_MAP_ID`.
- `furniture.ts`: `CUSTOM_FURNITURE`, the footprint table for the procedural furniture, read by both the map builder and the web catalog.

**`packages/engine`** is pure and deterministic: no I/O, no timers, no `Math.random`. It uses seeded `mulberry32`, with a separate RNG stream for fire spread. Almost everything is in `world.ts` `createEngine`.
- **Step order:** `step()` runs scheduled events → fire → losses → perception (sight, smoke through walls, the 15 s smell) → instincts → movement → losses → ambient → end checks.
- **Tools:** `executeTool` validates every call and **never mutates state on a rejected call** (tests assert the hash is unchanged). Errors carry a code plus an actionable hint.
- **Knowledge:**
  - Each person has their own knowledge: `knows`, `known` cells and `alerted`.
  - `plannerView()` merges everyone's knowledge; `agentView(id)` is strictly personal.
  - Each view has its own wake logic and "seen" cursor: `needsDecision` / `markViewed` for the team view, `agentNeedsDecision` / `markAgentViewed` per person.
- **Instincts:** `EngineOptions.instincts` (default true) gates shout, flee, pulling the alarm in passing, and the no-re-entry block.
- **Route choice** (both modes, not an instinct): someone in an exit doorway or already outside who is sent somewhere outside walks around the building, never back through it. On the ground floor the indoor way from the west exit to the bus stop is shorter than the sidewalk, so without this rule people were routed back toward the fire.
- **Other modules:** `scoring.ts` (outcomes, metrics, debrief); `placement.ts` (`isFlammable`, placement validation); `map.ts` (`roomsOf` / `inEarshot`; voice reaches the same room only; rooms come from zone kinds); `places.ts` (`placesFor(map)`: human place, door and station names, outside/exit/non-flammable checks, the id-leak pattern, all read from the map); `routes.ts` (`routeBriefing(map)` for `consult_plan`).

**`apps/server`** runs Fastify plus a WebSocket:
- **`session.ts`:** the live loop (100 ms ticks), pause, placement, and replay of saved runs.
- **`orchestrator.ts`:** the decision loop shared by live play and headless runs.
  - Decisions go `beginDecision` → view → `provider.decide` → `executeTool`, and each one becomes a trace row.
  - Central mode uses a single decision slot. Agents mode gives each person their own slot and pins `actor_id` to the person deciding.
  - Headless agents mode asks everyone ready in parallel, then applies the answers in a fixed order.
  - The same file holds the story-beat filter for engine rows and the speech bubbles.
- **`headless.ts`:** lockstep episodes for bench/eval (the sim is frozen while waiting on the model).
- **`prompt.ts`:** the central planner prompts. Harness `v1` is the baseline; `v2` adds a state digest, per-turn action masking (`toolsFor`) and a procedure.
- **`agentPrompt.ts`:** the first-person prompt per person, their personal digest and their tool menu (agents mode only).
- **`providers/`:** `openaiCompatible.ts` (vLLM/hosted; parses native `tool_calls` with an XML/JSON content fallback; captures `reasoning_content`; sends `thinking_token_budget` only alongside `chat_template_kwargs`, and drops both on the "unknown field" 400 fallback; retries a context-length 400 with a smaller output budget) and `scripted.ts` (fixture policies for central and per-person decisions).
- **`runlog.ts`:** run logs in `runs/<episodeId>.jsonl`: header, tick-stamped inputs, trace rows, result, footer hash. Replays re-apply the recorded inputs and never call the model again.
- **`places.ts`:** `humanize()`, the last safety net for anything a viewer sees.

**`apps/web`** is React 19 + Vite. `src/vendor/pixel-agents/` is a vendored Canvas renderer (@3537e14, MIT); local changes are marked `// ESCAPE-PATCH`, and `THIRD_PARTY_NOTICES.md` lists the vendored files. The trace panel lives in `src/trace/`.

**`apps/eval`** contains `bench.ts` (dataset runs to `results/<dir>/summary.{md,json}` plus run logs), `replay.ts` and a compare tool.

**`data/`** holds:
- the map: `maps/office-v2.ascii` (tiles, zone letters) plus `office-v2.spec.ts` (zone names and kinds, doors, pull stations, spawns, furniture, decor), built by the generic `maps/builder.ts`. office-v1 is retired (git tag `office-v1-final`);
- the synthetic scenario dataset `escape-office-scenarios-v3`, built by `generator.ts` (per-map recipe in `SPECS`) with `DATASET_CARD.md` and `provenance.json`;
- paraphrased public knowledge cards (OSHA) used by `consult_plan` and the debrief.

## Invariants that are easy to break

- **Replay determinism.**
  - Any input that changes the engine other than `step()` must go through `recordInput`: `begin`, `view` (with `actor` in agents mode), `tool`, `note`, `place`, `end`.
  - Any new `EngineOptions` field must be written to the run header and passed through `replayEngineOptions` in `runlog.ts`, or replays diverge.
- **The map is the single source of truth.** Zone, door and station names, which zones are outside, exits or non-flammable, and the id lists all come from the map JSON. To add or rename a place, edit the spec/ASCII and run `npm run data:map` (then `npm run data:scenarios`); never add a hand-kept name table. Moving furniture changes the map hash in `provenance.json` even when the cases stay the same.
- **Engine API changes.** New `Engine` methods need stubs in `apps/server/test/fakeEngine.ts`.
- **Viewer-facing text** (trace engine rows, bubbles, debrief) must never contain evidence ids (`E1`), zone ids (`rh_room`), action ids (`A-007`) or coordinates; tests check this with `idLeakRegex(map)` (`apps/server/test/idLeak.ts`). Planner-facing text keeps the ids, because the model needs them for `evidence_ids` and `route_id`.
- **Honesty conventions.**
  - Engine instinct rows carry the origin `Instinct (engine — not the model)` and must never be attributed to the model.
  - Scripted runs are always labelled as fixtures.
  - Numbers in `README.md` / `docs/tech-stack.md` come only from measured runs saved under `results/`. Fire tuning or rule changes invalidate earlier tables until they are re-measured.
- **Fire tuning** lives in the constants at the top of `world.ts` (`FIRE_SPREAD_PER_TICK`, `WALL_IGNITION_FACTOR`, `DOOR_IGNITION_FACTOR`). `packages/engine/test/fire.test.ts` pins the growth bands, the wall delay and room-to-room reach times, using the setups in `packages/engine/test/fireSetups.ts` (`FIRE_SITES`).
  - Wall hold time scales as 1 / (spread × wall factor). To change the spread speed without changing how long walls hold, scale the wall factor inversely.
  - Before re-pinning, measure the new medians with the same seeds and setups as the tests: `npx tsx scripts/measure-fire.ts`.
  - A retune also flips seeded outcomes in other engine tests (`tools.test.ts`, `agents.test.ts`).
  - Run headers do not record the fire constants, so every run log recorded before a retune diverges on replay.
- **The hero scenario.** `data/scenarios/demo-hero.json` holds the five demo spawns and no events: the presenter places hazards live. `hero-story.json` is the scripted story (fire in the cubicles at t = 1 s at (10,17); the reception door at (31,12) loses power when anyone enters the hallway). `heroStoryCase` combines them into `dev-00-hero` for the bench and the integration tests (`apps/server/test/*.integration.test.ts`). After editing scenarios, run `npm run data:scenarios`.
  - `runs/demo-hero.jsonl` (the runbook's backup replay) is a live agents-mode run on office-v2. Any engine change that alters behaviour (fire tuning, routing) makes it diverge on replay: re-record it from a live run.
- **Secrets.** `.env` holds `PLANNER_API_KEY` (the vLLM key) and `NVIDIA_HOSTED_API_KEY`. Keys stay server-side; the browser never receives them.
