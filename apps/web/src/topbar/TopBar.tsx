import { useEffect, useMemo, useSyncExternalStore } from 'react';

import type { RunSummary } from '@escape/contracts';
import { loadMap } from '@escape/engine';

import { isMuted, onMuteChange, setMuted, startSiren, stopSiren } from '../audio/siren';
import { send } from '../net/socket';
import { useStore } from '../state/store';

/** "Recorded demo run" for the committed backup (runs/demo-hero.jsonl); otherwise scenario · outcome · time. */
function runLabel(r: RunSummary): string {
  const outcome = r.outcome ? r.outcome.replace(/_/g, ' ') : 'unfinished';
  if (r.runId === 'demo-hero') return `Recorded demo run · ${outcome}`;
  const when = new Date(r.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${r.caseId} · ${outcome} · ${when}${r.scripted ? ' · scripted' : ''}`;
}

export function TopBar() {
  const snapshot = useStore((s) => s.snapshot);
  const provider = useStore((s) => s.provider);
  const paused = snapshot?.paused ?? false;
  const runs = useStore((s) => s.runs);
  const mapHash = useMemo(() => loadMap().hash, []);
  // Finished runs recorded on this map (older maps would drift on replay; runs reset part-way are left out): the
  // recorded demo first, then the latest, skipping the episode log the demo was copied from.
  const replays = useMemo(() => {
    const ok = runs.filter((r) => r.outcome && r.outcome !== 'aborted' && r.mapHash === mapHash);
    const demo = ok.filter((r) => r.runId === 'demo-hero');
    const rest = ok.filter((r) => r.runId !== 'demo-hero' && !demo.some((d) => d.createdAt === r.createdAt));
    return [...demo, ...rest.slice(0, 8)];
  }, [runs, mapHash]);
  const alarmOn = !!snapshot?.alarm?.active && !snapshot?.outcome;
  // Live cue: a hazard has been placed and the run is going (not paused, ended or a replay).
  const live = !!snapshot && snapshot.hazards.length > 0 && !snapshot.outcome && !paused && snapshot.mode !== 'replay';
  const muted = useSyncExternalStore(onMuteChange, isMuted);

  // Siren follows the alarm: plays while active and running; stops on pause, mute, episode end or reset.
  const sirenOn = alarmOn && !paused && !muted && snapshot?.mode !== 'replay';
  useEffect(() => {
    if (sirenOn) startSiren();
    else stopSiren();
  }, [sirenOn]);
  useEffect(() => () => stopSiren(), []);

  return (
    <header className="topbar">
      <div className="brand">
        <h1>Escape from Red Hat</h1>
      </div>
      <div className="tb-status">
        {alarmOn ? (
          <span className="alarm-badge" title="Fire alarm active — everyone has been alerted to evacuate">
            🚨 ALARM
          </span>
        ) : null}
        <span className="clock" title="Elapsed simulated time (no time limit; separate from model latency)">
          elapsed {snapshot ? snapshot.simTime.toFixed(1) : '0.0'}s
        </span>
        <span className="decisions" title="Planner decisions used / cap">
          decisions {snapshot?.decisions.used ?? 0}/{snapshot?.decisions.max ?? '—'}
          {snapshot?.decisions.inFlight ? <span className="thinking"> · {provider?.mode === 'agents' ? 'thinking…' : 'planner thinking…'}</span> : null}
        </span>
        {live ? (
          <span className="live-pill" title="Live simulation: the fire and the people are moving in real time">
            <span className="live-dot" aria-hidden />
            LIVE
          </span>
        ) : null}
      </div>
      <div className="tb-controls">
        <button
          className={`btn btn-icon ${muted ? 'muted' : ''}`}
          onClick={() => setMuted(!muted)}
          title={muted ? 'Siren muted — click to unmute' : 'Mute the alarm siren'}
          aria-label={muted ? 'Unmute siren' : 'Mute siren'}
        >
          {muted ? '🔇' : '🔊'}
        </button>
        <button className="btn" onClick={() => send({ type: paused ? 'resume' : 'pause' })} disabled={!snapshot || !!snapshot.outcome}>
          {paused ? '▶ Resume' : '❚❚ Pause'}
        </button>
        <select
          className="replay-select"
          value=""
          onChange={(e) => e.target.value && send({ type: 'replay', runId: e.target.value })}
          disabled={!replays.length}
          title="Replay a saved run: the recorded decisions play back, with no model calls"
        >
          <option value="">{replays.length ? '⟲ Replay a saved run…' : 'No saved runs to replay'}</option>
          {replays.map((r) => (
            <option key={r.runId} value={r.runId}>
              {runLabel(r)}
            </option>
          ))}
        </select>
        <button className="btn btn-reset" onClick={() => send({ type: 'reset', caseId: snapshot?.caseId || undefined })}>
          ↺ Reset
        </button>
      </div>
    </header>
  );
}
