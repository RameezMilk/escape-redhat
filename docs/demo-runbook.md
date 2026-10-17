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
   - `docker ps` shows `nemotron-vllm`.
   - `deploy/vllm/check.sh` passes: model listing, tool call, recovery, latency.
2. Tunnel up: `ssh -N -L 8000:localhost:8000 <brev-instance>`.
3. `.env` set:
   - `PLANNER_PROVIDER=openai-compatible`
   - `PLANNER_ENDPOINT_KIND=self-hosted-vllm`
   - `PLANNER_THINKING=false`
   - `DEMO_CASE=demo-hero`
4. `npm run dev`, then open http://localhost:5173 at **1920×1080** (also check 1440×900).
   - Browser zoom 100%.
   - Hide bookmarks.
   - Silence notifications.
5. The top bar shows the model as healthy. Do one throw-away hero run to warm the prefix cache, then press **Reset**.
6. Recording: OBS or QuickTime at 1080p30. The mic is tested.
7. Backup: the latest good run log is in `runs/` (for a labeled replay), and the backup local video file is on the desktop.

## Live core loop (60–90 s), minute by minute

| t | Action | What to point at |
|---|---|---|
| 0:00 | Calm office. Alex at the warden desk, Maya near door A, Daniel at his desk in the wheelchair | "Three characters. One Nemotron planner decides for all of them through tools." |
| 0:05 | Drag **Fire** onto the floor just inside **door A**, next to Maya (green ghost = valid) | The placement ghost. Note the invalid red ghost on walls or furniture |
| 0:08 | Maya sees it (engine observation E1) | Trace: engine row "Maya observed fire (E1)" |
| 0:10 | **Nemotron planner → Maya → notify**(all, fire, [E1]) | Bubble over Maya. Alex and Daniel become alerted |
| 0:15 | consult_plan / request_assistance (Daniel → Alex) / Alex moves to Daniel / assist | "Daniel asked for his agreed buddy. Consent first, no carrying." |
| 0:30 | Alex escorts Daniel toward the east exit; Maya evacuates | Movement driven by accepted `move` rows |
| 0:35 | When the pair enters the **NVIDIA lobby**, drag **Blocker** into the **south branch** | |
| 0:38 | Move stops safely: **ROUTE_UNAVAILABLE** (E2) | The red failed row, then the "↻ recovered" badge on the next row |
| 0:40 | notify(route_blocked) → plan_route → move via connector, north corridor, west exit | The alternate route on the map |
| 1:00 | check_in × 3 → Alex **verify_roster** → success | "Only the roster verification can end it successfully." |
| 1:10 | Debrief: three source-linked lessons + metrics | Reporting, re-routing, assistance and accountability, with OSHA citations |

If the model takes a different valid path, narrate what it actually did. Don't redo takes until it matches a script.

## Video structure (3–5 min)

| Time | Segment |
|---|---|
| 0:00–0:25 | Team on camera: who we are, the problem |
| 0:25–0:50 | Pitch: "Most evacuation material tells you the procedure. We let you change an office emergency and watch how reporting, route updates, assistance and accountability change the outcome." Then what's real and what's not |
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
