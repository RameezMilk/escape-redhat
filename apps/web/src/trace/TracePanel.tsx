// Live agent/tool trace: every real proposal, validation result and engine event, labelled by true origin.
// Condensed presentation: one line per row (person · tool pill · one-liner · status · time); click to expand details.
import { useEffect, useMemo, useRef, useState } from 'react';

import { ACTOR_IDS, type ActorId, type TraceRow } from '@escape/contracts';

import { ACTOR_ORDER, ACTOR_VIEW } from '../office/actors';
import { useStore } from '../state/store';
import { evidenceNames, humanize, instinctKind } from './humanize';
import { eventIcon, fmtSim, oneLiner, statusGlyph, stripLeadingEmoji, toolGroup } from './summarize';

type Filter = 'all' | ActorId;

function fmtVal(v: unknown): string {
  if (typeof v === 'string') return v.length > 60 ? `“${v.slice(0, 58)}…”` : `“${v}”`;
  if (Array.isArray(v)) return v.length ? v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(', ') : '—';
  if (v && typeof v === 'object') return '{…}';
  return String(v);
}

function Details({ row, names }: { row: TraceRow; names: Map<string, string> }) {
  const [raw, setRaw] = useState(false);
  const [thought, setThought] = useState(false);
  const err = row.result && !row.result.ok ? row.result.error : null;
  // Readable view: no evidence ids / zone codes (they remain in the raw JSON below).
  const args = Object.entries(row.args ?? {})
    .filter(([k]) => k !== 'reason_summary' && k !== 'actor_id' && k !== 'evidence_ids' && k !== 'expected_revision')
    .map(([k, v]) => [k, typeof v === 'string' ? humanize(v, names) : v] as const);
  return (
    <div className="tr-details">
      <div className="trd-origin">{row.origin}</div>
      {row.reasonSummary ? (
        <div className="trd-line">
          <span className="trd-k">stated reason</span>
          <em>{row.reasonSummary}</em>
        </div>
      ) : null}
      {row.reasoning ? (
        <div className="trd-thought">
          <button className="trd-thought-toggle" onClick={() => setThought((t) => !t)} aria-expanded={thought}>
            <span className="trd-k">thinking</span> {thought ? 'hide' : 'show the model’s reasoning'}
          </button>
          {thought ? <p className="trd-thought-text">{humanize(row.reasoning, names)}</p> : null}
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
          <code>{err.code}</code> {humanize(err.message, names)}
          {err.hint ? <div className="trd-hint">hint: {humanize(err.hint, names)}</div> : null}
        </div>
      ) : (
        <div className="trd-line trd-result">{humanize(row.summary, names)}</div>
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

function DecisionRow({ row, thinkingLabel, names }: { row: TraceRow; thinkingLabel: string; names: Map<string, string> }) {
  const [open, setOpen] = useState(false);
  const actor = row.actor ? ACTOR_VIEW[row.actor] : null;
  const st = statusGlyph(row);
  if (row.status === 'proposed') {
    return (
      <li className="tr tr-thinking">
        <span className="tr-avatar tr-avatar-planner" aria-hidden>
          ◇
        </span>
        <span className="tr-shimmer">{row.actor ? humanize(row.summary, names) : thinkingLabel}</span>
        <span className="tr-time">{fmtSim(row.simTime)}</span>
      </li>
    );
  }
  const line = oneLiner(row, names);
  return (
    <li className={`tr tr-decision tone-${st.tone} ${open ? 'open' : ''}`} style={actor ? { ['--actor' as string]: actor.color } : undefined}>
      <button className="tr-main" onClick={() => setOpen((o) => !o)} aria-expanded={open} title={`${row.origin} — ${humanize(row.summary, names)}`}>
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
      {open ? <Details row={row} names={names} /> : null}
    </li>
  );
}

const INSTINCT_ICON = { shout: '📣', flee: '↩', alarm: '🚨' } as const;

function EngineRow({ row, names }: { row: TraceRow; names: Map<string, string> }) {
  const text = humanize(stripLeadingEmoji(row.summary), names);
  const inst = instinctKind(row);
  const { icon, tone } = eventIcon(text);
  return (
    <li className={`tr tr-event ev-${tone} ${inst ? 'ev-instinct' : ''}`} title={inst ? `${text} — human instinct (engine behaviour, not a model decision)` : text}>
      <span className="tr-ev-icon" aria-hidden>
        {inst ? INSTINCT_ICON[inst] : icon}
      </span>
      {inst ? <span className="instinct-pill">instinct</span> : null}
      <span className="tr-ev-text">{text}</span>
      <span className="tr-time">{fmtSim(row.simTime)}</span>
    </li>
  );
}

export function TracePanel() {
  const trace = useStore((s) => s.trace);
  const provider = useStore((s) => s.provider);
  const connection = useStore((s) => s.connection);
  const source = useStore((s) => s.source);
  const [filter, setFilter] = useState<Filter>('all');
  const listRef = useRef<HTMLOListElement>(null);
  const [pinned, setPinned] = useState(true);

  const names = useMemo(() => evidenceNames(trace), [trace]);
  const rows = useMemo(
    () =>
      trace.filter((r) => {
        if (filter === 'all') return true;
        return r.actor === filter;
      }),
    [trace, filter],
  );

  const counts = useMemo(() => {
    const decisions = trace.filter((r) => r.kind === 'decision');
    const per = { all: trace.length, ...Object.fromEntries(ACTOR_IDS.map((id) => [id, 0])) } as Record<Filter, number>;
    for (const r of trace) if (r.kind !== 'engine' && r.actor) per[r.actor]++;
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
  // No provider line in the header: a dropped server or tunnel is still flagged here.
  const offline = source === 'live' && connection === 'closed' ? 'server disconnected' : provider?.healthy === false ? 'model unreachable' : null;
  const thinkingLabel = `${scripted ? 'Scripted fixture' : (provider?.label ?? 'Planner').split(' ').slice(0, 1).join(' ') || 'Planner'} is deciding…`;

  return (
    <aside className="panel trace-panel">
      <header className="panel-head">
        <div className="th-top">
          <h2>Agent Trace</h2>
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
        {/* Only shown when something is off: the scripted fixture is labelled, and a dropped server or model is flagged. */}
        {scripted || offline ? (
          <div className="th-sub">
            {scripted ? <span className="scripted-chip">SCRIPTED — not a model</span> : null}
            {scripted && offline ? ' · ' : null}
            {offline ? <span className="th-warn">{offline}</span> : null}
          </div>
        ) : null}
        <nav className="tabs" role="tablist">
          {(['all', ...ACTOR_ORDER] as Filter[]).map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              className={`tab ${filter === f ? 'on' : ''}`}
              style={f !== 'all' ? { ['--actor' as string]: ACTOR_VIEW[f].color } : undefined}
              onClick={() => setFilter(f)}
            >
              {f !== 'all' ? <span className="tab-dot" aria-hidden /> : null}
              {f === 'all' ? 'All' : ACTOR_VIEW[f].name}
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
          rows.map((r) =>
            r.kind === 'engine' ? <EngineRow key={r.id} row={r} names={names} /> : <DecisionRow key={r.id} row={r} thinkingLabel={thinkingLabel} names={names} />,
          )
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
