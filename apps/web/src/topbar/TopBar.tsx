import { useState } from 'react';

import type { ProviderInfo } from '@escape/contracts';

import { send } from '../net/socket';
import { useStore } from '../state/store';

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
  const think = p.thinking ? ' · thinking on' : '';
  return { text: `${p.label} · ${kind}${p50}${think}`, tone: p.healthy ? 'ok' : 'warn' };
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
  const phase = snapshot?.outcome ? snapshot.outcome.status.replace('_', ' ') : PHASE_LABEL[snapshot?.phase ?? 'idle'];
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
        <span className="clock" title="Simulated time (separate from model latency)">
          sim {snapshot ? snapshot.simTime.toFixed(1) : '0.0'}s
        </span>
        <span className="decisions" title="Planner decisions used / cap">
          decisions {snapshot?.decisions.used ?? 0}/{snapshot?.decisions.max ?? '—'}
          {snapshot?.decisions.inFlight ? <span className="thinking"> · planner thinking…</span> : null}
        </span>
      </div>
      <div className="tb-controls">
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
