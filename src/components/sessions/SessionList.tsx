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
 * Collapse is the prototype's drawer motion rather than the old 52px icon
 * rail: the panel animates to width 0 with its content held at a fixed width
 * (see .panel-sessions in index.css) and the titlebar toggle brings it back.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { useApp } from "../../state/AppContext";
import { useSessions } from "../../state/useSessions";
import { api } from "../../api/client";
import { cn } from "../../lib/utils";

import { Collapsible, CollapsibleContent } from "../ui/collapsible";
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
          same x whether or not the row ever shows a spinner. */}
      <span aria-hidden className="size-3.5 shrink-0" />
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
  currentSessionId: string | null;
  editingId: string | null;
  editTitle: string;
  setEditTitle: (v: string) => void;
  submitRename: () => void;
  cancelRename: () => void;
  onOpen: (id: string) => void;
  onTogglePin: (id: string) => void;
  onStartRename: (id: string, title: string) => void;
  onArchive: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
  dragProps?: SessionRowProps["dragProps"];
  dragging?: boolean;
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
 */
function SessionItem({
  session,
  sideChats,
  currentSessionId,
  editingId,
  editTitle,
  setEditTitle,
  submitRename,
  cancelRename,
  onOpen,
  onTogglePin,
  onStartRename,
  onArchive,
  onContextMenu,
  dragProps,
  dragging,
}: SessionItemProps) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  const active = currentSessionId === session.id;
  const editing = editingId === session.id;

  const rowProps = {
    title: session.title,
    time: formatTimeAgo(session.updatedAt),
    pinned: !!session.isPinned,
    forked: !!session.parentId,
    active,
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
    <Collapsible open={open} onOpenChange={setOpen} className="oui-branch">
      <div
        className={cn("session-row relative", ROW_CLASS, active && ROW_ACTIVE, ROW_FOCUS)}
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
            setOpen(o => !o);
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
        <span className="relative flex h-6 w-[72px] shrink-0 items-center justify-end">
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
            const childEditing = editingId === tab.sideChatId;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => { if (!childEditing) onOpen(tab.sideChatId); }}
                onContextMenu={e => onContextMenu(e, tab.sideChatId)}
                title={tab.sideChatTitle ?? "Side chat"}
                className={cn(
                  "flex min-h-9 w-full items-center gap-2 rounded-[var(--radius-sm)] py-1 pl-4 pr-2 text-left transition-colors duration-200 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-accent)]",
                  tab.sideChatId === currentSessionId
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
}

export function SessionList({ collapsed, onToggleCollapse: _onToggleCollapse, width }: SessionListProps) {
  const {
    currentSessionId,
    setCurrentSessionId,
    sessionListVersion,
    bumpSessionList,
    sideChatVersion,
    settings,
    setShowSettings,
  } = useApp();
  const { sessions, loading, deleteSession } = useSessions(sessionListVersion);
  const [menu, setMenu] = useState<{ x: number; y: number; sessionId: string } | null>(null);
  const [pinnedOpen, setPinnedOpen] = useState(true);
  const [recentsOpen, setRecentsOpen] = useState(true);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  // Side chats per parent session id, straight from the DB. Refreshed with
  // the session list and with sideChatVersion, which the chat view and the
  // side panel bump whenever a side chat is created, closed or promoted.
  const [sideChatsByParent, setSideChatsByParent] = useState<Record<string, SideChatTab[]>>({});

  // The panel collapses to width 0; the fixed-width inner needs the last open
  // width to hold its layout during the animation, so the open width is
  // remembered and reused while collapsed.
  const lastOpenWidth = useRef(width ?? 280);
  if (!collapsed && width) lastOpenWidth.current = width;
  const panelVar = { "--panel-sessions-w": `${lastOpenWidth.current}px` } as CSSProperties;

  // Derive ordered sessions from localOrder if set, otherwise from DB
  const orderedSessions = useMemo(() => {
    if (!localOrder) return sessions;
    const byId: Record<string, Session> = Object.fromEntries(sessions.map(s => [s.id, s]));
    const ordered: Session[] = [];
    for (const id of localOrder) {
      const s = byId[id];
      if (s) ordered.push(s);
    }
    // Append any new sessions not in localOrder (e.g., newly created)
    for (const s of sessions) if (!localOrder.includes(s.id)) ordered.push(s);
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
        const next: Record<string, SideChatTab[]> = {};
        ids.forEach((id, i) => {
          if (lists[i].length) next[id] = lists[i];
        });
        setSideChatsByParent(next);
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

  const submitRename = useCallback(async () => {
    if (!editingId || !editTitle.trim()) { setEditingId(null); return; }
    await api.updateSession(editingId, { title: editTitle.trim() });
    setEditingId(null);
    bumpSessionList();
  }, [editingId, editTitle, bumpSessionList]);

  const cancelRename = useCallback(() => setEditingId(null), []);

  const handleArchive = useCallback(async (id: string) => {
    await api.updateSession(id, { status: "closed" as const });
    if (currentSessionId === id) setCurrentSessionId(null);
    bumpSessionList();
  }, [currentSessionId, setCurrentSessionId, bumpSessionList]);

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

  const shared = {
    currentSessionId,
    editingId,
    editTitle,
    setEditTitle,
    submitRename,
    cancelRename,
    onOpen: (id: string) => setCurrentSessionId(id),
    onTogglePin: handleTogglePin,
    onStartRename: (id: string, title: string) => { setEditingId(id); setEditTitle(title); },
    onArchive: handleArchive,
    onContextMenu: (e: React.MouseEvent, id: string) => {
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY, sessionId: id });
    },
  };

  const dragHandlers = (session: Session) => ({
    draggable: editingId !== session.id,
    onDragStart: () => setDraggedId(session.id),
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      if (!draggedId || draggedId === session.id) return;
      setLocalOrder(prev => {
        const order = prev ?? sessions.map(s => s.id);
        const from = order.indexOf(draggedId);
        const to = order.indexOf(session.id);
        if (from === -1 || to === -1) return order;
        const next = [...order];
        next.splice(from, 1);
        next.splice(to, 0, draggedId);
        return next;
      });
    },
    onDragEnd: () => {
      setDraggedId(null);
      // Persist to DB — use functional to get latest order (avoids stale closure)
      setLocalOrder(prev => {
        if (prev) api.reorderSessions(prev);
        return prev;
      });
    },
  });

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
                sideChats={sideChatsByParent[session.id] ?? []}
                {...shared}
                dragProps={dragHandlers(session)}
                dragging={draggedId === session.id}
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
                sideChats={sideChatsByParent[session.id] ?? []}
                {...shared}
                dragProps={dragHandlers(session)}
                dragging={draggedId === session.id}
              />
            ))}
          </div>
        )}
      </div>

      {/* There is no account here, so the footer is not a profile: a Settings
          entry and the local model server state, on one row. Settings takes
          the room it needs; the server status rides on the right and truncates
          first, because the status is reference information and the entry is
          an action. */}
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
        <div
          title={`Local model server · ${settings.providerName}`}
          className="flex min-w-0 shrink items-center gap-1.5 text-ui-xs text-[var(--color-foreground-subtlest)]"
        >
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full bg-[var(--color-success)]"
          />
          <span className="min-w-0 truncate">{settings.providerName}</span>
        </div>
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
