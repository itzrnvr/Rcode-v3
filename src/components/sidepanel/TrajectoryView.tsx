/*
 * PURPOSE: Trajectory viewer — dsh-web parity + Chrome-DevTools-Network-style
 * horizontal timeline, in the One UI language.
 *
 * Timeline interactions (unchanged):
 *  - full-width time axis with a ruler (adaptive tick labels).
 *  - wheel = anchored zoom (like Chrome network waterfall); shift+wheel or
 *    horizontal wheel = pan; shift+drag = pan; plain drag = brush region
 *    select that filters the event list + shows a range chip.
 *  - Escape resets zoom + selection. Tiny drags clear the brush.
 *  - click a bar/row = focus select: dashed accent line across lanes, filled
 *    bullet, row scroll-into-view, inspector (Summary/Preview/Raw).
 *
 * Presentation: the event list is a flat, dense, chronological log in the
 * DeepSeek-harness style — a thin connector rail with a dot per row on the
 * far left, a filled uppercase role badge per row (fixed colour legend,
 * defined once in trajectory.css and identical in every theme), hairline
 * separators between rows, tool rows reading `name {args} → result` in mono,
 * and turn boundaries as small muted "Turn N" badges in the flow, not cards.
 * The timeline lanes stay monochrome and differentiate by shape (ticks, thin
 * bars, wide bars); colour is reserved for the role legend, real state
 * (warning = tool call with no result yet) and selection (accent).
 *
 * Data: JSONL trace via trace:list IPC, auto-refresh 3s.
 */

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import {
  RefreshIcon,
  ClockIcon,
  ListIcon,
  LayoutGridIcon,
  DownloadIcon,
  XIcon,
  ChevronDownIcon,
} from "../common/Icons";
import { cn } from "../../lib/utils";
import "./trajectory.css";

interface TraceEntry {
  ts: string;
  kind: string;
  turn?: number;
  round?: number | string;
  [k: string]: unknown;
}

const BADGE: Record<string, string> = {
  turn_start: "SYSTEM",
  user: "USER",
  system: "SYSTEM",
  request: "CONTEXT",
  reasoning: "THINK",
  tool_call: "TOOL",
  tool_result: "TOOL",
  content: "ASSISTANT",
  response: "MODEL",
  turn_end: "SYSTEM",
};

// Filled role pill; the colour lives in trajectory.css keyed off data-role,
// so the legend stays in one place and never derives from the theme accent.
function RoleBadge({ role }: { role: string }) {
  return (
    <span data-role={role.toLowerCase()} className="traj-badge">
      {role}
    </span>
  );
}

// Turn boundary in the flow: a small muted marker, not a card.
function TurnMarker({ turn }: { turn: number }) {
  return (
    <div className="traj-turnmark">
      <span aria-hidden className="traj-railcell" />
      <span className="traj-turnpill">Turn {turn}</span>
    </div>
  );
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
}

interface UsageInfo { prompt: number; completion: number; cached: number; reasoning: number }

// Trace entries arrive over IPC as untyped JSON; narrow once at the boundary.
function readUsage(raw: unknown): UsageInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const u = raw as Record<string, unknown>;
  const pd = (u.prompt_tokens_details ?? {}) as Record<string, unknown>;
  const cd = (u.completion_tokens_details ?? {}) as Record<string, unknown>;
  return {
    prompt: typeof u.prompt_tokens === "number" ? u.prompt_tokens : 0,
    completion: typeof u.completion_tokens === "number" ? u.completion_tokens : 0,
    cached: typeof pd.cached_tokens === "number" ? pd.cached_tokens : 0,
    reasoning: typeof cd.reasoning_tokens === "number" ? cd.reasoning_tokens : 0,
  };
}

