/*
 * PURPOSE: Right side panel — tab system in the One UI language
 *
 * The design source of truth is the prototype's side panel
 * (src/components/dev/OneUIDemo.tsx + .oui-sp-* rules in src/oneui.css):
 * a pill tab rail where side chats sync in beside terminal / review /
 * browser / trajectory tabs, an add-tab picker, a tab manager with search +
 * recently closed, and per-tab close. The panes are the real ones — this file
 * only carries the rail, the menus and the empty state; every pane keeps its
 * own data flow (SQLite side chats, PTY terminal, git IPC, trace IPC).
 *
 * Pills, not a segmented control: the tab set is open-ended (every side chat
 * becomes a tab, terminals multiply), widths vary with their titles, each tab
 * carries its own close action, and the rail scrolls when it overflows. The
 * rail hides its scrollbar and shows edge fades only on the sides that
 * actually overflow, so a short tab list never wears a fake cut-off. The
 * active pill takes the neutral --color-selected fill, like selected session
 * rows — the accent stays with the panes' primary actions and selection
 * markers.
 */

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from "react";

import { useApp } from "../../state/AppContext";
import { api } from "../../api/client";
import { useSideChats } from "../../state/useSideChats";
import { cn } from "../../lib/utils";

import { Input } from "../ui/input";

import {
  XIcon,
  MessageCircleIcon,
  Code2Icon,
  GlobeIcon,
  TerminalSquareIcon,
  PlusIcon,
  HistoryIcon,
  ActivityIcon,
  ChevronDownIcon,
} from "../common/Icons";
import { TerminalPane } from "./TerminalPane";
import { TrajectoryView } from "./TrajectoryView";
import { GitPanel } from "./GitPanel";
import { BrowserPane } from "./BrowserPane";
import { SideChatThread } from "./SideChatThread";

type ZTabType = "side-conversation" | "review" | "terminal" | "browser" | "trajectory";

interface ZTab {
  id: string;
  type: ZTabType;
  title: string;
  closedAt?: number;
}

const TAB_DEFS: Record<ZTabType, { label: string; Icon: React.FC<{ size?: number; className?: string }> }> = {
  "side-conversation": { label: "Side conversation", Icon: MessageCircleIcon },
  review: { label: "Review", Icon: Code2Icon },
  terminal: { label: "Terminal", Icon: TerminalSquareIcon },
  browser: { label: "Browser", Icon: GlobeIcon },
  trajectory: { label: "Trajectory", Icon: ActivityIcon },
};

const TAB_TYPES = Object.keys(TAB_DEFS) as ZTabType[];

