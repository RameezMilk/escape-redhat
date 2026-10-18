# Demo runbook (live demo + 3–5 min recording)

The submission deadline is **Sun Oct 18, 11:00 a.m. ET**; that is also code freeze. Aim to submit by 10:30. Judging starts at 11:15.

## Honesty rules (non-negotiable)

- **Inference is real time.** Never speed up footage that contains model calls.
- **Label cuts.** If we cut over a wait, add an on-screen label: "cut: ~N s of model latency".
- **Label replays.** A replay must show the **REPLAY** badge and be called a replay in the voice-over.
- **Name the real provider.** The UI no longer shows the model name, so say it in the voice-over: "Nemotron 3.5 Lightning 30B-A3B on our self-hosted vLLM" is the submission configuration. The UI still labels the scripted fixture ("SCRIPTED — not a model" in the trace header) and replays (the REPLAY badge on the stage). If we fall back to the hosted catalog, say so on screen.
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
   - `PLANNER_MODE=agents` (each person is their own Nemotron call)
   - Start the server with `PLANNER_AGENT_FREEZE_WHILE_THINKING=false` for real-time pressure
   - `DEMO_CASE=demo-hero`
4. `npm run dev`, then open http://localhost:5173 at **1920×1080** (also check 1440×900). The whole ground floor and the street fit the stage, so sprites are drawn a little smaller than on the old one-room map.
   - Browser zoom 100%.
   - Hide bookmarks.
   - Silence notifications.
5. The server's startup line says `health: OK (model escape-nemotron listed)`, and the trace panel header shows no "model unreachable" or "server disconnected" warning. Do one throw-away hero run to warm the prefix cache, then press **Reset**. Only ONE browser tab on the app: every tab shares the live server, so a pause or reset in another tab affects the recording.
6. Sound on (the alarm siren) unless the mute toggle is used.
7. Recording: OBS or QuickTime at 1080p30. The mic is tested.
8. Backup: the latest good run log is in `runs/` (for a labeled replay), and the backup local video file is on the desktop.

## Live core loop (60–90 s), minute by minute

| t | Action | What to point at |
|---|---|---|
| 0:00 | Start screen → click the glowing **ground floor**. Calm office: Alex (the warden) and Maya at the cubicles, Daniel visiting the Red Hat conference room, Rosa at the front desk, Kenji in the GPU server room | "Five people, one floor, one model deciding through tools." Point out the two red pull stations (main hallway, reception), the sliding doors, and the bus stop across the street where everyone meets |
| 0:05 | Drag **Fire** anywhere inside — e.g. into the cubicles beside Maya, or the GPU server room by Kenji (green ghost = valid) | The fire starts spreading tile by tile |
| 0:07 | Whoever sees it decides for themselves: warn the room, head for a pull station, or get out. Nobody in the other rooms knows yet | Trace: that person's own Nemotron call with their reasoning. "Maya only knows what Maya has seen." |
| 0:10 | Someone chooses to pull a fire alarm | Siren and red strobes: "the alarm is the only way to reach the other rooms, and it doesn't say where the fire is" |
| 0:20 | Daniel, Rosa and Kenji are alerted by the siren; Nemotron routes everyone out — main entrance, west exit or the kitchen back exit, away from the fire | Tool pills: `move` rows with one-line plain-English summaries |
| 0:30 | When someone crosses the main hallway toward reception, drag **⚡ Electrical failure** onto the **reception door** (or run `node scripts/auto-electrical.mjs` beforehand; `--door` / `--when-zone` pick another) | The door jams shut with sparks |
| 0:33 | The move stops safely — the trace says why ("the reception door is dead") | The failed row, then the "↻ recovered" badge on the next row |
| 0:35 | Re-plan through the cubicles and the reception side door, or the west exit; nobody goes back inside | The alternate route on the map; the fire climbing the walls behind them |
| 1:00 | Everyone crosses at the crosswalk to the bus stop → check_in × survivors → Alex **verify_roster** → success (or partial) | "Only the roster verification can end it — and nobody is assumed safe." |
| 1:10 | Debrief: source-linked lessons + metrics | Alarm (1910.165 / 1910.38(d)), routes and jammed doors, accountability, with OSHA citations |
| optional | Reset, cut power to the GPU server-room door, then start a fire inside | The room has one door: Kenji is trapped — a `partial` outcome, and why early alarm and second exits matter |

If the model takes a different valid path, narrate what it actually did. Don't redo takes until it matches a script.

## Video structure (3–5 min)

| Time | Segment |
|---|---|
| 0:00–0:25 | Team on camera: who we are, the problem |
| 0:25–0:50 | Pitch: "Most evacuation material tells you the procedure. We let you change an office emergency — a spreading fire, a failed door — and watch how the alarm, route updates, assistance and accountability change the outcome." Then what's real and what's not (the fire is a game model, not fire science) |
| 0:50–2:15 | Live core loop (above) |
| 2:15–3:30 | Engineering: architecture diagram (README), tool validator and information boundaries (model proposes, engine decides; one call per person), vLLM config and measured latency/throughput ([`tech-stack.md`](tech-stack.md)), benchmark dev/test table (`results/…/summary.md`), replay (labeled) |
| 3:30–4:15 | Why it matters, known limitations, next steps (customer floor plans, RL fine-tuning) |

## Submission checklist (Airtable form)

**Repo:**
- Public on GitHub, with the README covering quick start, stack and diagram, reproduction and env, data provenance, limitations.
- Team roster filled in (README "Team" section).

**Video:** unlisted YouTube, 3–5 min. Paste the link into the README.

**Form fields:**
- Track: **Tool-Calling**.
- AI models: Nemotron 3.5 Lightning 30B-A3B (BF16) via vLLM 0.27.1.
- Tools: vLLM, Brev.

**Bounties.** Only tick these where we can show evidence:
- Nemotron: explanation text.
- vLLM: config and measurements.

**Before 11:00:** final push, check the repo opens in a private window, submit.