function fmtTok(n: number): string {
  return n >= 1000000 ? `${(n / 1000000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}

function rulerStep(domainMs: number): number {
  const candidates = [250, 500, 1000, 2000, 5000, 10000, 30000, 60000, 120000, 300000, 600000];
  for (const c of candidates) if (domainMs / c <= 7) return c;
  return 600000;
}

interface Row {
  key: number;
  badge: string;
  text: string;
  t: number;
  e: TraceEntry;
  e2?: TraceEntry;
  turnStart?: number;
  outcomeUnknown?: boolean;
  argsText?: string;
  resultText?: string;
}

const LABEL_GUTTER = 46; // px reserved for lane labels

const chip =
  "flex shrink-0 items-center gap-1.5 rounded-full px-2.5 text-ui-xs font-semibold text-[var(--color-foreground-subtle)] transition-colors duration-200 hover:bg-[var(--color-hover)] hover:text-[var(--color-fg)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-accent)]";
const chipActive = "bg-[var(--color-selected)] text-[var(--color-fg)] hover:bg-[var(--color-selected)] hover:text-[var(--color-fg)]";

export function TrajectoryView({ sessionId, mockEntries }: { sessionId: string | null; mockEntries?: TraceEntry[] }) {
  const [entries, setEntries] = useState<TraceEntry[]>([]);
  const [view, setView] = useState<"duration" | "turns" | "calls">("duration");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [selKey, setSelKey] = useState<number | null>(null);
  const [selTab, setSelTab] = useState<"summary" | "preview" | "raw">("summary");
  const [reload, setReload] = useState(0);
  const [viewport, setViewport] = useState<{ start: number; end: number } | null>(null);
  const [range, setRange] = useState<{ a: number; b: number } | null>(null);
  const [draft, setDraft] = useState<{ a: number; b: number } | null>(null);
  const panRef = useRef<{ startX: number; vp: { start: number; end: number } } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const timelineRootRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // The gallery renders this with a mock trace, so the component has to work
    // with no backend and no Electron bridge.
    if (mockEntries) {
      setEntries(mockEntries);
      return;
    }
    if (!sessionId) return;
    let cancelled = false;
    const load = async () => {
      // preload exposes traceList; the shared api type doesn't declare it.
      const trajApi = api as unknown as { traceList: (id: string) => Promise<TraceEntry[]> };
      const list = (await trajApi.traceList(sessionId)) || [];
      if (!cancelled) setEntries(list);
    };
    load();
    const id = setInterval(load, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, [sessionId, reload, mockEntries]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let key = 0;
    const seenTurns = new Set<number>();
    const t0 = entries.length ? new Date(entries[0].ts).getTime() : 0;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const turnStart = e.turn != null && !seenTurns.has(e.turn) ? e.turn : undefined;
      if (turnStart != null) seenTurns.add(turnStart);
      if (e.kind === "tool_result") continue;
      let text = "";
      let e2: TraceEntry | undefined;
      let outcomeUnknown = false;
      let argsText: string | undefined;
      let resultText: string | undefined;
      switch (e.kind) {
        case "turn_start": text = [e.model, e.mode, e.effort != null ? `effort ${e.effort}` : ""].filter(Boolean).join(" · ") || "turn start"; break;
        case "user": text = String(e.text ?? "") || "user message"; break;
        case "system": text = String(e.text ?? "") || "system message"; break;
        case "request": {
          const msgs = (e.messages as unknown[])?.length ?? 0;
          const tools = (e.toolNames as unknown[])?.length ?? 0;
          text = `request r${e.round} · ${msgs} messages${tools > 0 ? ` · ${tools} tools` : ""}`;
          break;
        }
        case "response": text = `model r${e.round} · ${e.status} · TTFT ${e.firstChunkMs ?? "—"}ms · ${fmtMs(Number(e.totalMs ?? 0))}`; break;
        case "reasoning": text = String(e.text ?? ""); break;
        case "tool_call": {
          const res = entries.find(x => x.kind === "tool_result" && x.round === e.round && x.name === e.name);
          e2 = res;
          outcomeUnknown = !res;
          // args may arrive as a JSON string or an object; normalise once.
          const args = typeof e.args === "string" ? e.args : JSON.stringify(e.args ?? {});
          const result = res ? String(res.result ?? "").replace(/\n/g, " ") : "";
          argsText = args.slice(0, 160);
          resultText = result.slice(0, 120);
          text = `${e.name} ${args.slice(0, 80)}${res ? ` → ${result.slice(0, 100)}` : ""}`;
          break;
        }
        case "content": text = String(e.text ?? ""); break;
        case "turn_end": text = e.error ? `ended · ERROR ${e.error}` : `ended · ${e.secs}s`; break;
        default: text = e.kind;
      }
      out.push({ key: key++, badge: BADGE[e.kind] ?? "SYSTEM", text, t: new Date(e.ts).getTime() - t0, e, e2, turnStart, outcomeUnknown, argsText, resultText });
    }
    return out;
  }, [entries]);

  const fullSpan = rows.length ? Math.max(1, rows[rows.length - 1].t) : 1;
  const domain = viewport ?? { start: 0, end: fullSpan };
  const domainDur = Math.max(1, domain.end - domain.start);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setRange(null); setViewport(null); setDraft(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // wheel: zoom (anchored) or pan (shift / horizontal)
  useEffect(() => {
    const el = timelineRootRef.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (ev.clientX - rect.left) / Math.max(1, rect.width)));
      const cur = viewport ?? { start: 0, end: fullSpan };
      const dur = cur.end - cur.start;
      const delta = Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.shiftKey ? ev.deltaY : 0;
      if (delta !== 0) {
        // pan
        const shift = (delta / Math.max(1, rect.width)) * dur * 2;
        const start = Math.min(Math.max(cur.start + shift, 0), fullSpan - dur);
        setViewport(start <= 0 && dur >= fullSpan * 0.999 ? null : { start, end: start + dur });
        return;
      }
      const nextDur = Math.min(fullSpan, Math.max(fullSpan * 0.02, dur * Math.exp(ev.deltaY * 0.0015)));
      if (nextDur >= fullSpan * 0.999) { setViewport(null); return; }
      const anchor = cur.start + f * dur;
      const start = Math.min(Math.max(anchor - f * nextDur, 0), fullSpan - nextDur);
      setViewport({ start, end: start + nextDur });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [viewport, fullSpan]);

  const msAt = (clientX: number): number => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)));
    return domain.start + f * domainDur;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    if (e.shiftKey && viewport) {
      panRef.current = { startX: e.clientX, vp: viewport };
      return;
    }
    const m = msAt(e.clientX);
    setDraft({ a: m, b: m });
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (panRef.current) {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const dur = panRef.current.vp.end - panRef.current.vp.start;
      const shift = ((panRef.current.startX - e.clientX) / Math.max(1, rect.width)) * dur;
      const start = Math.min(Math.max(panRef.current.vp.start + shift, 0), fullSpan - dur);
      setViewport({ start, end: start + dur });
      return;
    }
    if (draft) setDraft({ a: draft.a, b: msAt(e.clientX) });
  };
  const onPointerUp = () => {
    if (panRef.current) { panRef.current = null; return; }
    if (!draft) return;
    const lo = Math.min(draft.a, draft.b);
    const hi = Math.max(draft.a, draft.b);
    if (hi - lo < Math.max(300, fullSpan * 0.004)) setRange(null);
    else setRange({ a: lo, b: hi });
    setDraft(null);
  };

  const visibleRows = useMemo(() => (range ? rows.filter(r => r.t >= range.a && r.t <= range.b) : rows), [rows, range]);

  const filtered = useMemo(() => {
    if (!query.trim()) return visibleRows;
    const q = query.toLowerCase();
    return visibleRows.filter(r => r.text.toLowerCase().includes(q) || r.badge.toLowerCase().includes(q));
  }, [visibleRows, query]);

  const selRow = selKey != null ? rows.find(r => r.key === selKey) ?? null : null;

  const stats = useMemo(() => {
    const resps = entries.filter(e => e.kind === "response");
    const tools = entries.filter(e => e.kind === "tool_result");
    const calls = entries.filter(e => e.kind === "tool_call");
    const turns = entries.filter(e => e.kind === "turn_start").length;
    const llmMs = resps.reduce((a, r) => a + Number(r.totalMs ?? 0), 0);
    const toolMs = tools.reduce((a, r) => a + Number(r.ms ?? 0), 0);
    const ttft = resps.length ? resps.reduce((a, r) => a + Number(r.firstChunkMs ?? 0), 0) / resps.length : 0;
    let inTok = 0, outTok = 0, cached = 0, prompt = 0;
    for (const r of resps) {
      const u = readUsage(r.usage);
      if (!u) continue;
      inTok += u.prompt;
      outTok += u.completion;
      cached += u.cached;
      prompt += u.prompt;
    }
    const tps = llmMs > 0 ? (outTok / llmMs) * 1000 : 0;
    return { turns, steps: calls.length, llmMs, toolMs, ttft, tps, cache: prompt ? cached / prompt : 0, inTok, outTok };
  }, [entries]);

  const at = (t: number) => ((t - domain.start) / domainDur) * 100;
  const inDomain = (t: number) => t >= domain.start && t <= domain.end;

  const timeline = useMemo(() => {
    if (rows.length === 0) return null;
    const inputTicks = rows.filter(r => (r.e.kind === "user" || r.e.kind === "turn_start") && inDomain(r.t)).map(r => ({ left: at(r.t), key: r.key }));
    const modelBars = rows.filter(r => ["request", "response", "reasoning", "content"].includes(r.e.kind) && inDomain(r.t)).map(r => ({ left: at(r.t), key: r.key, wide: r.e.kind === "response" }));
    const toolBars = rows.filter(r => r.e.kind === "tool_call" && inDomain(r.t)).map(r => {
      const endT = r.e2 ? new Date(r.e2.ts).getTime() - new Date(entries[0].ts).getTime() : r.t;
      return { left: at(r.t), width: Math.max(0.5, at(Math.max(endT, r.t + 1)) - at(r.t)), key: r.key, unknown: r.outcomeUnknown };
    });
    const selLeft = selRow && inDomain(selRow.t) ? at(selRow.t) : null;
    const step = rulerStep(domainDur);
    const ticks: number[] = [];
    for (let t = Math.ceil(domain.start / step) * step; t <= domain.end; t += step) ticks.push(t);
    return { inputTicks, modelBars, toolBars, selLeft, ticks };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, selRow, entries, domain.start, domain.end]);

  const select = (key: number, fromTimeline = false) => {
    setSelKey(key);
    setSelTab("summary");
    if (fromTimeline) {
      requestAnimationFrame(() => {
        listRef.current?.querySelector(`[data-rowkey="${key}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
    }
  };

  const downloadLog = () => {
    const blob = new Blob([entries.map(e => JSON.stringify(e)).join("\n")], { type: "application/jsonl" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `session-log-${sessionId?.slice(0, 8)}.jsonl`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // One row renderer shared by the duration, turns and calls views so the
  // three lists are pixel-identical: rail dot, role badge, content, chevron.
  const renderRow = (r: Row) => (
    <div
      key={r.key}
      data-rowkey={r.key}
      onClick={() => select(r.key)}
      className={cn("traj-row", selKey === r.key && "traj-row-sel")}
    >
      <span aria-hidden className="traj-railcell">
        <i aria-hidden className={cn("traj-dot", selKey === r.key && "traj-dot-sel")} />
      </span>
      <RoleBadge role={r.badge} />
      <div className="traj-content">
        {r.e.kind === "tool_call" ? (
          <span className="traj-toolline">
            <span className="traj-toolname">{String(r.e.name ?? "")}</span>{" "}
            <span className="traj-toolargs">{r.argsText ?? ""}</span>
            {r.e2 ? (
              <>
                <span className="traj-arrow"> → </span>
                <span className="traj-toolresult">
                  {r.resultText}{(r.resultText?.length ?? 0) >= 120 ? "…" : ""}
                </span>
              </>
            ) : (
              <span className="traj-unknown"> TOOL_OUTCOME_UNKNOWN</span>
            )}
          </span>
        ) : (
          <span className="traj-text">{r.text}</span>
        )}
        {open.has(r.key) && (
          <pre className="tool-result" style={{ maxHeight: 220, margin: "6px 0 4px", whiteSpace: "pre-wrap" }}>
            {r.e.kind === "request"
              ? JSON.stringify({ messages: r.e.messages, toolNames: r.e.toolNames }, null, 2)
              : r.e.kind === "tool_call"
                ? `args: ${JSON.stringify(r.e.args ?? {}, null, 2)}\n\nresult: ${String(r.e2?.result ?? "(none)")}`
                : String(r.e.text ?? r.e.result ?? JSON.stringify(r.e, null, 2))}
          </pre>
        )}
      </div>
      <button
        type="button"
        aria-label={open.has(r.key) ? "Collapse details" : "Expand details"}
        aria-expanded={open.has(r.key)}
        onClick={e => { e.stopPropagation(); setOpen(prev => { const n = new Set(prev); if (n.has(r.key)) n.delete(r.key); else n.add(r.key); return n; }); }}
        className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[var(--color-foreground-subtlest)] transition-colors duration-[var(--duration-fast)] hover:bg-[var(--color-hover)] hover:text-[var(--color-fg)]"
      >
        <ChevronDownIcon size={13} className={cn("transition-transform duration-[var(--duration-fast)]", open.has(r.key) && "rotate-180")} />
      </button>
    </div>
  );

  // The gallery renders this with a mock trace and no session, so the guard is
  // on the session only when there is nothing to show instead.
  if (!sessionId && !mockEntries) return <div className="p-5 text-ui-xs text-[var(--color-foreground-subtlest)]">Open a session to see its trajectory.</div>;

  const activeRange = draft ? { a: Math.min(draft.a, draft.b), b: Math.max(draft.a, draft.b) } : range;

  return (
    <div className="traj relative flex min-h-0 flex-1 flex-col">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--color-border)] px-2 py-1.5">
        {(["duration", "turns", "calls"] as const).map(v => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={cn(chip, "h-7", view === v && chipActive)}
          >
            {v === "duration" ? <ClockIcon size={12} /> : v === "turns" ? <ListIcon size={12} /> : <LayoutGridIcon size={12} />}
            {v}
          </button>
        ))}
        {range && (
          <button
            type="button"
            onClick={() => setRange(null)}
            title="Clear range selection (Esc)"
            className={cn(chip, "h-7", chipActive)}
          >
            <ClockIcon size={11} />
            {fmtMs(range.b - range.a)} · {visibleRows.length} events
            <XIcon size={10} />
          </button>
        )}
        {viewport && (
          <button type="button" onClick={() => setViewport(null)} title="Reset zoom (Esc)" className={cn(chip, "h-7", chipActive)}>
            {Math.round((domainDur / fullSpan) * 100)}%
          </button>
        )}
        <span className="flex-1" />
        <div className="flex min-w-0 items-center gap-1.5 rounded-full border border-[var(--color-input-border)] bg-[var(--color-surface)] py-1 pl-3 pr-1 transition-colors duration-200 focus-within:border-[var(--color-input-border-hover)]">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search"
            aria-label="Search trajectory"
            className="h-6 w-20 min-w-0 bg-transparent text-ui-xs text-[var(--color-fg)] outline-none placeholder:text-[var(--color-foreground-subtlest)]"
          />
        </div>
        <button className="sp-iconbtn" title="Session log" onClick={downloadLog} aria-label="Download session log"><DownloadIcon size={14} /></button>
        <button className="sp-iconbtn" title="Refresh" onClick={() => setReload(r => r + 1)} aria-label="Refresh trajectory"><RefreshIcon size={14} /></button>
      </div>

      {/* Timeline: ruler + lanes, brush + zoom + pan */}
      {view === "duration" && timeline && (
        <div
          ref={timelineRootRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className="relative cursor-crosshair border-b border-[var(--color-border)] px-2 py-1.5 select-none"
          style={{ touchAction: "none" }}
        >
          {/* ruler */}
          <div className="mb-0.5 flex gap-2">
            <span className="w-[38px] shrink-0" />
            <div className="relative h-3 flex-1 border-b border-[color-mix(in_srgb,var(--color-border)_80%,transparent)]">
              {timeline.ticks.map(t => (
                <span key={t} className="absolute top-0 h-3 border-l border-[color-mix(in_srgb,var(--color-fg)_12%,transparent)]" style={{ left: `${at(t)}%` }}>
                  <span className="absolute left-1 top-0 whitespace-nowrap font-mono text-ui-2xs text-[var(--color-foreground-subtlest)]">{fmtMs(t)}</span>
                </span>
              ))}
            </div>
          </div>
          {(["Input", "Model", "Tools"] as const).map((lane, li) => (
            <div key={lane} className="mb-1 flex items-center gap-2">
              <span className="w-[38px] shrink-0 font-mono text-ui-2xs text-[var(--color-foreground-subtlest)]">{lane}</span>
              <div ref={li === 0 ? trackRef : undefined} className="relative h-2.5 flex-1 overflow-hidden border-b border-[color-mix(in_srgb,var(--color-border)_80%,transparent)]">
                {lane === "Input" && timeline.inputTicks.map(b => (
                  <span
                    key={b.key}
                    onClick={() => select(b.key, true)}
                    title="Jump to event"
                    className={cn("absolute top-0.5 h-1.5 w-[3px] cursor-pointer rounded-[1px] bg-[var(--color-foreground-subtle)]", selKey === b.key && "bg-[var(--color-accent)]")}
                    style={{ left: `${b.left}%` }}
                  />
                ))}
                {lane === "Model" && timeline.modelBars.map(b => (
                  <span
                    key={b.key}
                    onClick={() => select(b.key, true)}
                    title="Jump to event"
                    className={cn(
                      "absolute cursor-pointer rounded-[1px] bg-[var(--color-foreground-subtle)]",
                      b.wide ? "top-px h-2 w-[3px]" : "top-[3px] h-1 w-[2px]",
                      selKey === b.key && "bg-[var(--color-accent)]",
                    )}
                    style={{ left: `${b.left}%` }}
                  />
                ))}
                {lane === "Tools" && timeline.toolBars.map(b => (
                  <span
                    key={b.key}
                    onClick={() => select(b.key, true)}
                    title="Jump to event"
                    className={cn(
                      "absolute top-0.5 h-1.5 cursor-pointer rounded-[2px]",
                      b.unknown ? "bg-[var(--color-warning)]" : "bg-[var(--color-foreground-subtle)]",
                      selKey === b.key && "bg-[var(--color-accent)]",
                    )}
                    style={{ left: `${b.left}%`, width: `${b.width}%` }}
                  />
                ))}
              </div>
            </div>
          ))}
          {/* brush band */}
          {activeRange && (
            <span
              className="pointer-events-none absolute bottom-1.5 top-5 border-l border-r border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)]"
              style={{
                left: `calc(${LABEL_GUTTER}px + (100% - ${LABEL_GUTTER + 8}px) * ${Math.max(0, Math.min(100, at(activeRange.a))) / 100})`,
                width: `calc((100% - ${LABEL_GUTTER + 8}px) * ${Math.max(0, at(activeRange.b) - at(activeRange.a)) / 100})`,
              }}
            />
          )}
          {/* dashed focus line */}
          {timeline.selLeft != null && (
            <span
              className="pointer-events-none absolute bottom-1.5 top-5 border-l border-dashed border-[var(--color-accent)]"
              style={{ left: `calc(${LABEL_GUTTER}px + (100% - ${LABEL_GUTTER + 8}px) * ${timeline.selLeft / 100})` }}
            />
          )}
        </div>
      )}

      {/* Event list — flat dense chronological log; one renderer, three views */}
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
        {rows.length === 0 && <div className="p-3 text-ui-xs text-[var(--color-foreground-subtlest)]">No trace yet — send a message to start recording.</div>}
        {rows.length > 0 && filtered.length === 0 && <div className="p-3 text-ui-xs text-[var(--color-foreground-subtlest)]">No events in the selected range.</div>}

        {view !== "turns" && (() => {
          const list = view === "calls" ? filtered.filter(r => r.e.kind === "tool_call") : filtered;
          const seen = new Set<number>();
          return list.map(r => {
            const turn = r.e.turn ?? 0;
            const mark = !seen.has(turn);
            if (mark) seen.add(turn);
            return (
              <Fragment key={r.key}>
                {mark && <TurnMarker turn={turn} />}
                {renderRow(r)}
              </Fragment>
            );
          });
        })()}

        {view === "turns" && (() => {
          const map = new Map<number, Row[]>();
          for (const r of filtered) { const t = r.e.turn ?? 0; if (!map.has(t)) map.set(t, []); map.get(t)!.push(r); }
          return [...map.entries()].sort((a, b) => b[0] - a[0]).map(([turn, rs]) => (
            <Fragment key={turn}>
              <TurnMarker turn={turn} />
              {rs.map(renderRow)}
            </Fragment>
          ));
        })()}
      </div>

      {/* Inspector — dsh style */}
      {selRow && (() => {
        const isTool = selRow.e.kind === "tool_call";
        const roundEntries = entries.filter(e => isTool
          ? (e.kind === "tool_call" || e.kind === "tool_result") && e.round === selRow.e.round && e.name === selRow.e.name
          : (e.round === selRow.e.round && ["request", "response", "reasoning", "content", "tool_call"].includes(e.kind)));
        const req = roundEntries.find(e => e.kind === "request");
        const resp = roundEntries.find(e => e.kind === "response");
        const think = roundEntries.filter(e => e.kind === "reasoning").map(e => String(e.text ?? "")).join("\n");
        const contents = roundEntries.filter(e => e.kind === "content").map(e => String(e.text ?? "")).join("\n");
        const tools = roundEntries.filter(e => e.kind === "tool_call");
        const u = readUsage(resp?.usage);
        const total = Number(resp?.totalMs ?? 0);
        const ttft = Number(resp?.firstChunkMs ?? 0);
        return (
          <div className="absolute bottom-9 right-2 top-11 z-[1600] flex w-[min(400px,94%)] flex-col rounded-[var(--radius-lg)] border border-[var(--color-popover-border)] bg-[var(--color-menu)] shadow-[var(--shadow-lg)]">
            <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
              <RoleBadge role={isTool ? "TOOL" : selRow.badge} />
              <span className="min-w-0 flex-1 truncate text-ui-xs font-semibold text-[var(--color-fg)]">
                {isTool ? `${String(selRow.e.name ?? "")} · Turn ${String(selRow.e.turn ?? "")} · Step ${selRow.key}` : `${selRow.badge} Turn ${String(selRow.e.turn ?? "")} · Step ${selRow.key}`}
              </span>
              <button
                type="button"
                aria-label="Close inspector"
                onClick={() => setSelKey(null)}
                className="sp-iconbtn"
              >
                <XIcon size={13} />
              </button>
            </div>
            <div className="flex gap-3.5 border-b border-[var(--color-border)] px-3 py-1.5">
              {(["summary", "preview", "raw"] as const).map(tb => (
                <button
                  key={tb}
                  type="button"
                  onClick={() => setSelTab(tb)}
                  className={cn(
                    "border-b-2 pb-0.5 text-ui-xs font-semibold capitalize transition-colors duration-200",
                    selTab === tb
                      ? "border-[var(--color-fg)] text-[var(--color-fg)]"
                      : "border-transparent text-[var(--color-foreground-subtlest)] hover:text-[var(--color-fg)]",
                  )}
                >
                  {tb}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {selTab === "summary" && (
                <div className="flex flex-col gap-1.5 text-ui-xs">
                  {!isTool && (
                    <>
                      <div className="flex justify-between gap-3"><span className="text-[var(--color-foreground-subtlest)]">Source</span><span className="text-[var(--color-fg)]">Request #{String(selRow.e.round ?? 0)}</span></div>
                      <div className="flex justify-between gap-3"><span className="text-[var(--color-foreground-subtlest)]">Status</span><span className="text-[var(--color-fg)]">{String(resp?.status ?? "—") === "ok" ? "Completed" : String(resp?.status ?? "—")}</span></div>
                      <div className="flex justify-between gap-3"><span className="text-[var(--color-foreground-subtlest)]">Tokens</span><span className="font-mono tabular-nums text-[var(--color-fg)]">{u ? fmtTok(u.completion) : "—"}</span></div>
                      <div className="flex justify-between gap-3 pl-3.5"><span className="text-[var(--color-foreground-subtlest)]">Reasoning</span><span className="font-mono tabular-nums text-[var(--color-fg)]">{fmtTok(u?.reasoning ?? 0)}</span></div>
                      <div className="flex justify-between gap-3 pl-3.5"><span className="text-[var(--color-foreground-subtlest)]">Content</span><span className="font-mono tabular-nums text-[var(--color-fg)]">{u ? fmtTok(u.completion - u.reasoning) : "—"}</span></div>
                      <div className="mt-2 font-mono text-ui-2xs font-bold uppercase tracking-wide text-[var(--color-foreground-subtlest)]">Request timing</div>
                      <div className="flex justify-between gap-3"><span className="text-[var(--color-foreground-subtlest)]">Started</span><span className="font-mono text-[var(--color-fg)]">{req?.ts ? new Date(String(req.ts)).toLocaleTimeString() : "—"}</span></div>
                      <div className="flex justify-between gap-3"><span className="text-[var(--color-foreground-subtlest)]">Total duration</span><span className="font-mono tabular-nums text-[var(--color-fg)]">{(total / 1000).toFixed(1)}s</span></div>
                      <div className="flex justify-between gap-3"><span className="text-[var(--color-foreground-subtlest)]">TTFT</span><span className="font-mono tabular-nums text-[var(--color-fg)]">{(ttft / 1000).toFixed(2)}s</span></div>
                      <div className="flex justify-between gap-3"><span className="text-[var(--color-foreground-subtlest)]">Generation</span><span className="font-mono tabular-nums text-[var(--color-fg)]">{((total - ttft) / 1000).toFixed(1)}s</span></div>
                    </>
                  )}
                  {isTool && (
                    <>
                      <div className="flex justify-between gap-3"><span className="text-[var(--color-foreground-subtlest)]">Tool</span><span className="font-mono text-[var(--color-fg)]">{String(selRow.e.name ?? "")}</span></div>
                      <div className="flex justify-between gap-3"><span className="text-[var(--color-foreground-subtlest)]">Status</span><span className={cn("text-[var(--color-fg)]", !selRow.e2 && "text-[var(--color-warning)]")}>{selRow.e2 ? "Completed" : "Unknown"}</span></div>
                      <div className="flex justify-between gap-3"><span className="text-[var(--color-foreground-subtlest)]">Duration</span><span className="font-mono tabular-nums text-[var(--color-fg)]">{selRow.e2?.ms != null ? `${selRow.e2.ms}ms` : "—"}</span></div>
                    </>
                  )}
                </div>
              )}
              {selTab === "preview" && (
                <div className="flex flex-col gap-2 text-ui-xs">
                  {isTool ? (
                    <>
                      <div className="font-mono text-ui-2xs font-bold uppercase tracking-wide text-[var(--color-foreground-subtlest)]">Args</div>
                      <pre className="tool-result" style={{ maxHeight: 140 }}>{JSON.stringify(selRow.e.args ?? {}, null, 2)}</pre>
                      <div className="font-mono text-ui-2xs font-bold uppercase tracking-wide text-[var(--color-foreground-subtlest)]">Result</div>
                      <pre className="tool-result" style={{ maxHeight: 200 }}>{String(selRow.e2?.result ?? "(none)")}</pre>
                    </>
                  ) : (
                    <>
                      {think && (<><div className="font-mono text-ui-2xs font-bold uppercase tracking-wide text-[var(--color-foreground-subtlest)]">Thinking</div><pre className="tool-result" style={{ maxHeight: 180 }}>{think}</pre></>)}
                      {contents && (<><div className="font-mono text-ui-2xs font-bold uppercase tracking-wide text-[var(--color-foreground-subtlest)]">Content</div><pre className="tool-result" style={{ maxHeight: 180 }}>{contents}</pre></>)}
                      {tools.length > 0 && (<><div className="font-mono text-ui-2xs font-bold uppercase tracking-wide text-[var(--color-foreground-subtlest)]">Tool calls</div>{tools.map((tl, i) => <pre key={i} className="tool-result" style={{ maxHeight: 100 }}>{String(tl.name ?? "")} {String(tl.args ?? "")}</pre>)}</>)}
                    </>
                  )}
                </div>
              )}
              {selTab === "raw" && <pre className="tool-result" style={{ maxHeight: "100%" }}>{JSON.stringify(roundEntries, null, 2)}</pre>}
            </div>
          </div>
        );
      })()}

      {/* Footer stats — dsh format */}
      <div className="flex flex-wrap gap-x-2.5 gap-y-1 border-t border-[var(--color-border)] px-2.5 py-1.5 font-mono text-ui-2xs text-[var(--color-foreground-subtlest)]">
        <span>{stats.turns} turns · {stats.steps} steps</span>
        <span aria-hidden className="text-[var(--color-border-hover)]">|</span>
        <span>LLM {fmtMs(stats.llmMs)} · Tool call {fmtMs(stats.toolMs)}</span>
        <span aria-hidden className="text-[var(--color-border-hover)]">|</span>
        <span>TTFT avg {fmtMs(stats.ttft)} · {Math.round(stats.tps)} tok/s</span>
        <span aria-hidden className="text-[var(--color-border-hover)]">|</span>
        <span>Cache hit {Math.round(stats.cache * 100)}%</span>
        <span aria-hidden className="text-[var(--color-border-hover)]">|</span>
        <span>Input {fmtTok(stats.inTok)} tok · Output {fmtTok(stats.outTok)} tok</span>
      </div>
    </div>
  );
}
