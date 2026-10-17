// Live agent/tool trace: every real proposal, validation result and engine event, labelled by true origin.
import { useEffect, useMemo, useRef, useState } from 'react';

import type { ActorId, TraceRow } from '@escape/contracts';

import { ACTOR_ORDER, ACTOR_VIEW } from '../office/actors';
import { useStore } from '../state/store';

type Filter = 'all' | ActorId | 'engine';

const STATUS_LABEL: Record<TraceRow['status'], string> = {
  proposed: 'proposed',
  held: 'held (paused)',
  accepted: 'accepted',
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  rejected: 'rejected',
  malformed: 'malformed',
  provider_error: 'provider error',
  discarded_stale: 'discarded (stale)',
  ignored: 'ignored',
  info: 'event',
};

function fmtVal(v: unknown): string {
  if (typeof v === 'string') return v.length > 48 ? `"${v.slice(0, 46)}…"` : `"${v}"`;
  if (Array.isArray(v)) return `[${v.map(fmtVal).join(', ')}]`;
  if (v && typeof v === 'object') return '{…}';
  return String(v);
}

function compactArgs(args?: Record<string, unknown>): string {
  if (!args) return '';
  return Object.entries(args)
    .filter(([k]) => k !== 'reason_summary' && k !== 'actor_id')
    .map(([k, v]) => `${k}: ${fmtVal(v)}`)
    .join(', ');
}

function Row({ row }: { row: TraceRow }) {
  const [open, setOpen] = useState(false);
  const actor = row.actor ? ACTOR_VIEW[row.actor] : null;
  const isEngine = row.kind === 'engine';
  const errorCode = row.result && !row.result.ok ? row.result.error.code : null;
  const hint = row.result && !row.result.ok ? row.result.error.hint : null;
  return (
    <li
      className={`trace-row ${isEngine ? 'engine' : 'decision'} status-${row.status} ${row.recovered ? 'recovered' : ''}`}
      style={actor ? { ['--actor' as string]: actor.color } : undefined}
    >
      <div className="tr-head">
        <span className="tr-origin">{row.origin}</span>
        <span className={`pill pill-${row.status}`}>{STATUS_LABEL[row.status]}</span>
      </div>
      {!isEngine && row.tool ? (
        <div className="tr-call">
          <span className="tr-tool">{row.tool}</span>
          <span className="tr-args">({compactArgs(row.args)})</span>
        </div>
      ) : null}
      <div className="tr-summary">
        {errorCode ? <code className="err-code">{errorCode}</code> : null} {row.summary}
      </div>
      {hint ? <div className="tr-hint">hint: {hint}</div> : null}
      {row.reasonSummary ? (
        <div className="tr-reason">
          <span className="tr-reason-label">stated reason</span> <em>{row.reasonSummary}</em>
        </div>
      ) : null}
      <div className="tr-meta">
        {row.decisionId ? <span>{row.decisionId}</span> : null}
        {row.actionId ? <span>{row.actionId}</span> : null}
        {row.eventSeq !== undefined ? <span>ev#{row.eventSeq}</span> : null}
        <span>sim {row.simTime.toFixed(1)}s</span>
        {row.latencyMs !== undefined ? <span>model {Math.round(row.latencyMs)} ms</span> : null}
        {row.usage?.completionTokens !== undefined ? (
          <span>
            {row.usage.promptTokens ?? '?'}→{row.usage.completionTokens} tok
          </span>
        ) : null}
        {row.parseMode === 'content-fallback' ? <span className="warn">parsed from text</span> : null}
        {row.evidenceIds?.map((e) => (
          <span key={e} className="evidence">
            {e}
          </span>
        ))}
        {row.recovered ? <span className="recovered-badge">↻ recovered</span> : null}
        <button className="tr-expand" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? 'hide' : 'details'}
        </button>
      </div>
      {open ? (
        <pre className="tr-json">
          {JSON.stringify(
            {
              ids: { episode: row.episodeId, decision: row.decisionId, action: row.actionId, event: row.eventSeq },
              provider: row.provider,
              args: row.args,
              result: row.result,
              raw: row.raw,
            },
            null,
            2,
          )}
        </pre>
      ) : null}
    </li>
  );
}

export function TracePanel() {
  const trace = useStore((s) => s.trace);
  const provider = useStore((s) => s.provider);
  const [filter, setFilter] = useState<Filter>('all');
  const listRef = useRef<HTMLOListElement>(null);
  const [pinned, setPinned] = useState(true);

  const rows = useMemo(
    () =>
      trace.filter((r) => {
        if (filter === 'all') return true;
        if (filter === 'engine') return r.kind === 'engine';
        return r.actor === filter;
      }),
    [trace, filter],
  );

  const counts = useMemo(() => {
    const decisions = trace.filter((r) => r.kind === 'decision');
    return {
      decisions: new Set(decisions.map((r) => r.decisionId)).size,
      rejected: decisions.filter((r) => r.status === 'rejected' || r.status === 'malformed').length,
      recovered: decisions.filter((r) => r.recovered).length,
    };
  }, [trace]);

  useEffect(() => {
    const el = listRef.current;
    if (el && pinned) el.scrollTop = el.scrollHeight;
  }, [rows, pinned]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  };

  const plannerName = provider?.endpointKind === 'scripted' ? 'Scripted fixture (not a model)' : provider?.label ?? 'Planner';

  return (
    <aside className="panel trace-panel">
      <header className="panel-head">
        <h2>Agent trace</h2>
        <div className="trace-sub">
          one central planner — <strong>{plannerName}</strong> — chooses each tool call for one character; the engine validates it.
        </div>
        <div className="trace-stats">
          <span>{counts.decisions} decisions</span>
          <span className="amber">{counts.rejected} rejected</span>
          <span className="green" title="successful call by the same person within 3 decisions of a rejected call">{counts.recovered} recovered after rejection</span>
        </div>
        <nav className="filters" role="tablist">
          {(['all', ...ACTOR_ORDER, 'engine'] as Filter[]).map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              className={`filter ${filter === f ? 'on' : ''}`}
              style={f !== 'all' && f !== 'engine' ? { ['--actor' as string]: ACTOR_VIEW[f].color } : undefined}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'All' : f === 'engine' ? 'Engine' : ACTOR_VIEW[f].name}
            </button>
          ))}
        </nav>
      </header>
      <ol className="trace-list" ref={listRef} onScroll={onScroll}>
        {rows.length === 0 ? (
          <li className="trace-empty">
            No tool calls yet. The planner is only called after someone notices an incident — drop a <b>Fire</b> to start.
          </li>
        ) : (
          rows.map((r) => <Row key={r.id} row={r} />)
        )}
      </ol>
      {!pinned ? (
        <button className="jump-latest" onClick={() => setPinned(true)}>
          ↓ latest
        </button>
      ) : null}
    </aside>
  );
}
