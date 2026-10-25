/*
 * PURPOSE: Left sidebar — the One UI session drawer
 *
 * Ported from the One UI prototype (src/components/dev/OneUIDemo.tsx +
 * src/oneui.css): a quiet bordered New chat pill beside a search icon button,
 * Pinned/Recents sections under plain uppercase labels, 48px session rows with
 * the title and its age stacked, side chats nested under their parent session
 * behind a chevron (title opens the session, chevron expands the branch), and
 * a footer that puts Settings and the local model server on one row.
 *
 * The data is the app's own: sessions come from electron/db via useSessions,
 * and the side chats nested under each parent come from
 * api.getSideChatTabs(parentSessionId) — no mock data anywhere. Everything the
 * old sidebar could do still works: open sessions and side chats, pinning,
 * rename, archive, delete, promote, drag-to-reorder, search palette, settings.
 *
 * Rows carry a reserved leading slot that shows a pulsing loader while that
 * session has a turn in flight — the slot is empty at rest, so a row never
 * changes size when the indicator appears or disappears. The live state comes
 * from state/runningTurns, which useChat publishes to; branch rows, whose
 * leading slot is the chevron, carry the loader in the reserved trailing slot
 * instead. The list itself is stable under the user: drag reorders on drop
 * only (an aborted drag persists nothing), sessions the manual drag order
 * does not know yet keep their server position instead of falling to the end,
 * and the rows are memoized so a refresh re-renders only what changed.
 *
 * Collapse is the prototype's drawer motion rather than the old 52px icon
 * rail: the panel animates to width 0 with its content held at a fixed width
 * (see .panel-sessions in index.css) and the titlebar toggle brings it back.
 */

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { useApp } from "../../state/AppContext";
import { useSessions } from "../../state/useSessions";
import { useRunningTurn } from "../../state/runningTurns";
import { api } from "../../api/client";
import { cn } from "../../lib/utils";

import { Collapsible, CollapsibleContent } from "../ui/collapsible";
import { Spinner } from "../ui/spinner";
import { ContextMenu, type ContextMenuItem } from "../common/ContextMenu";
import {
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  PinIcon,
  PenIcon,
  ArchiveIcon,
  ChevronRightIcon,
  GitForkIcon,
} from "../common/Icons";

import type { Session, SideChatTab } from "../../types";

