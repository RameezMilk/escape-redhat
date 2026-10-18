// Completion overlay: actual outcome (never inferred from model claims), measured metrics, three source-linked lessons.
import { ACTOR_IDS } from '@escape/contracts';
import { useState } from 'react';

import { send } from '../net/socket';
import { useStore } from '../state/store';

const OUTCOME: Record<string, { title: string; tone: string }> = {
  success: { title: 'Everyone made it out', tone: 'good' },
  partial: { title: 'Partial', tone: 'warn' },
  failed: { title: 'Nobody made it out', tone: 'bad' },
  incomplete: { title: 'Incomplete — safety stop', tone: 'warn' },
  unresolved: { title: 'Unresolved — no safe route', tone: 'bad' },
  aborted: { title: 'Aborted', tone: 'bad' },
};

const fmtS = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v.toFixed(1)} s`);
const fmtMs = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${Math.round(v)} ms`);

export function DebriefOverlay() {
  const result = useStore((s) => s.result);
  const runs = useStore((s) => s.runs);
  const snapshot = useStore((s) => s.snapshot);
  const [hiddenFor, setHiddenFor] = useState<string | null>(null);

  if (!result || snapshot?.mode === 'replay') return null;
  if (hiddenFor === result.episodeId) {
    return (
      <button className="btn show-debrief" onClick={() => setHiddenFor(null)}>
        Show debrief
      </button>
    );
  }
  const m = result.metrics;
  const base = OUTCOME[result.outcome.status] ?? { title: result.outcome.status, tone: 'warn' };
  const o = result.outcome.status === 'partial' ? { ...base, title: `Partial — ${m.procedural.escaped} of ${ACTOR_IDS.length} escaped` } : base;
  const alarm = snapshot?.alarm;
  const alarmText = m.procedural.alarmRaised
    ? `${alarm?.by ? alarm.by[0].toUpperCase() + alarm.by.slice(1) : 'yes'}${m.procedural.alarmLatencySimSec !== null ? ` · +${m.procedural.alarmLatencySimSec.toFixed(1)} s` : ''}`
    : 'not raised';
  const run = runs.find((r) => r.runId === result.episodeId) ?? runs.find((r) => r.caseId === result.caseId) ?? runs[0];

  return (
    <div className="debrief-backdrop">
      <div className={`panel debrief tone-${o.tone}`} role="dialog" aria-label="Exercise debrief">
        <div className="debrief-banner">
          <div className="debrief-kicker">Exercise result · {result.caseId}</div>
          <h2>{o.title}</h2>
          <p className="debrief-reason">{result.outcome.reason}</p>
        </div>
        <div className="metrics">
          <div>
            <b>
              {m.procedural.escaped}/{ACTOR_IDS.length}
            </b>
            <span>escaped (checked in)</span>
          </div>
          <div>
            <b>{m.procedural.lost}</b>
            <span>lost to the fire</span>
          </div>
          <div>
            <b>{alarmText}</b>
            <span>fire alarm raised (after first sighting)</span>
          </div>
          <div>
            <b>{m.decisions}</b>
            <span>planner decisions</span>
          </div>
          <div>
            <b>
              {m.validCalls}/{m.toolCalls}
            </b>
            <span>valid tool calls</span>
          </div>
          <div>
            <b>{m.recoveries}</b>
            <span>recoveries (after a rejected call or blocked route)</span>
          </div>
          <div>
            <b>{fmtMs(m.latencyMsP50)}</b>
            <span>model p50 latency</span>
          </div>
          <div>
            <b>{fmtS(m.simTimeToComplete ?? m.simTime)}</b>
            <span>simulated time · {(m.wallTimeMs / 1000).toFixed(0)} s wall</span>
          </div>
          <div>
            <b>{m.procedural.rosterVerified ? 'yes' : 'no'}</b>
            <span>roster verified</span>
          </div>
        </div>
        <h3 className="lessons-title">What this run shows</h3>
        <ol className="lessons">
          {result.debrief.slice(0, 3).map((l) => (
            <li key={l.id}>
              <div className="lesson-title">{l.title}</div>
              <p>{l.text}</p>
              <div className="lesson-sources">
                {l.ruleIds.map((r) => (
                  <code key={r}>{r}</code>
                ))}
                {l.sources.map((s) => (
                  <a key={s.url} href={s.url} target="_blank" rel="noreferrer">
                    {s.label} ↗
                  </a>
                ))}
              </div>
            </li>
          ))}
        </ol>
        <p className="debrief-disclaimer">
          Simulated exercise in a fictional office. Lessons are illustrative and source-linked; this is not a compliance assessment
          or a prediction of real behaviour.
        </p>
        <div className="debrief-actions">
          {run ? (
            <button className="btn" onClick={() => send({ type: 'replay', runId: run.runId })} title={`Replay saved run ${run.runId}`}>
              ⟲ Replay saved run
            </button>
          ) : null}
          <button className="btn btn-reset" onClick={() => send({ type: 'reset', caseId: result.caseId })}>
            ↺ Reset
          </button>
          <button className="btn ghost" onClick={() => setHiddenFor(result.episodeId)}>
            View final state
          </button>
        </div>
      </div>
    </div>
  );
}
