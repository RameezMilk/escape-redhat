import { useEffect, useState, useSyncExternalStore } from 'react';

import type { ProviderInfo, Snapshot } from '@escape/contracts';

import { isMuted, onMuteChange, setMuted, startSiren, stopSiren } from '../audio/siren';
import { send } from '../net/socket';
import { useStore } from '../state/store';

function outcomeLabel(s: Snapshot): string {
  const o = s.outcome!;
  const escaped = s.actors.filter((a) => !a.lost && a.checkedIn).length;
  switch (o.status) {
    case 'success':
      return 'Success';
    case 'partial':
      return `Partial — ${escaped}/3 escaped`;
    case 'failed':
      return 'All lost';
    default:
      return o.status.replace(/_/g, ' ');
  }
}

const PHASE_LABEL: Record<string, string> = {
  idle: 'Calm office',
  incident: 'Incident noticed',
  evacuating: 'Evacuating',
  accounting: 'Accounting',
  ended: 'Ended',
};

function providerChip(p: ProviderInfo | null, source: 'live' | 'fixture', replay: boolean): { text: string; tone: 'ok' | 'warn' | 'bad' } {
  if (source === 'fixture') return { text: 'FIXTURE — canned UI data, not a model', tone: 'bad' };
  if (replay) return { text: 'REPLAY of a saved run — no model calls now', tone: 'warn' };
  if (!p) return { text: 'Planner: unknown', tone: 'warn' };
  if (p.endpointKind === 'scripted') return { text: 'SCRIPTED fixture — not a model', tone: 'bad' };
  if (p.healthy === false) return { text: `Model unreachable · ${p.label}${p.healthDetail ? ` (${p.healthDetail})` : ''}`, tone: 'bad' };
  const kind = p.endpointKind === 'self-hosted-vllm' ? 'vLLM self-hosted' : 'hosted API';
  const p50 = p.p50LatencyMs !== undefined ? ` · p50 ${(p.p50LatencyMs / 1000).toFixed(1)} s` : '';
  const think = p.thinking ? ` · reasoning on${p.thinkingBudget ? ` (≤${p.thinkingBudget} tokens)` : ''}` : '';
  const who = p.mode === 'agents' ? ' · each person decides' : '';
  return { text: `${p.label} · ${kind}${who}${p50}${think}`, tone: p.healthy ? 'ok' : 'warn' };
}

export function TopBar() {
  const snapshot = useStore((s) => s.snapshot);
  const provider = useStore((s) => s.provider);
  const connection = useStore((s) => s.connection);
  const source = useStore((s) => s.source);
  const cases = useStore((s) => s.cases);
  const [caseId, setCaseId] = useState<string>('');

  const chip = providerChip(provider, source, snapshot?.mode === 'replay');
  const paused = snapshot?.paused ?? false;
  const phase = snapshot?.outcome ? outcomeLabel(snapshot) : PHASE_LABEL[snapshot?.phase ?? 'idle'];
  const alarmOn = !!snapshot?.alarm?.active && !snapshot?.outcome;
  const muted = useSyncExternalStore(onMuteChange, isMuted);

  // Siren follows the alarm: plays while active and running; stops on pause, mute, episode end or reset.
  const sirenOn = alarmOn && !paused && !muted && snapshot?.mode !== 'replay';
  useEffect(() => {
    if (sirenOn) startSiren();
    else stopSiren();
  }, [sirenOn]);
  useEffect(() => () => stopSiren(), []);
  const selectedCase = caseId || snapshot?.caseId || '';

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-hat" aria-hidden>
          ▲
        </span>
        <h1>Escape from Red Hat</h1>
        <span className="brand-sub">evacuation exercise · fictional office</span>
      </div>
      <div className="tb-status">
        <span className={`phase phase-${snapshot?.outcome?.status ?? snapshot?.phase ?? 'idle'}`}>{phase}</span>
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
        <select
          className="case-select"
          value={selectedCase}
          onChange={(e) => setCaseId(e.target.value)}
          title="Scenario (from the published scenario dataset)"
        >
          {cases.length === 0 ? <option value={selectedCase}>{selectedCase || 'demo-hero'}</option> : null}
          {cases.map((c) => (
            <option key={c.caseId} value={c.caseId}>
              {c.caseId} · {c.split}/{c.family}
            </option>
          ))}
        </select>
        <button className="btn btn-reset" onClick={() => send({ type: 'reset', caseId: selectedCase || undefined })}>
          ↺ Reset
        </button>
      </div>
      <div className={`provider-chip tone-${chip.tone}`} title={provider?.baseUrl ?? ''}>
        <span className={`conn conn-${connection}`} title={`server ${connection}`} />
        {chip.text}
      </div>
    </header>
  );
}