function formatTimeAgo(dateInput: string | number): string {
  const date = typeof dateInput === "number" ? new Date(dateInput) : new Date(dateInput);
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w`;
  return date.toLocaleDateString();
}

/* Shared empty array so rows without side chats keep a stable prop identity
   for the row memo — a fresh `?? []` per render would defeat it. */
const EMPTY_SIDE_CHATS: SideChatTab[] = [];

/* What a row renders of its side chats: id and title. A refetch that changes
   neither keeps the previous array so the row memo can skip the row. */
function sameTabs(a: SideChatTab[], b: SideChatTab[]): boolean {
  return a.length === b.length && a.every((t, i) => t.id === b[i].id && t.sideChatTitle === b[i].sideChatTitle);
}

/* The drag handlers the list owns once, bound per row inside SessionItem so
   a re-render elsewhere never hands a row new callbacks. */
interface DragHandlers {
  onDragStart: (id: string) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (id: string) => void;
  onDragEnd: () => void;
}

interface SessionListProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  width?: number;
}

/* Row geometry shared by plain rows and branch rows, straight from the
   prototype's SessionRow: 48px target, radius-md, title over age. */
const ROW_CLASS =
  "flex min-h-12 w-full items-center gap-2.5 rounded-[var(--radius-md)] px-3 py-1.5 transition-colors duration-200 hover:bg-[var(--color-hover)]";
const ROW_ACTIVE = "bg-[var(--color-selected)] hover:bg-[var(--color-selected)]";
const ROW_FOCUS =
  "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--color-accent)]";

/* One UI section label: 11px bold uppercase, the quietest heading on the
   panel. Doubles as the collapse toggle for a section, so the sections the
   old sidebar could collapse still collapse — without a chevron, which the
   prototype's labels don't carry. */
function SectionLabel({
  children,
  onClick,
  expanded,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  expanded?: boolean;
  className?: string;
}) {
  const classes = cn(
    "px-3 pb-2 pt-5 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--color-foreground-subtlest)]",
    className,
  );
  if (!onClick) return <div className={classes}>{children}</div>;
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onClick}
      className={cn(
        classes,
        "block w-full cursor-pointer text-left transition-colors duration-200 hover:text-[var(--color-foreground-subtle)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-accent)]",
      )}
    >
      {children}
    </button>
  );
}

/* Hover actions of a session row: pin, rename, archive as ghost icon
   buttons. They fade in over the row's reserved trailing slot; the static
   pin glyph yields while they are up (CSS in index.css). */
function RowActions({
  pinned,
  onPin,
  onRename,
  onArchive,
}: {
  pinned: boolean;
  onPin: () => void;
  onRename: () => void;
  onArchive: () => void;
}) {
  return (
    <span className="session-row-actions">
      <button
        type="button"
        className="session-row-action"
        onClick={e => { e.stopPropagation(); onPin(); }}
        title={pinned ? "Unpin" : "Pin to top"}
        aria-label={pinned ? "Unpin" : "Pin"}
      >
        <PinIcon size={13} />
      </button>
      <button
        type="button"
        className="session-row-action"
        onClick={e => { e.stopPropagation(); onRename(); }}
        title="Rename"
        aria-label="Rename"
      >
        <PenIcon size={13} />
      </button>
      <button
        type="button"
        className="session-row-action"
        onClick={e => { e.stopPropagation(); onArchive(); }}
        title="Archive"
        aria-label="Archive"
      >
        <ArchiveIcon size={13} />
      </button>
    </span>
  );
}

interface SessionRowProps {
  title: string;
  time: string;
  pinned?: boolean;
  forked?: boolean;
  active: boolean;
  running?: boolean;
  editing?: boolean;
  onOpen: () => void;
  onPin: () => void;
  onRename: () => void;
  onArchive: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  dragProps?: {
    draggable: boolean;
    onDragStart: () => void;
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
    onDragEnd: () => void;
  };
  dragging?: boolean;
  renameInput?: ReactNode;
}

/* A session without side chats: one row, the title button is the opener. The
   wrapper carries hover/selected treatment and the context menu so the whole
   row reads as one row; each button inside carries exactly one action. */
function SessionRow({
  title,
  time,
  pinned,
  forked,
  active,
  running,
  editing,
  onOpen,
  onPin,
  onRename,
  onArchive,
  onContextMenu,
  dragProps,
  dragging,
  renameInput,
}: SessionRowProps) {
  return (
    <div
      className={cn("session-row relative", ROW_CLASS, active && ROW_ACTIVE, ROW_FOCUS)}
      style={{ opacity: dragging ? 0.5 : 1, cursor: editing ? "default" : "pointer" }}
      onClick={() => { if (!editing) onOpen(); }}
      onContextMenu={onContextMenu}
      {...dragProps}
    >
      {/* Leading slot, reserved at a fixed width so every title starts at the
          same x whether or not the row ever shows a spinner. A running session
          marks itself with a pulsing loader there — opacity, not rotation, on
          purpose: the global reduced-motion guard freezes every animation to
          a single instant, which would leave a frozen half-arc that no longer
          reads as activity, while the pulse settles into the plain loader
          glyph at full opacity and still says "working" statically. */}
      {running ? (
        <Spinner className="size-3.5 shrink-0 animate-pulse" aria-label="Session running" />
      ) : (
        <span aria-hidden className="size-3.5 shrink-0" />
      )}
      {editing && renameInput ? (
        renameInput
      ) : (
        <button
          type="button"
          aria-label={`Open session: ${title}`}
          title={title}
          onClick={e => { e.stopPropagation(); onOpen(); }}
          className="min-w-0 flex-1 text-left focus-visible:outline-none"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate text-ui-sm font-medium text-[var(--color-fg)]">
              {title}
            </span>
            {forked && (
              <span className="shrink-0 text-[var(--color-foreground-subtlest)]" title="Forked session">
                <GitForkIcon size={11} />
              </span>
            )}
          </span>
          <span className="block text-ui-xs text-[var(--color-foreground-subtlest)]">{time}</span>
        </button>
      )}
      {/* Reserved trailing slot: the pin glyph at rest, the action cluster on
          hover. Fixed width so the title truncates against it instead of
          sliding under the buttons. */}
      <span className="relative flex h-6 w-[72px] shrink-0 items-center justify-end">
        {pinned && (
          <PinIcon size={14} className="session-row-pin shrink-0 text-[var(--color-foreground-subtlest)]" />
        )}
        <RowActions pinned={!!pinned} onPin={onPin} onRename={onRename} onArchive={onArchive} />
      </span>
    </div>
  );
}

interface SessionItemProps {
  session: Session;
  sideChats: SideChatTab[];
  /* Derived per row by the list (active, editing, open) instead of passing
     the shared raw state down: primitive props that only change for the rows
     they concern are what lets the row memo skip the rest of the list. */
  active: boolean;
  editing: boolean;
  /* Same derivation for the children: the row's side chat that is open /
     being renamed, or null — so switching sessions or renaming elsewhere
     leaves this prop untouched for every other row. */
  activeChild: string | null;
  editingChild: string | null;
  editTitle: string;
  setEditTitle: (v: string) => void;
  submitRename: () => void;
  cancelRename: () => void;
  onOpen: (id: string) => void;
  onTogglePin: (id: string) => void;
  onStartRename: (id: string, title: string) => void;
  onArchive: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
  /* The branch's expanded state lives in the list, keyed by session id:
     pinning moves the row between the two section parents, which remounts
     it, and only state held above them survives that move. */
  open: boolean;
  onToggleOpen: (id: string) => void;
  draggable: boolean;
  dragHandlers: DragHandlers;
  dragging: boolean;
}

/*
 * A session with side chats keeps two intents apart, exactly as the prototype
 * does: the title is its own button that OPENS the session, and the chevron
 * is a sibling button that toggles the branch. The two cannot nest — a button
 * inside a button is invalid HTML and breaks keyboard interaction — so the
 * row is a plain wrapper div carrying the shared hover/selected treatment
 * while each button carries exactly one action. Children sit behind a
 * vertical guide line hanging from the chevron column, read smaller and
 * muted, and are plain buttons that open their own session.
 *
 * The row is memoized: a list refresh re-renders only the rows whose inputs
 * actually changed. That only holds if the props it receives keep their
 * identity across renders — the callbacks come from the list as stable
 * useCallbacks, the shared drag handlers are bound per row here, and the
 * running mark arrives through the registry rather than through props.
 */
const SessionItem = memo(function SessionItem({
  session,
  sideChats,
  active,
  editing,
  activeChild,
  editingChild,
  editTitle,
  setEditTitle,
  submitRename,
  cancelRename,
  onOpen,
  onTogglePin,
  onStartRename,
  onArchive,
  onContextMenu,
  open,
  onToggleOpen,
  draggable,
  dragHandlers,
  dragging,
}: SessionItemProps) {
  // TEMP-VERIFY: render counter, removed after verification.
  (window as { __rowRenders?: number }).__rowRenders = ((window as { __rowRenders?: number }).__rowRenders ?? 0) + 1;
  const running = useRunningTurn(session.id);
  const contentId = useId();

  // The shared handlers bound to this row, memoized so the object spread
  // onto the row keeps its identity between renders.
  const dragProps = useMemo(
    () => ({
      draggable,
      onDragStart: () => dragHandlers.onDragStart(session.id),
      onDragOver: dragHandlers.onDragOver,
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        dragHandlers.onDrop(session.id);
      },
      onDragEnd: dragHandlers.onDragEnd,
    }),
    [draggable, session.id, dragHandlers],
  );

  const rowProps = {
    title: session.title,
    time: formatTimeAgo(session.updatedAt),
    pinned: !!session.isPinned,
    forked: !!session.parentId,
    active,
    running,
    editing,
    onOpen: () => onOpen(session.id),
    onPin: () => onTogglePin(session.id),
    onRename: () => onStartRename(session.id, session.title),
    onArchive: () => onArchive(session.id),
    onContextMenu: (e: React.MouseEvent) => onContextMenu(e, session.id),
    dragProps,
    dragging,
  };

  if (!sideChats.length) {
    return (
      <SessionRow
        {...rowProps}
        renameInput={
          <input
            className="session-rename-input min-w-0 flex-1"
            value={editTitle}
            onChange={e => setEditTitle(e.target.value)}
            onBlur={submitRename}
            onKeyDown={e => { if (e.key === "Enter") submitRename(); if (e.key === "Escape") cancelRename(); }}
            autoFocus
            onClick={e => e.stopPropagation()}
          />
        }
      />
    );
  }

  return (
    <Collapsible open={open} onOpenChange={() => onToggleOpen(session.id)} className="oui-branch">
      <div
        className={cn("session-row group relative", ROW_CLASS, active && ROW_ACTIVE, ROW_FOCUS)}
        style={{ opacity: dragging ? 0.5 : 1, cursor: editing ? "default" : "pointer" }}
        onClick={() => { if (!editing) onOpen(session.id); }}
        onContextMenu={e => onContextMenu(e, session.id)}
        {...dragProps}
      >
        {/* Branch toggle: the ONLY thing that expands/collapses the side
            chats. Sibling of the title button, never nested inside it. */}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          aria-label={
            open
              ? `Collapse side chats for ${session.title}`
              : `Expand side chats for ${session.title}`
          }
          onClick={event => {
            event.stopPropagation();
            onToggleOpen(session.id);
          }}
          className="-mx-2 flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--color-foreground-subtlest)] transition-colors duration-200 hover:bg-[var(--color-hover)] focus-visible:outline-none"
        >
          <ChevronRightIcon
            size={14}
            className={cn("oui-branch-chevron", open && "rotate-90")}
          />
        </button>
        {editing ? (
          <input
            className="session-rename-input min-w-0 flex-1"
            value={editTitle}
            onChange={e => setEditTitle(e.target.value)}
            onBlur={submitRename}
            onKeyDown={e => { if (e.key === "Enter") submitRename(); if (e.key === "Escape") cancelRename(); }}
            autoFocus
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <button
            type="button"
            aria-label={`Open session: ${session.title}`}
            title={session.title}
            onClick={e => { e.stopPropagation(); onOpen(session.id); }}
            className="min-w-0 flex-1 text-left focus-visible:outline-none"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="min-w-0 truncate text-ui-sm font-medium text-[var(--color-fg)]">
                {session.title}
              </span>
              {session.parentId && (
                <span className="shrink-0 text-[var(--color-foreground-subtlest)]" title="Forked session">
                  <GitForkIcon size={11} />
                </span>
              )}
            </span>
            <span className="block text-ui-xs text-[var(--color-foreground-subtlest)]">
              {formatTimeAgo(session.updatedAt)}
            </span>
          </button>
        )}
        <span className="relative flex h-6 w-[72px] shrink-0 items-center justify-end gap-1">
          {/* The branch row's leading slot is the chevron, so the running
              loader rides the reserved trailing slot instead — packed against
              the pin inside a fixed width, so appearing and disappearing
              never moves the row, and it hides while the hover actions are
              up the way the pin glyph yields to them. */}
          {running && (
            <Spinner
              className="size-3.5 shrink-0 animate-pulse group-hover:invisible"
              aria-label="Session running"
            />
          )}
          {!!session.isPinned && (
            <PinIcon size={14} className="session-row-pin shrink-0 text-[var(--color-foreground-subtlest)]" />
          )}
          <RowActions
            pinned={!!session.isPinned}
            onPin={() => onTogglePin(session.id)}
            onRename={() => onStartRename(session.id, session.title)}
            onArchive={() => onArchive(session.id)}
          />
        </span>
      </div>
      <CollapsibleContent id={contentId}>
        <div className="mb-1 ml-[19px] flex flex-col gap-0.5 border-l border-[var(--color-border)] py-0.5">
          {sideChats.map(tab => {
            const childEditing = editingChild === tab.sideChatId;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => { if (!childEditing) onOpen(tab.sideChatId); }}
                onContextMenu={e => onContextMenu(e, tab.sideChatId)}
                title={tab.sideChatTitle ?? "Side chat"}
                className={cn(
                  "flex min-h-9 w-full items-center gap-2 rounded-[var(--radius-sm)] py-1 pl-4 pr-2 text-left transition-colors duration-200 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-accent)]",
                  tab.sideChatId === activeChild
                    ? "bg-[var(--color-selected)] hover:bg-[var(--color-selected)]"
                    : "hover:bg-[var(--color-hover)]",
                )}
              >
                {childEditing ? (
                  <input
                    className="session-rename-input min-w-0 flex-1"
                    value={editTitle}
                    onChange={e => setEditTitle(e.target.value)}
                    onBlur={submitRename}
                    onKeyDown={e => { if (e.key === "Enter") submitRename(); if (e.key === "Escape") cancelRename(); }}
                    autoFocus
                    onClick={e => e.stopPropagation()}
                  />
                ) : (
                  <>
                    <span aria-hidden className="size-1.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-ui-xs text-[var(--color-foreground-subtle)]">
                      {tab.sideChatTitle ?? "Side chat"}
                    </span>
                    <span className="shrink-0 text-ui-2xs text-[var(--color-foreground-subtlest)]">
                      {formatTimeAgo(tab.createdAt)}
                    </span>
                  </>
                )}
              </button>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
});

export function SessionList({ collapsed, onToggleCollapse: _onToggleCollapse, width }: SessionListProps) {
  const {
    currentSessionId,
    setCurrentSessionId,
    sessionListVersion,
    bumpSessionList,
    sideChatVersion,
    setShowSettings,
  } = useApp();
  const { sessions, loading, deleteSession } = useSessions(sessionListVersion);
  const [menu, setMenu] = useState<{ x: number; y: number; sessionId: string } | null>(null);
  const [pinnedOpen, setPinnedOpen] = useState(true);
  const [recentsOpen, setRecentsOpen] = useState(true);
  const [projectsOpen, setProjectsOpen] = useState(false);
  // Which parent rows have their side-chat branch expanded, keyed by session
  // id and held above the two sections: pinning moves a row between the
  // Pinned and Recents parents, which remounts it, and only state held above
  // them survives that move.
  const [expandedBranches, setExpandedBranches] = useState<Set<string>>(() => new Set());
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  // Side chats per parent session id, straight from the DB. Refreshed with
  // the session list and with sideChatVersion, which the chat view and the
  // side panel bump whenever a side chat is created, closed or promoted.
  const [sideChatsByParent, setSideChatsByParent] = useState<Record<string, SideChatTab[]>>({});

  // Rename state mirrors into refs so the callbacks the rows receive stay
  // referentially stable while the text changes — otherwise every keystroke
  // would hand every row new props and defeat the row memo.
  const [editingId, setEditingIdState] = useState<string | null>(null);
  const [editTitle, setEditTitleState] = useState("");
  const editingIdRef = useRef<string | null>(null);
  const editTitleRef = useRef("");
  const setEditingId = useCallback((id: string | null) => {
    editingIdRef.current = id;
    setEditingIdState(id);
  }, []);
  const setEditTitle = useCallback((v: string) => {
    editTitleRef.current = v;
    setEditTitleState(v);
  }, []);

  // The drag source rides a ref too, so the drop handler can read it without
  // depending on it and the drag handlers stay stable for the whole drag.
  const draggedIdRef = useRef<string | null>(null);

  // The panel collapses to width 0; the fixed-width inner needs the last open
  // width to hold its layout during the animation, so the open width is
  // remembered and reused while collapsed.
  const lastOpenWidth = useRef(width ?? 280);
  if (!collapsed && width) lastOpenWidth.current = width;
  const panelVar = { "--panel-sessions-w": `${lastOpenWidth.current}px` } as CSSProperties;

  // Derive the display order: the manual drag order leads for the sessions it
  // names, and any session it does not know yet — created after the last
  // drag — drops into its server position instead of the end of the list, so
  // a new chat shows up where a fresh start would put it.
  const orderedSessions = useMemo(() => {
    if (!localOrder) return sessions;
    const byId = new Map(sessions.map(s => [s.id, s] as const));
    const serverIndex = new Map(sessions.map((s, i) => [s.id, i] as const));
    const ordered: Session[] = [];
    const placed = new Set<string>();
    for (const id of localOrder) {
      if (placed.has(id)) continue;
      placed.add(id);
      const s = byId.get(id);
      if (s) ordered.push(s);
    }
    for (const s of sessions) {
      if (placed.has(s.id)) continue;
      placed.add(s.id);
      // First manually-ordered session that comes later in the server order
      // marks where this one belongs; none means it belongs at the end.
      const at = ordered.findIndex(o => (serverIndex.get(o.id) ?? 0) > (serverIndex.get(s.id) ?? 0));
      if (at === -1) ordered.push(s);
      else ordered.splice(at, 0, s);
    }
    return ordered;
  }, [sessions, localOrder]);

  const pinned = useMemo(() => orderedSessions.filter(s => s.isPinned), [orderedSessions]);
  const recents = useMemo(() => orderedSessions.filter(s => !s.isPinned).slice(0, 30), [orderedSessions]);

  const branchKey = useMemo(
    () => [...pinned.map(s => s.id), ...recents.map(s => s.id)].join(","),
    [pinned, recents],
  );

  useEffect(() => {
    const ids = branchKey ? branchKey.split(",") : [];
    if (!ids.length) {
      setSideChatsByParent(prev => (Object.keys(prev).length ? {} : prev));
      return;
    }
    let cancelled = false;
    Promise.all(ids.map(id => api.getSideChatTabs(id).catch(() => [] as SideChatTab[])))
      .then(lists => {
        if (cancelled) return;
        setSideChatsByParent(prev => {
          const next: Record<string, SideChatTab[]> = {};
          let changed = false;
          ids.forEach((id, i) => {
            const tabs = lists[i];
            if (!tabs.length) return;
            const prevTabs = prev[id];
            next[id] = prevTabs && sameTabs(prevTabs, tabs) ? prevTabs : tabs;
            if (next[id] !== prevTabs) changed = true;
          });
          if (Object.keys(prev).some(id => !next[id])) changed = true;
          return changed ? next : prev;
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [branchKey, sideChatVersion]);

  const newChat = useCallback(() => {
    setCurrentSessionId(null);
  }, [setCurrentSessionId]);

  const openSearch = useCallback(() => {
    window.dispatchEvent(new CustomEvent("open-search-palette"));
  }, []);

  const handleDelete = useCallback(async () => {
    if (!menu) return;
    await deleteSession(menu.sessionId);
    if (currentSessionId === menu.sessionId) setCurrentSessionId(null);
    bumpSessionList();
  }, [menu, currentSessionId, deleteSession, setCurrentSessionId, bumpSessionList]);

  const handlePromote = useCallback(async () => {
    if (!menu) return;
    await api.promoteSideChat(menu.sessionId);
    bumpSessionList();
  }, [menu, bumpSessionList]);

  const handleRename = useCallback(() => {
    if (!menu) return;
    const s = sessions.find(x => x.id === menu.sessionId);
    if (s) {
      setEditingId(s.id);
      setEditTitle(s.title);
      setMenu(null);
      return;
    }
    // Side chats are not in the main list; their live title rides the tab row.
    for (const tabs of Object.values(sideChatsByParent)) {
      const t = tabs.find(x => x.sideChatId === menu.sessionId);
      if (t) {
        setEditingId(t.sideChatId);
        setEditTitle(t.sideChatTitle ?? "Side chat");
        setMenu(null);
        return;
      }
    }
  }, [menu, sessions, sideChatsByParent]);

  const startRename = useCallback((id: string, title: string) => {
    setEditingId(id);
    setEditTitle(title);
  }, [setEditingId, setEditTitle]);

  const submitRename = useCallback(async () => {
    const id = editingIdRef.current;
    const title = editTitleRef.current.trim();
    if (!id || !title) {
      setEditingId(null);
      return;
    }
    await api.updateSession(id, { title });
    setEditingId(null);
    bumpSessionList();
  }, [setEditingId, bumpSessionList]);

  const cancelRename = useCallback(() => setEditingId(null), [setEditingId]);

  const handleArchive = useCallback(async (id: string) => {
    await api.updateSession(id, { status: "closed" as const });
    setCurrentSessionId(prev => (prev === id ? null : prev));
    bumpSessionList();
  }, [setCurrentSessionId, bumpSessionList]);

  const handleTogglePin = useCallback(async (id: string) => {
    await api.togglePinSession(id);
    bumpSessionList();
  }, [bumpSessionList]);

  const menuItems: ContextMenuItem[] = [
    { label: "Copy session ID", onClick: () => { if (menu) navigator.clipboard.writeText(menu.sessionId); } },
    { label: "Rename", onClick: handleRename },
    { label: "Archive", onClick: () => { if (menu) void handleArchive(menu.sessionId); setMenu(null); } },
    { label: "Promote to main session", onClick: handlePromote },
    { label: "Delete", onClick: handleDelete, danger: true },
  ];

  // The callbacks every row receives, each stable across renders so the row
  // memo can do its work: a row re-renders only when one of its own inputs
  // changed.
  const openSession = useCallback((id: string) => setCurrentSessionId(id), [setCurrentSessionId]);

  const openMenu = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, sessionId: id });
  }, []);

  const toggleBranch = useCallback((id: string) => {
    setExpandedBranches(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onDragStartSession = useCallback((id: string) => {
    draggedIdRef.current = id;
    setDraggedId(id);
  }, []);

  // Allow the drop but change nothing while the drag is in flight: mutating
  // the order on every dragover made the rows shuffle under the cursor, so
  // the move is computed once, on drop.
  const onDragOverRow = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const onDropSession = useCallback((targetId: string) => {
    const dragged = draggedIdRef.current;
    if (!dragged || dragged === targetId) return;
    const from = orderedSessions.findIndex(s => s.id === dragged);
    const to = orderedSessions.findIndex(s => s.id === targetId);
    if (from === -1 || to === -1) return;
    const next = orderedSessions.map(s => s.id);
    next.splice(from, 1);
    next.splice(to, 0, dragged);
    setLocalOrder(next);
    void api.reorderSessions(next);
  }, [orderedSessions]);

  // dragEnd fires for drops AND for aborted drags (Escape, released outside
  // the list), so it only ever clears the feedback — the order was persisted
  // in onDrop or was never touched.
  const onDragEndRow = useCallback(() => {
    draggedIdRef.current = null;
    setDraggedId(null);
  }, []);

  const dragHandlers = useMemo<DragHandlers>(
    () => ({ onDragStart: onDragStartSession, onDragOver: onDragOverRow, onDrop: onDropSession, onDragEnd: onDragEndRow }),
    [onDragStartSession, onDragOverRow, onDropSession, onDragEndRow],
  );

  // Per-row props derived from the shared state, so each row receives only
  // the values that concern it — primitives that stay put for every other
  // row are what lets the row memo skip them.
  const itemProps = (session: Session) => {
    const tabs = sideChatsByParent[session.id] ?? EMPTY_SIDE_CHATS;
    const editingChild = tabs.some(t => t.sideChatId === editingId);
    return {
      sideChats: tabs,
      active: currentSessionId === session.id,
      editing: editingId === session.id,
      activeChild: tabs.some(t => t.sideChatId === currentSessionId) ? currentSessionId : null,
      editingChild: editingChild ? editingId : null,
      editTitle: editingId === session.id || editingChild ? editTitle : "",
      setEditTitle,
      submitRename,
      cancelRename,
      onOpen: openSession,
      onTogglePin: handleTogglePin,
      onStartRename: startRename,
      onArchive: handleArchive,
      onContextMenu: openMenu,
      open: expandedBranches.has(session.id),
      onToggleOpen: toggleBranch,
      draggable: editingId !== session.id,
      dragHandlers,
      dragging: draggedId === session.id,
    };
  };

  const content = (
    <div className="panel-sessions-inner">
      {/* Starting a chat is not a frequent action, so the button recedes: a
          neutral bordered pill on the sidebar ground — muted label and hairline
          border that both strengthen on hover. No accent: the accent stays
          reserved for selection and the composer send button. */}
      <div className="flex items-center gap-2 px-4 pb-2 pt-4">
        <button
          type="button"
          onClick={newChat}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3.5 text-ui-sm font-medium text-[var(--color-foreground-subtle)] transition-colors duration-200 hover:border-[var(--color-border-hover)] hover:bg-[var(--color-hover)] hover:text-[var(--color-fg)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-accent)]"
        >
          <PlusIcon size={16} />
          New chat
        </button>
        <button
          type="button"
          onClick={openSearch}
          aria-label="Search sessions"
          title="Search sessions (Ctrl+K)"
          className="ml-auto flex size-11 shrink-0 items-center justify-center rounded-full text-[var(--color-foreground-subtle)] transition-colors duration-200 hover:bg-[var(--color-hover)] hover:text-[var(--color-fg)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
        >
          <SearchIcon size={18} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <SectionLabel
          onClick={() => setPinnedOpen(o => !o)}
          expanded={pinnedOpen}
        >
          Pinned
        </SectionLabel>
        {pinnedOpen && (
          <div className="flex flex-col gap-0.5">
            {pinned.map(session => (
              <SessionItem
                key={session.id}
                session={session}
                {...itemProps(session)}
              />
            ))}
          </div>
        )}

        <SectionLabel
          onClick={() => setProjectsOpen(o => !o)}
          expanded={projectsOpen}
        >
          Projects
        </SectionLabel>
        {projectsOpen && <div className="px-3 pb-2 text-ui-xs text-[var(--color-foreground-subtlest)]">No projects</div>}

        <SectionLabel
          onClick={() => setRecentsOpen(o => !o)}
          expanded={recentsOpen}
        >
          Recents
        </SectionLabel>
        {recentsOpen && (
          <div className="flex flex-col gap-0.5">
            {loading && <div className="px-3 py-2 text-ui-xs text-[var(--color-foreground-subtlest)]">Loading…</div>}
            {!loading && sessions.length === 0 && (
              <div className="px-3 py-2 text-ui-xs text-[var(--color-foreground-subtlest)]">
                No conversations yet — start a new chat.
              </div>
            )}
            {recents.map(session => (
              <SessionItem
                key={session.id}
                session={session}
                {...itemProps(session)}
              />
            ))}
          </div>
        )}
      </div>

      {/* There is no account here, so the footer is not a profile. The local
          model server state that used to ride on the right of this row is
          gone: it duplicated what the composer's provider already shows, and
          the provider is the thing that actually changes under the user. */}
      <div className="flex items-center gap-2 border-t border-[var(--color-border)] p-3">
        <button
          type="button"
          onClick={() => setShowSettings(true)}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-[var(--radius-md)] px-3 text-left transition-colors duration-200 hover:bg-[var(--color-hover)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-accent)]"
        >
          <SettingsIcon size={18} className="shrink-0 text-[var(--color-foreground-subtle)]" />
          <span className="min-w-0 flex-1 truncate text-ui-sm font-medium text-[var(--color-fg)]">
            Settings
          </span>
        </button>
      </div>
    </div>
  );

  return (
    <div
      className="panel-sessions"
      data-collapsed={collapsed || undefined}
      style={panelVar}
    >
      {content}
    </div>
  );
}