function fmtAgo(ts?: number): string {
  if (!ts) return "";
  const m = Math.max(1, Math.round((Date.now() - ts) / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

/** Prototype empty state: the five tab types as quiet rows, no card boxes. */
function SidePanelEmpty({ onOpen }: { onOpen: (type: ZTabType) => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
      <div className="text-ui-sm font-medium text-[var(--color-fg)]">No tabs open</div>
      <p className="mt-1 text-ui-xs text-[var(--color-foreground-subtlest)]">
        Open a tool, or pick up a side conversation.
      </p>
      <div className="mt-4 flex w-full flex-col gap-0.5">
        {TAB_TYPES.map(type => {
          const Def = TAB_DEFS[type];
          return (
            <button
              key={type}
              type="button"
              onClick={() => onOpen(type)}
              className="flex min-h-11 w-full items-center gap-3 rounded-[var(--radius-md)] px-3 text-left text-ui-sm text-[var(--color-foreground-subtle)] transition-colors duration-200 hover:bg-[var(--color-hover)] hover:text-[var(--color-fg)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-accent)]"
            >
              <Def.Icon size={16} className="shrink-0" />
              {Def.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Fallback shown when the active side-conversation tab has no live DB row
 * (the placeholder tab created when a side chat was requested with no
 * session): an index of the session's real open and closed side chats.
 */
function SideChatIndex({
  sideTabs,
  sideClosedTabs,
  activeId,
  onOpen,
  onClose,
  onReopen,
}: {
  sideTabs: Array<{ sideChatId: string; sideChatTitle?: string }>;
  sideClosedTabs: Array<{ id: string; sideChatId: string; sideChatTitle?: string }>;
  activeId: string;
  onOpen: (sideChatId: string) => void;
  onClose: (sideChatId: string) => void;
  onReopen: (tabId: string, title: string) => void;
}) {
  const title = (t: { sideChatTitle?: string; sideChatId: string }) =>
    t.sideChatTitle?.trim() ? t.sideChatTitle : t.sideChatId.slice(0, 8);

  return (
    <div className="sidechat-index">
      <div className="sidechat-index-label">
        Side conversations · {sideTabs.length} open · {sideClosedTabs.length} closed
      </div>
      {sideTabs.length === 0 && sideClosedTabs.length === 0 ? (
        <div className="sidechat-index-empty">
          <div className="sidechat-index-empty-title">
            No side chats yet. Select text in the main chat and right-click → Create side chat.
          </div>
        </div>
      ) : (
        <>
          {sideTabs.length > 0 && (
            <div className="flex flex-col gap-0.5">
              {sideTabs.map(t => (
                <div key={t.sideChatId} className="sidechat-item">
                  <button
                    type="button"
                    className={cn("sidechat-item-open", t.sideChatId === activeId && "active")}
                    onClick={() => onOpen(t.sideChatId)}
                  >
                    <MessageCircleIcon size={14} />
                    <span className="sidechat-item-title">{title(t)}</span>
                  </button>
                  <button
                    type="button"
                    className="sidechat-item-close"
                    aria-label={`Close ${title(t)}`}
                    onClick={() => onClose(t.sideChatId)}
                  >
                    <XIcon size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {sideClosedTabs.length > 0 && (
            <div className="mt-2.5">
              <div className="sidechat-index-label">Recently closed</div>
              <div className="flex flex-col gap-0.5">
                {sideClosedTabs.map(t => (
                  <div key={t.id} className="sidechat-item sidechat-item-closed">
                    <span className="sidechat-item-open">
                      <HistoryIcon size={14} />
                      <span className="sidechat-item-title">{title(t)}</span>
                    </span>
                    <button
                      type="button"
                      className="sidechat-item-reopen"
                      onClick={() => onReopen(t.id, title(t))}
                    >
                      Reopen
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function SidePanel({ collapsed, width, onToggleCollapse: _onToggleCollapse }: { collapsed?: boolean; width?: number; onToggleCollapse?: () => void } = {}) {
  const { currentSessionId, sideChatVersion, settings, bumpSideChats, setHasSideChats } = useApp();
  const { tabs: sideTabs, closedTabs: sideClosedTabs, closeTab: closeSideChatTab, reopenTab: reopenSideChatTab } = useSideChats(currentSessionId, sideChatVersion);
  const [openTabs, setOpenTabs] = useState<ZTab[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [showPicker, setShowPicker] = useState(false);
  const [showManager, setShowManager] = useState(false);
  const [tabSearch, setTabSearch] = useState("");
  const [recentlyClosed, setRecentlyClosed] = useState<ZTab[]>([]);
  const [overflow, setOverflow] = useState({ start: false, end: false });

  const railRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const scopeId = useId();

  // The panel collapses to width 0; the fixed-width inner needs the last open
  // width to hold its layout during the animation — same mechanism the left
  // drawer uses (--panel-sessions-w).
  const lastOpenWidth = useRef(width ?? 320);
  if (!collapsed && width) lastOpenWidth.current = width;
  const panelVar = { "--panel-side-w": `${lastOpenWidth.current}px` } as CSSProperties;

  const activeTab = openTabs.find(t => t.id === activeId) ?? openTabs[0];

  // Sync real sideChats into pill bar: each SideChatTab becomes a ZTab.
  // Keeps non-side tabs (terminal/browser/review) untouched, replaces side-conversation pills with DB state.
  useEffect(() => {
    setOpenTabs(prev => {
      const hadPlaceholder = prev.some(t => t.type === "side-conversation" && t.id.startsWith("side-conversation-"));
      const keep = prev.filter(t => t.type !== "side-conversation");
      const mapped: ZTab[] = sideTabs.map(st => ({
        id: st.sideChatId,
        type: "side-conversation" as const,
        title: st.sideChatTitle?.trim() ? st.sideChatTitle : st.sideChatId.slice(0, 8),
      }));
      if (mapped.length === 0 && hadPlaceholder) {
        return [...keep, { id: "side-conversation-placeholder", type: "side-conversation" as const, title: "Side conversation" }];
      }
      return [...keep, ...mapped];
    });
    // Auto-select first side chat when it appears and terminal was active (so selection→Create is visible)
    if (sideTabs.length > 0 && (activeId === "" || activeId === "terminal")) {
      // don't auto-switch if user is on terminal/review/browser — only if no side pill was active
      const hasActiveSide = sideTabs.some(s => s.sideChatId === activeId);
      if (!hasActiveSide) setActiveId(sideTabs[0].sideChatId);
    }
  }, [sideTabs, activeId]);

  // Sync closed side chats into recentlyClosed picker (append, de-dupe, prune reopened)
  useEffect(() => {
    const mapped: ZTab[] = sideClosedTabs.map(st => ({
      id: st.sideChatId,
      type: "side-conversation" as const,
      title: st.sideChatTitle?.trim() ? st.sideChatTitle : st.sideChatId.slice(0, 8),
    }));
    setRecentlyClosed(prev => {
      const openIds = new Set(sideTabs.map(s => s.sideChatId));
      let next = prev.filter(p => !openIds.has(p.id));
      const byId = new Map(next.map(p => [p.id, p] as const));
      for (const m of mapped) if (!byId.has(m.id)) next = [...next, m];
      return next.slice(0, 10);
    });
  }, [sideClosedTabs, sideTabs]);

  const openNewTab = useCallback(async (type: ZTabType) => {
    // Side conversation = immediately fork a new side chat from the current session
    if (type === "side-conversation" && currentSessionId) {
      try {
        const parent = await api.getSession(currentSessionId);
        const result = await api.createSideChat({
          parentSessionId: currentSessionId,
          title: `Side: ${parent?.title ?? "chat"}`,
          model: settings.model,
          provider: settings.providerName,
        });
        bumpSideChats();
        setHasSideChats(true);
        setActiveId(result.session.id);
        setShowPicker(false);
        return;
      } catch (e) {
        console.error("create side chat failed", e);
      }
    }
    if (type === "trajectory") {
      const existing = openTabs.find(t => t.type === type);
      if (existing) {
        setActiveId(existing.id);
      } else {
        const nt: ZTab = { id: type, type, title: TAB_DEFS[type].label };
        setOpenTabs(prev => [nt, ...prev]);
        setActiveId(type);
      }
      setShowPicker(false);
      return;
    }
    const id = `${type}-${Date.now()}`;
    const title = TAB_DEFS[type].label + (type === "side-conversation" ? ` ${openTabs.filter(t => t.type === "side-conversation").length + 1}` : "");
    const nt: ZTab = { id, type, title };
    setOpenTabs(prev => [nt, ...prev]);
    setActiveId(id);
    setShowPicker(false);
  }, [openTabs, currentSessionId, settings.model, settings.providerName, bumpSideChats, setHasSideChats]);

  const closeTab = useCallback((id: string) => {
    const closing = openTabs.find(t => t.id === id);
    if (closing) setRecentlyClosed(prev => [{ ...closing, closedAt: Date.now() }, ...prev].slice(0, 8));
    const next = openTabs.filter(t => t.id !== id);
    setOpenTabs(next);
    if (activeId === id && next.length) setActiveId(next[0].id);
  }, [openTabs, activeId]);

  // Local close/reopen already refreshes via useSideChats internal refresh() — no bump needed (avoids double fetch)
  const handleCloseSideChat = async (tabId: string) => {
    try {
      // tabId here is a sideChatId; translate to the side_chat_tabs row id for the IPC
      const row = sideTabs.find(st => st.sideChatId === tabId) ?? sideClosedTabs.find(st => st.sideChatId === tabId);
      if (row) await closeSideChatTab(row.id);
    } catch (e) {
      console.error("closeSideChat failed", e);
    }
  };

  const handleReopenSideChat = async (tabId: string) => {
    try {
      await reopenSideChatTab(tabId);
    } catch (e) {
      console.error("reopenSideChat failed", e);
    }
  };

  // Plain per-render handlers (not memoised): they close over the fresh
  // sideTabs rows that the side-chat IPC calls need to resolve.
  const closePill = (tab: ZTab) => {
    if (tab.type === "side-conversation") void handleCloseSideChat(tab.id);
    closeTab(tab.id);
  };

  /**
   * Reopen from the manager. Side chats live in SQLite — a local append would
   * be wiped by the next DB sync, so their rows go back through the side-chat
   * IPC and the sync effect re-mounts the pill; plain panes stay local.
   */
  const reopenRecent = (tab: ZTab) => {
    if (tab.type === "side-conversation") {
      void handleReopenSideChat(tab.id);
      setActiveId(tab.id);
      setRecentlyClosed(prev => prev.filter(t => t.id !== tab.id));
      return;
    }
    setOpenTabs(prev => [...prev, tab]);
    setActiveId(tab.id);
    setRecentlyClosed(prev => prev.filter(t => t.id !== tab.id));
  };

  // Dismiss dropdowns on outside click or Escape; the trigger buttons are
  // exempt so the toggle click never fights the dismissal.
  useEffect(() => {
    if (!showPicker && !showManager) return;
    const onDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement;
      if (!el.closest("[data-sp-menu]") && !el.closest("[data-sp-trigger]")) {
        setShowPicker(false);
        setShowManager(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowPicker(false);
        setShowManager(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [showPicker, showManager]);

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ type: ZTabType; sideChatId?: string }>;
      if (!ce.detail?.type) return;
      if (ce.detail.type === "side-conversation" && ce.detail.sideChatId) {
        setActiveId(ce.detail.sideChatId);
        setShowPicker(false);
        return;
      }
      void openNewTab(ce.detail.type);
    };
    window.addEventListener("sidepanel:new-tab", handler as EventListener);
    return () => window.removeEventListener("sidepanel:new-tab", handler as EventListener);
  }, [openNewTab]);

  // Edge fades only when the rail actually overflows, so a short tab list
  // never wears a fake cut-off.
  const updateOverflow = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    const start = el.scrollLeft > 2;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setOverflow(prev => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, []);
  useEffect(() => {
    updateOverflow();
    const el = railRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateOverflow, { passive: true });
    const ro = new ResizeObserver(updateOverflow);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", updateOverflow);
      ro.disconnect();
    };
  }, [updateOverflow, openTabs]);

  // Keep the active pill in view when activation comes from the keyboard or
  // from closing a neighbour.
  useEffect(() => {
    tabRefs.current.get(activeId)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId]);

  // Roving tabindex on the rail: arrows move and activate, Home/End jump.
  const onRailKeyDown = (e: React.KeyboardEvent) => {
    const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (dir === 0 && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    if (openTabs.length === 0) return;
    const idx = Math.max(0, openTabs.findIndex(t => t.id === activeTab?.id));
    const next =
      e.key === "Home" ? 0 : e.key === "End" ? openTabs.length - 1 : (idx + dir + openTabs.length) % openTabs.length;
    const tab = openTabs[next];
    if (!tab) return;
    setActiveId(tab.id);
    tabRefs.current.get(tab.id)?.focus();
  };

  const q = tabSearch.trim().toLowerCase();
  const managerOpenTabs = openTabs.filter(t => TAB_DEFS[t.type] && (!q || t.title.toLowerCase().includes(q)));
  const managerClosed = recentlyClosed.filter(t => !q || t.title.toLowerCase().includes(q));

  return (
    <aside
      className="panel-side"
      aria-label="Side panel"
      data-collapsed={collapsed || undefined}
      style={panelVar}
    >
      <div className="panel-side-inner">
      {/* Header — tab manager, pill rail, new-tab picker */}
      <div className="sidepanel-toolbar">
        <button
          type="button"
          className="sidepanel-icon-btn"
          data-sp-trigger="1"
          aria-label="Tab list"
          title="Search tabs / resume closed tabs"
          aria-expanded={showManager}
          aria-haspopup="true"
          onClick={() => { setShowManager(v => !v); setShowPicker(false); }}
        ><ChevronDownIcon size={16} /></button>

        <div
          ref={railRef}
          className="sidepanel-tab-rail"
          role="tablist"
          aria-label="Side panel tabs"
          data-fade-left={overflow.start || undefined}
          data-fade-right={overflow.end || undefined}
          onKeyDown={onRailKeyDown}
        >
          {openTabs.filter(t => TAB_DEFS[t.type]).map(t => {
            const Def = TAB_DEFS[t.type];
            const active = t.id === activeTab?.id;
            return (
              <div key={t.id} className="sidepanel-pill" data-active={active || undefined}>
                <button
                  ref={el => {
                    if (el) tabRefs.current.set(t.id, el);
                    else tabRefs.current.delete(t.id);
                  }}
                  type="button"
                  role="tab"
                  id={`${scopeId}-tab-${t.id}`}
                  aria-selected={active}
                  aria-controls={`${scopeId}-pane-${t.id}`}
                  tabIndex={active ? 0 : -1}
                  className="sidepanel-pill-open focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-accent)]"
                  title={t.title}
                  onClick={() => setActiveId(t.id)}
                >
                  <Def.Icon size={14} className="shrink-0" />
                  <span className="text-ui-sm">{t.title}</span>
                </button>
                <button
                  type="button"
                  aria-label={`Close ${t.title}`}
                  title={`Close ${t.title}`}
                  className="sidepanel-pill-close focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-accent)]"
                  onClick={() => closePill(t)}
                >
                  <XIcon size={12} />
                </button>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          className="sidepanel-icon-btn"
          data-sp-trigger="1"
          aria-label="New tab"
          title="Open a new tab"
          aria-expanded={showPicker}
          aria-haspopup="true"
          onClick={() => { setShowPicker(v => !v); setShowManager(false); }}
        ><PlusIcon size={16} /></button>

        {showPicker && (
          <div className="sp-menu sidepanel-menu anchored-right" data-sp-menu="1" role="menu" aria-label="New tab">
            {TAB_TYPES.map(type => {
              const Def = TAB_DEFS[type];
              const exists = type === "trajectory" && openTabs.some(t => t.type === type);
              return (
                <button
                  type="button"
                  role="menuitem"
                  className="sidepanel-menu-item"
                  key={type}
                  onClick={() => void openNewTab(type)}
                >
                  <Def.Icon size={16} />
                  <span className="sidepanel-menu-label">{Def.label}</span>
                  {exists && (
                    <span className="shrink-0 text-ui-xs text-[var(--color-foreground-subtlest)]">open</span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {showManager && (
          <div className="sp-menu sidepanel-menu manager" data-sp-menu="1" aria-label="Tab manager">
            <div className="p-1 pb-2">
              <Input
                value={tabSearch}
                onChange={e => setTabSearch(e.target.value)}
                placeholder="Search tabs"
                aria-label="Search tabs"
                autoFocus
                className="h-10 rounded-full border-[var(--color-input-border)] bg-[var(--color-surface)] px-4 text-ui-sm shadow-none"
              />
            </div>
            <div className="sidepanel-menu-heading">Open tabs</div>
            {managerOpenTabs.length === 0 && <div className="sidepanel-menu-empty">None</div>}
            {managerOpenTabs.map(t => {
              const Def = TAB_DEFS[t.type];
              return (
                <div className="sidepanel-menu-row" key={t.id}>
                  <button
                    type="button"
                    className={cn(
                      "sidepanel-menu-item min-w-0 flex-1",
                      t.id === activeTab?.id && "bg-[var(--color-menu-hover)]",
                    )}
                    onClick={() => { setActiveId(t.id); setShowManager(false); }}
                  >
                    <Def.Icon size={15} />
                    <span className="sidepanel-menu-label">{t.title}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Close ${t.title}`}
                    className="sidepanel-pill-close shrink-0"
                    onClick={() => closePill(t)}
                  >
                    <XIcon size={12} />
                  </button>
                </div>
              );
            })}
            <div className="sidepanel-menu-heading">Recently closed</div>
            {managerClosed.length === 0 && <div className="sidepanel-menu-empty">None</div>}
            {managerClosed.map(t => {
              const Def = TAB_DEFS[t.type];
              return (
                <button
                  type="button"
                  className="sidepanel-menu-item sidepanel-menu-item-muted"
                  key={t.id}
                  onClick={() => { reopenRecent(t); setShowManager(false); }}
                >
                  <Def.Icon size={15} />
                  <span className="sidepanel-menu-label">{t.title}</span>
                  <span className="sidepanel-menu-meta">{fmtAgo(t.closedAt)}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Content — one pane per tab, remounted per activation for the swap fade */}
      <div className="sidepanel-content">
        {!activeTab && <SidePanelEmpty onOpen={type => void openNewTab(type)} />}
        {activeTab && (
          <div
            key={activeTab.id}
            role="tabpanel"
            id={`${scopeId}-pane-${activeTab.id}`}
            aria-labelledby={`${scopeId}-tab-${activeTab.id}`}
            className="sp-pane flex min-h-0 flex-1 flex-col"
          >
            {activeTab.type === "side-conversation" && (() => {
              const liveRow = sideTabs.find(st => st.sideChatId === activeTab.id);
              if (liveRow) {
                return <SideChatThread sessionId={activeTab.id} title={activeTab.title} />;
              }
              return (
                <SideChatIndex
                  sideTabs={sideTabs}
                  sideClosedTabs={sideClosedTabs}
                  activeId={activeTab.id}
                  onOpen={setActiveId}
                  onClose={sideChatId => { void handleCloseSideChat(sideChatId); closeTab(sideChatId); }}
                  onReopen={(tabId, reopenTitle) => { void handleReopenSideChat(tabId); reopenRecent({ id: tabId, type: "side-conversation", title: reopenTitle }); }}
                />
              );
            })()}
            {activeTab.type === "trajectory" && <TrajectoryView sessionId={currentSessionId} />}
            {activeTab.type === "terminal" && <TerminalPane terminalId={activeTab.id} />}
            {activeTab.type === "review" && <GitPanel />}
            {activeTab.type === "browser" && <BrowserPane />}
          </div>
        )}
      </div>
      </div>
    </aside>
  );
}
