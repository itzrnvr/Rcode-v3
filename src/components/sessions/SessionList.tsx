/*
 * PURPOSE: Left sidebar — navigation, conversation list, profile footer
 *
 * Layout (top to bottom):
 *   1. Top nav (New Chat + Search)
 *   2. Recents (collapsible)
 *   3. Profile footer (collapses to avatar only when collapsed)
 *
 * When `collapsed` is true:
 *   - Sidebar width shrinks to 0px via .panel-sessions.collapsed
 *   - Only avatars/icons remain visible (via CSS :has or class)
 *
 * Right-click on session → context menu (Delete, Promote, Rename)
 */

import { useState, useCallback } from "react";

import { useApp } from "../../state/AppContext";
import { useSessions } from "../../state/useSessions";
import { api } from "../../api/client";

import { ContextMenu, type ContextMenuItem } from "../common/ContextMenu";
import {
  PlusIcon,
  SearchIcon,
  MessagesSquareIcon,
  ChevronDownIcon,
  ChevronsLeftIcon,
  SettingsIcon,
  PinIcon,
  PenIcon,
  ArchiveIcon,
  FolderIcon,
  CompassIcon,
  SparkleIcon,
  HistoryIcon,
  GitForkIcon,
} from "../common/Icons";

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

export function SessionList({ collapsed, onToggleCollapse, width }: SessionListProps) {
  const {
    currentSessionId,
    setCurrentSessionId,
    sessionListVersion,
    bumpSessionList,
    settings,
    setShowSettings,
  } = useApp();
  const { sessions, loading, deleteSession } = useSessions(sessionListVersion);
  const [menu, setMenu] = useState<{ x: number; y: number; sessionId: string } | null>(null);
  // Pinned and Projects default to collapsed: both are empty on a fresh
  // install, and two empty sections with "No pinned chats" / "No projects"
  // under them pushed the session list - the only thing this sidebar is for -
  // below the fold. Recents stays open because that is the content.
  const [recentsOpen, setRecentsOpen] = useState(true);
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [activeNav, setActiveNav] = useState("chat");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);

  // Derive ordered sessions from localOrder if set, otherwise from DB
  const orderedSessions = (() => {
    if (!localOrder) return sessions;
    const byId: Record<string, typeof sessions[number]> = Object.fromEntries(sessions.map(s => [s.id, s]));
    const ordered: typeof sessions = [];
    for (const id of localOrder) {
      const s = byId[id];
      if (s) ordered.push(s);
    }
    // Append any new sessions not in localOrder (e.g., newly created)
    for (const s of sessions) if (!localOrder.includes(s.id)) ordered.push(s);
    return ordered;
  })();

  const newChat = useCallback(async () => {
    setCurrentSessionId(null);
    setActiveNav("chat");
  }, [setCurrentSessionId]);

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
    if (!s) return;
    setEditingId(menu.sessionId);
    setEditTitle(s.title);
    setMenu(null);
  }, [menu, sessions]);

  const submitRename = useCallback(async () => {
    if (!editingId || !editTitle.trim()) { setEditingId(null); return; }
    await api.updateSession(editingId, { title: editTitle.trim() });
    setEditingId(null);
    bumpSessionList();
  }, [editingId, editTitle, bumpSessionList]);

  const handleArchive = useCallback(async () => {
    if (!menu) return;
    await api.updateSession(menu.sessionId, { status: "closed" as const });
    if (currentSessionId === menu.sessionId) setCurrentSessionId(null);
    setMenu(null);
    bumpSessionList();
  }, [menu, currentSessionId, setCurrentSessionId, bumpSessionList]);

  const handleTogglePin = useCallback(async (id: string) => {
    await api.togglePinSession(id);
    bumpSessionList();
  }, [bumpSessionList]);

  const menuItems: ContextMenuItem[] = [
    { label: "Copy session ID", onClick: () => { if (menu) navigator.clipboard.writeText(menu.sessionId); } },
    { label: "Rename", onClick: handleRename },
    { label: "Archive", onClick: handleArchive },
    { label: "Promote to main session", onClick: handlePromote },
    { label: "Delete", onClick: handleDelete, danger: true },
  ];

  if (collapsed) {
    return (
      <div className="panel-sessions collapsed" style={{ width: width ?? 52, minWidth: width ?? 52 }}>
        <button
          className="sidebar-collapsed-newchat"
          onClick={newChat}
          title="New chat"
          aria-label="New chat"
        >
          <PlusIcon size={16} />
        </button>

        <button
          className="sidebar-collapsed-profile"
          onClick={() => setShowSettings(true)}
          title="Settings"
          aria-label="Open settings"
        >
          <SettingsIcon size={16} />
        </button>
      </div>
    );
  }

  return (
    <div className="panel-sessions">

      {/*
        Only New chat for now. Pull requests, Scheduled and Plugins were empty
        onClick handlers - navigation to nowhere - so they read as features that
        existed. Removed until they do something.
      */}
      <div className="sidebar-section codex-nav">
        <button
          className={`sidebar-nav-btn ${activeNav === "new" ? "active" : ""}`}
          onClick={newChat}
        >
          <PlusIcon size={16} />
          <span className="sidebar-nav-btn-label">New chat</span>
        </button>
      </div>
      {/* Search — Codex-style button */}
      <div className="sidebar-section" style={{paddingTop:4}}>
        <button
          className="sidebar-nav-btn"
          onClick={() => window.dispatchEvent(new CustomEvent("open-search-palette"))}
          title="Search"
          aria-label="Search"
        >
          <SearchIcon size={16} />
          <span className="sidebar-nav-btn-label">Search</span>
        </button>
      </div>

      {/* Pinned */}
      <button
        className="sidebar-section-title-button"
        onClick={() => setPinnedOpen(o => !o)}
        aria-expanded={pinnedOpen}
      >
        <span className="sidebar-section-title">Pinned</span>
        <ChevronDownIcon
          size={12}
          className={pinnedOpen ? "" : "chevron-closed"}
        />
      </button>
      {pinnedOpen && (() => {
        const pinned = orderedSessions.filter(s => s.isPinned);
        if (pinned.length === 0) {
          return <div className="sidebar-empty-hint">No pinned chats</div>;
        }
        return (
          <div className="sidebar-pinned">
            {pinned.map(s => (
              <div
                key={s.id}
                className={`session-item pinned ${currentSessionId === s.id ? "active" : ""}`}
                onClick={() => { setCurrentSessionId(s.id); setActiveNav("chat"); }}
                title={s.title}
                style={{flexDirection:'row', alignItems:'center', gap:8}}
              >
                <PinIcon size={12} className="pin-icon" />
                <span className="session-item-title" style={{flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{s.title}</span>
                {s.parentId && <span title="Forked session" style={{display:'flex', color:'#9a7fd8', opacity:.85}}><GitForkIcon size={11} /></span>}
                <button
                  className="session-action-btn"
                  onClick={e => { e.stopPropagation(); handleTogglePin(s.id); }}
                  title="Unpin"
                  aria-label="Unpin"
                  style={{opacity:0.7}}
                >
                  <PinIcon size={12} />
                </button>
              </div>
            ))}
          </div>
        );
      })()}

      <button
        className="sidebar-section-title-button"
        onClick={() => setProjectsOpen(o => !o)}
        aria-expanded={projectsOpen}
      >
        <span className="sidebar-section-title">Projects</span>
        <ChevronDownIcon
          size={12}
          className={projectsOpen ? "" : "chevron-closed"}
        />
      </button>
      {projectsOpen && <div className="sidebar-empty-hint">No projects</div>}

      {/* Recents / Conversations */}
      <button
        className="sidebar-section-title-button"
        onClick={() => setRecentsOpen(o => !o)}
        aria-expanded={recentsOpen}
      >
        <span className="sidebar-section-title">Recents</span>
        <ChevronDownIcon
          size={12}
          className={recentsOpen ? "" : "chevron-closed"}
        />
      </button>

      {recentsOpen && (
        <div className="sidebar-list">
          {loading && <div className="sidebar-loading">Loading…</div>}
          {!loading && sessions.length === 0 && (
            <div className="empty-state">
              <MessagesSquareIcon size={28} className="empty-icon" />
              <span>No conversations yet</span>
              <span className="empty-hint">Click "New Chat" to start</span>
            </div>
          )}
          {orderedSessions.filter(s => !s.isPinned).slice(0, 30).map(session => (
            <div
              key={session.id}
              className={`session-item ${currentSessionId === session.id ? "active" : ""}`}
              draggable={!editingId}
              onDragStart={() => setDraggedId(session.id)}
              onDragOver={e => {
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
              }}
              onDragEnd={() => {
                setDraggedId(null);
                // Persist to DB — use functional to get latest order (avoids stale closure)
                setLocalOrder(prev => {
                  if (prev) api.reorderSessions(prev);
                  return prev;
                });
              }}
              style={{ opacity: draggedId === session.id ? 0.5 : 1, cursor: editingId ? "default" : "pointer" }}
              onClick={() => {
                if (editingId !== session.id) { setCurrentSessionId(session.id); setActiveNav("chat"); }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, sessionId: session.id });
              }}
            >
              {editingId === session.id ? (
                <input
                  className="session-rename-input"
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  onBlur={submitRename}
                  onKeyDown={e => { if (e.key === "Enter") submitRename(); if (e.key === "Escape") setEditingId(null); }}
                  autoFocus
                  onClick={e => e.stopPropagation()}
                />
              ) : (
                <>
                  <div className="session-item-title">
                    <span className="session-item-title-text">{session.title}</span>
                    {session.parentId && (
                      <span className="session-item-fork" title="Forked session">
                        <GitForkIcon size={11} />
                      </span>
                    )}
                  </div>
                  <div className="session-item-time">{formatTimeAgo(session.updatedAt)}</div>
                  <div className="session-item-actions">
                    <button
                      className="session-action-btn"
                      onClick={e => { e.stopPropagation(); handleTogglePin(session.id); }}
                      title={session.isPinned ? "Unpin" : "Pin to top"}
                      aria-label={session.isPinned ? "Unpin" : "Pin"}
                      style={session.isPinned ? { color: 'var(--color-fg)', opacity: 1 } : undefined}
                    >
                      <PinIcon size={12} />
                    </button>
                    <button
                      className="session-action-btn"
                      onClick={e => { e.stopPropagation(); setEditingId(session.id); setEditTitle(session.title); }}
                      title="Rename"
                      aria-label="Rename"
                    >
                      <PenIcon size={12} />
                    </button>
                    <button
                      className="session-action-btn"
                      onClick={e => { e.stopPropagation(); api.updateSession(session.id, { status: "closed" as const }).then(() => { if (currentSessionId === session.id) setCurrentSessionId(null); bumpSessionList(); }); }}
                      title="Archive"
                      aria-label="Archive"
                    >
                      <ArchiveIcon size={12} />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onClose={() => setMenu(null)}
        />
      )}

      {/* Settings footer */}
      <button
        className="sidebar-profile"
        onClick={() => setShowSettings(true)}
        title="Settings"
        aria-label="Open settings"
      >
        <SettingsIcon size={16} />
        <span className="sidebar-profile-label">Settings</span>
      </button>
    </div>
  );
}
