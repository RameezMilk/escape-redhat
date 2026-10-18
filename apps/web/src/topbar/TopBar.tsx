import { useEffect, useSyncExternalStore } from 'react';

import { isMuted, onMuteChange, setMuted, startSiren, stopSiren } from '../audio/siren';
import { send } from '../net/socket';
import { useStore } from '../state/store';

export function TopBar() {
  const snapshot = useStore((s) => s.snapshot);
  const provider = useStore((s) => s.provider);
  const paused = snapshot?.paused ?? false;
  const alarmOn = !!snapshot?.alarm?.active && !snapshot?.outcome;
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
        <button className="btn btn-reset" onClick={() => send({ type: 'reset', caseId: snapshot?.caseId || undefined })}>
          ↺ Reset
        </button>
      </div>
    </header>
  );
}
