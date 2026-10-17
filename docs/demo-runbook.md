# Demo runbook (live demo + 3–5 min recording)

The submission deadline is **Sun Oct 18, 11:00 a.m. ET**; that is also code freeze. Aim to submit by 10:30. Judging starts at 11:15.

## Honesty rules (non-negotiable)

- **Inference is real time.** Never speed up footage that contains model calls.
- **Label cuts.** If we cut over a wait, add an on-screen label: "cut: ~N s of model latency".
- **Label replays.** A replay must show the **REPLAY** badge and be called a replay in the voice-over.
- **The top bar must show the real provider.** "Nemotron · self-hosted vLLM" is the submission configuration. If we fall back to the hosted catalog, say so on screen.
- **No invented numbers.** Every number in the video comes from `results/` or `deploy/vllm/MODEL_MANIFEST.md`.
- **The team appears on camera.**

## Pre-flight (T−30 min)

1. Brev instance running:
   - `docker ps` on the VM shows `escape-nemotron`.
   - `deploy/vllm/check.sh` passes: model listing, tool call, recovery, latency.
2. Tunnel up on the laptop running the game backend: `brev port-forward escape-nemotron --port 8001:8000`.
3. `.env` set:
   - `PLANNER_PROVIDER=openai-compatible`
   - `PLANNER_ENDPOINT_KIND=self-hosted-vllm`
   - `PLANNER_THINKING=false`
   - `DEMO_CASE=demo-hero`
4. `npm run dev`, then open http://localhost:5173 at **1920×1080** (also check 1440×900).
   - Browser zoom 100%.
   - Hide bookmarks.
   - Silence notifications.
5. The top bar shows the model as healthy. Do one throw-away hero run to warm the prefix cache, then press **Reset**. Only ONE browser tab on the app: every tab shares the live server, so a pause or reset in another tab affects the recording.
6. Sound on (the alarm siren) unless the mute toggle is used.
7. Recording: OBS or QuickTime at 1080p30. The mic is tested.
8. Backup: the latest good run log is in `runs/` (for a labeled replay), and the backup local video file is on the desktop.

## Live core loop (60–90 s), minute by minute (ruleset 2)

| t | Action | What to point at |
|---|---|---|
| 0:00 | Start screen → click the glowing floor. Calm office: Alex at the warden desk, Maya near door A, Daniel at his desk in the wheelchair | "Three characters. One Nemotron planner decides for all of them through tools." Point out the single red pull station in the hallway and the sliding doors |
| 0:05 | Drag **Fire** onto the floor just inside **door A**, next to Maya (green ghost = valid) | The placement ghost. The fire starts spreading tile by tile |
| 0:08 | Maya sees it (engine observation E1) | Trace: engine row "Maya observed fire (E1)" |
| 0:10 | **Nemotron planner → Maya → notify**(all, fire, [E1]) — heard by Daniel (same room) but not Alex (lobby). Someone heads to the hallway pull station and **pull_alarm** → siren + red strobes, now Alex is alerted | "Voice only carries within a room — the alarm is the only way to reach the lobby. It doesn't say where the fire is; notify does." |
| 0:15 | People start moving; Daniel may request Alex as his buddy (optional) | "Consent first, no carrying. The fire keeps spreading — speed matters." |
| 0:30 | Alex (with Daniel) heads through the NVIDIA lobby toward the east exit; Maya evacuates | Movement driven by accepted `move` rows |
| 0:35 | When they are in the **lobby**, drag **⚡ Electrical failure** onto the **south sliding door** (or run `node scripts/auto-electrical.mjs` beforehand) | The door jams shut with sparks |
| 0:38 | Move stops safely: **ROUTE_UNAVAILABLE** (E2) | The red failed row, then the "↻ recovered" badge on the next row |
| 0:40 | notify(route_blocked) → plan_route → move via connector, north corridor, west exit | The alternate route on the map, away from the spreading fire |
| 1:00 | check_in × survivors → Alex **verify_roster** → success (or partial, if someone was lost) | "Only the roster verification can end it — and nobody is assumed safe." |
| 1:10 | Debrief: source-linked lessons + metrics | Alarm (1910.165 / 1910.38(d)), routes and jammed doors, accountability, with OSHA citations |
| optional | Reset, drop a fire right next to someone who hasn't been alerted | The disintegration and a `partial` outcome — why early alarm matters |

If the model takes a different valid path, narrate what it actually did. Don't redo takes until it matches a script.

## Video structure (3–5 min)

| Time | Segment |
|---|---|
| 0:00–0:25 | Team on camera: who we are, the problem |
| 0:25–0:50 | Pitch: "Most evacuation material tells you the procedure. We let you change an office emergency — a spreading fire, a failed door — and watch how the alarm, route updates, assistance and accountability change the outcome." Then what's real and what's not (the fire is a game model, not fire science) |
| 0:50–2:15 | Live core loop (above) |
| 2:15–3:30 | Engineering: architecture diagram (README), tool validator and information boundaries, vLLM config and measured latency (MODEL_MANIFEST), benchmark dev/test table (`results/…/summary.md`), replay (labeled) |
| 3:30–4:15 | Why it matters, known limitations, next steps (customer floor plans, Gym/RL) |

## Submission checklist (Airtable form)

**Repo:**
- Public on GitHub, with the README covering quick start, stack and diagram, reproduction and env, data provenance, limitations.
- Team roster filled in (README "Team" section).

**Video:** unlisted YouTube, 3–5 min. Paste the link into the README.

**Form fields:**
- Track: **Tool-Calling**.
- AI models: Nemotron 3.5 Lightning 30B-A3B (BF16) via vLLM 0.27.1.
- Tools: vLLM, Brev, (NeMo Gym only if built).

**Bounties.** Only tick these where we can show evidence:
- Nemotron: explanation text.
- vLLM: config and measurements.
- Gym: only with baseline vs final on held-out tasks.

**Before 11:00:** final push, check the repo opens in a private window, submit.
