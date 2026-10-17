// Live agent/tool trace: every real proposal, validation result and engine event, labelled by true origin.
// Condensed presentation: one line per row (person · tool pill · one-liner · status · time); click to expand details.
import { useEffect, useMemo, useRef, useState } from 'react';

import type { ActorId, TraceRow } from '@escape/contracts';

import { ACTOR_ORDER, ACTOR_VIEW } from '../office/actors';
import { useStore } from '../state/store';
import { eventIcon, fmtSim, oneLiner, statusGlyph, stripLeadingEmoji, toolGroup } from './summarize';

type Filter = 'all' | ActorId | 'engine';

function fmtVal(v: unknown): string {
  if (typeof v === 'string') return v.length > 60 ? `“${v.slice(0, 58)}…”` : `“${v}”`;
  if (Array.isArray(v)) return v.length ? v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(', ') : '—';
  if (v && typeof v === 'object') return '{…}';
  return String(v);
}

function Details({ row }: { row: TraceRow }) {
  const [raw, setRaw] = useState(false);
  const err = row.result && !row.result.ok ? row.result.error : null;
  const args = Object.entries(row.args ?? {}).filter(([k]) => k !== 'reason_summary' && k !== 'actor_id');
  return (
    <div className="tr-details">
      <div className="trd-origin">{row.origin}</div>
      {row.reasonSummary ? (
        <div className="trd-line">
          <span className="trd-k">stated reason</span>
          <em>{row.reasonSummary}</em>
        </div>
      ) : null}
      {args.length ? (
        <div className="trd-chips">
          {args.map(([k, v]) => (
            <span key={k} className="trd-chip">
              <b>{k.replace(/_/g, ' ')}</b> {fmtVal(v)}
            </span>
          ))}
        </div>
      ) : null}
      {err ? (
        <div className="trd-err">
          <code>{err.code}</code> {err.message}
          {err.hint ? <div className="trd-hint">hint: {err.hint}</div> : null}
        </div>
      ) : (
        <div className="trd-line trd-result">{row.summary}</div>
      )}
      <div className="trd-meta">
        {row.decisionId ? <span>{row.decisionId}</span> : null}
        {row.actionId ? <span>{row.actionId}</span> : null}
        <span>sim {row.simTime.toFixed(1)}s</span>
        {row.latencyMs !== undefined ? <span>model {Math.round(row.latencyMs)} ms</span> : null}
        {row.usage?.completionTokens !== undefined ? (
          <span>
            {row.usage.promptTokens ?? '?'}→{row.usage.completionTokens} tok
          </span>
        ) : null}
        {row.parseMode === 'content-fallback' ? <span className="warn">parsed from text</span> : null}
        {row.evidenceIds?.map((e) => (
          <span key={e} className="trd-ev">
            {e}
          </span>
        ))}
        <button className="trd-raw" onClick={() => setRaw((r) => !r)} aria-expanded={raw}>
          {raw ? 'hide raw' : 'raw JSON'}
        </button>
      </div>
      {raw ? (
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
    </div>
  );
}

function DecisionRow({ row, thinkingLabel }: { row: TraceRow; thinkingLabel: string }) {
  const [open, setOpen] = useState(false);
  const actor = row.actor ? ACTOR_VIEW[row.actor] : null;
  const st = statusGlyph(row);
  if (row.status === 'proposed') {
    return (
      <li className="tr tr-thinking">
        <span className="tr-avatar tr-avatar-planner" aria-hidden>
          ◇
        </span>
        <span className="tr-shimmer">{thinkingLabel}</span>
        <span className="tr-time">{fmtSim(row.simTime)}</span>
      </li>
    );
  }
  const line = oneLiner(row);
  return (
    <li className={`tr tr-decision tone-${st.tone} ${open ? 'open' : ''}`} style={actor ? { ['--actor' as string]: actor.color } : undefined}>
      <button className="tr-main" onClick={() => setOpen((o) => !o)} aria-expanded={open} title={`${row.origin} — ${row.summary}`}>
        <span className="tr-avatar" aria-hidden>
          {actor ? actor.name[0] : '?'}
        </span>
        <span className="tr-name">{actor?.name ?? 'Planner'}</span>
        {row.tool ? <span className={`tool-pill tg-${toolGroup(row.tool)}`}>{row.tool}</span> : null}
        <span className="tr-line">{line}</span>
        <span className="tr-right">
          {row.recovered ? (
            <span className="tr-recovered" title="succeeded within 3 decisions of a rejected call by the same person">
              ↻
            </span>
          ) : null}
          <span className={`tr-glyph g-${st.tone}`} title={st.label}>
            {st.glyph}
          </span>
          <span className="tr-time">{fmtSim(row.simTime)}</span>
        </span>
      </button>
      {open ? <Details row={row} /> : null}
    </li>
  );
}

function EngineRow({ row }: { row: TraceRow }) {
  const { icon, tone } = eventIcon(row.summary);
  return (
    <li className={`tr tr-event ev-${tone}`} title={row.summary}>
      <span className="tr-ev-icon" aria-hidden>
        {icon}
      </span>
      <span className="tr-ev-text">{stripLeadingEmoji(row.summary)}</span>
      <span className="tr-time">{fmtSim(row.simTime)}</span>
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
    const per: Record<Filter, number> = { all: trace.length, alex: 0, maya: 0, daniel: 0, engine: 0 };
    for (const r of trace) {
      if (r.kind === 'engine') per.engine++;
      else if (r.actor) per[r.actor]++;
    }
    return {
      decisions: new Set(decisions.map((r) => r.decisionId)).size,
      rejected: decisions.filter((r) => r.status === 'rejected' || r.status === 'malformed').length,
      recovered: decisions.filter((r) => r.recovered).length,
      per,
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

  const scripted = provider?.endpointKind === 'scripted';
  const plannerName = scripted ? 'Scripted fixture' : provider?.label ?? 'Planner';
  const thinkingLabel = `${scripted ? 'Scripted fixture' : (provider?.label ?? 'Planner').split(' ').slice(0, 1).join(' ') || 'Planner'} is deciding…`;

  return (
    <aside className="panel trace-panel">
      <header className="panel-head">
        <div className="th-top">
          <h2>Agent trace</h2>
          <div className="th-stats">
            <span className="stat" title="planner decisions this episode">
              {counts.decisions} <i>decisions</i>
            </span>
            <span className="stat stat-warn" title="calls the engine rejected (they changed nothing)">
              {counts.rejected} <i>rejected</i>
            </span>
            <span className="stat stat-ok" title="successful call by the same person within 3 decisions of a rejected call">
              {counts.recovered} <i>recovered</i>
            </span>
          </div>
        </div>
        {scripted ? (
          <div className="th-sub">
            <span className="scripted-chip">SCRIPTED — not a model</span> · one central planner · engine-validated
          </div>
        ) : (
          <div className="th-sub">
            <b>{plannerName}</b> · one central planner · engine-validated
          </div>
        )}
        <nav className="tabs" role="tablist">
          {(['all', ...ACTOR_ORDER, 'engine'] as Filter[]).map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              className={`tab ${filter === f ? 'on' : ''}`}
              style={f !== 'all' && f !== 'engine' ? { ['--actor' as string]: ACTOR_VIEW[f].color } : undefined}
              onClick={() => setFilter(f)}
            >
              {f !== 'all' && f !== 'engine' ? <span className="tab-dot" aria-hidden /> : null}
              {f === 'all' ? 'All' : f === 'engine' ? 'Events' : ACTOR_VIEW[f].name}
              <span className="tab-count">{counts.per[f]}</span>
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
          rows.map((r) => (r.kind === 'engine' ? <EngineRow key={r.id} row={r} /> : <DecisionRow key={r.id} row={r} thinkingLabel={thinkingLabel} />))
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
