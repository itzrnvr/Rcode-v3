/*
 * PURPOSE: Command palette — Search chats, sessions, settings, slash, new tabs
 *
 * Triggered by left sidebar Search button or ⌘K / Ctrl+K.
 * Matches the screenshot: centered overlay with "Search chats" input, sections for
 * Chats (with Ctrl+1..9), Quick actions (New chat, Open folder), and new tabs
 * that open from the left in the sidepanel.
 */

import { useState, useEffect, useMemo, useRef } from "react";
import { useApp } from "../../state/AppContext";
import { useSessions } from "../../state/useSessions";
import { useProviders } from "../../state/useProviders";
import { api } from "../../api/client";
import {
  SearchIcon,
  PlusIcon,
  SettingsIcon,
  MessageCircleIcon,
  TerminalSquareIcon,
  Code2Icon,
  GlobeIcon,
  SparkleIcon,
  FolderIcon,
} from "../common/Icons";

interface SearchPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function SearchPalette({ open, onClose }: SearchPaletteProps) {
  const { setCurrentSessionId, setShowSettings, bumpSessionList, settings, sessionListVersion, setSidePanelCollapsed } = useApp();
  const { sessions } = useSessions(sessionListVersion);
  const { allModels } = useProviders();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (!open) {
          // Trigger open via custom event
          window.dispatchEvent(new CustomEvent("open-search-palette"));
        } else {
          onClose();
        }
      }
      if (e.key === "Escape" && open) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const filteredChats = useMemo(() => {
    if (!query.trim()) return sessions.slice(0, 9);
    const q = query.toLowerCase();
    return sessions.filter(s => s.title.toLowerCase().includes(q)).slice(0, 9);
  }, [sessions, query]);

  const filteredModels = useMemo(() => {
    if (!query.trim()) return allModels.slice(0, 5);
    const q = query.toLowerCase();
    return allModels.filter(m => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)).slice(0, 5);
  }, [allModels, query]);

  const handleSelectChat = (id: string) => {
    setCurrentSessionId(id);
    onClose();
  };

  const handleNewChat = async () => {
    setCurrentSessionId(null);
    onClose();
  };

  const handleNewTab = async (type: "terminal" | "side-conversation" | "review" | "browser") => {
    // Ensure side panel is visible and dispatch new tab from left
    try { await setSidePanelCollapsed(false); } catch {}
    window.dispatchEvent(new CustomEvent("sidepanel:new-tab", { detail: { type } }));
    onClose();
  };

  const handleSlash = async (cmd: string) => {
    if (cmd.startsWith("/side")) {
      try { await setSidePanelCollapsed(false); } catch {}
    }
    window.dispatchEvent(new CustomEvent("chat:slash", { detail: { cmd } }));
    onClose();
  };

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/60 pt-[10vh] backdrop-blur-[8px]"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="flex max-h-[70vh] w-[640px] flex-col overflow-hidden rounded-xl border border-[var(--color-popover-border)] bg-[var(--color-popover)] shadow-[var(--shadow-lg)]"
      >
        <div className="flex items-center gap-2.5 border-b border-[var(--color-border)] px-4 py-3.5">
          <span className="flex text-[var(--color-foreground-subtle)]"><SearchIcon size={16} /></span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search chats"
            className="flex-1 rounded-sm border border-transparent bg-transparent text-ui-lg text-[var(--color-fg)] outline-none transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] placeholder:text-[var(--color-foreground-subtlest)] focus-visible:border-[var(--color-input-border-focused)]"
          />
          <span className="rounded-sm border border-[var(--color-border)] px-1.5 py-0.5 text-ui-xs text-[var(--color-foreground-subtlest)]">ESC</span>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pt-2 pb-3">
          {/* Chats */}
          <div className="px-2 pt-2 pb-1 text-ui-xs font-semibold uppercase tracking-[0.6px] text-[var(--color-foreground-subtle)]">Chats</div>
          {filteredChats.length === 0 ? (
            <div className="px-3 py-2 text-ui-base text-[var(--color-foreground-subtlest)]">No chats found</div>
          ) : (
            filteredChats.map((s, idx) => (
              <button
                key={s.id}
                onClick={() => handleSelectChat(s.id)}
                className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg bg-transparent px-3 py-[9px] text-left text-ui-base text-[var(--color-fg)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-[var(--color-hover)]"
              >
                <span className="flex opacity-60"><MessageCircleIcon size={14} /></span>
                <span className="flex-1 truncate">{s.title}</span>
                <span className="rounded-sm border border-[var(--color-border)] px-[5px] py-px text-ui-xs text-[var(--color-foreground-subtlest)]">Ctrl+{idx + 1}</span>
              </button>
            ))
          )}

          {/* Quick actions */}
          <div className="px-2 pt-3 pb-1 text-ui-xs font-semibold uppercase tracking-[0.6px] text-[var(--color-foreground-subtle)]">Quick actions</div>
          <button
            onClick={handleNewChat}
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg bg-transparent px-3 py-[9px] text-left text-ui-base text-[var(--color-fg)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-[var(--color-hover)]"
          >
            <PlusIcon size={14} />
            <span className="flex-1">New chat</span>
            <span className="rounded-sm border border-[var(--color-border)] px-[5px] py-px text-ui-xs text-[var(--color-foreground-subtlest)]">Ctrl+N</span>
          </button>
          <button
            onClick={() => { window.dispatchEvent(new CustomEvent("open-folder")); onClose(); }}
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg bg-transparent px-3 py-[9px] text-left text-ui-base text-[var(--color-fg)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-[var(--color-hover)]"
          >
            <FolderIcon size={14} />
            <span className="flex-1">Open folder</span>
            <span className="rounded-sm border border-[var(--color-border)] px-[5px] py-px text-ui-xs text-[var(--color-foreground-subtlest)]">Ctrl+O</span>
          </button>

          {/* Slash commands */}
          <div className="px-2 pt-3 pb-1 text-ui-xs font-semibold uppercase tracking-[0.6px] text-[var(--color-foreground-subtle)]">Slash commands</div>
          {[
            { cmd: "/side", desc: "Fork a side conversation (branch)", Icon: MessageCircleIcon },
            { cmd: "/compact", desc: "Summarize and compact", Icon: SparkleIcon },
            { cmd: "/clear", desc: "Clear the current chat", Icon: SearchIcon },
            { cmd: "/help", desc: "Show available commands", Icon: SparkleIcon },
          ]
            .filter(c => !query || c.cmd.includes(query.toLowerCase()) || c.desc.toLowerCase().includes(query.toLowerCase()))
            .map(c => (
              <button
                key={c.cmd}
                onClick={() => handleSlash(c.cmd)}
                className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg bg-transparent px-3 py-[9px] text-left text-ui-base text-[var(--color-fg)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-[var(--color-hover)]"
              >
                <c.Icon size={14} />
                <span className="flex-1">{c.cmd}</span>
                <span className="text-ui-sm text-[var(--color-foreground-subtle)]">{c.desc}</span>
              </button>
            ))}

          {/* Settings shortcuts */}
          <div className="px-2 pt-3 pb-1 text-ui-xs font-semibold uppercase tracking-[0.6px] text-[var(--color-foreground-subtle)]">Settings</div>
          {[
            { label: "API Settings", category: "api", Icon: SettingsIcon, action: () => { window.dispatchEvent(new CustomEvent("open-settings", { detail: { category: "api" } })); onClose(); } },
            { label: "Theme", category: "theme", Icon: SettingsIcon, action: () => { window.dispatchEvent(new CustomEvent("open-settings", { detail: { category: "theme" } })); onClose(); } },
            { label: "Model Settings", category: "model", Icon: SettingsIcon, action: () => { window.dispatchEvent(new CustomEvent("open-settings", { detail: { category: "model" } })); onClose(); } },
          ]
            .filter(c => !query || c.label.toLowerCase().includes(query.toLowerCase()))
            .map(c => (
              <button
                key={c.label}
                onClick={c.action}
                className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg bg-transparent px-3 py-[9px] text-left text-ui-base text-[var(--color-fg)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-[var(--color-hover)]"
              >
                <c.Icon size={14} />
                <span>{c.label}</span>
              </button>
            ))}

          {/* New tabs - from the left in sidepanel */}
          <div className="px-2 pt-3 pb-1 text-ui-xs font-semibold uppercase tracking-[0.6px] text-[var(--color-foreground-subtle)]">New tabs</div>
          {[
            { type: "terminal" as const, label: "Terminal", Icon: TerminalSquareIcon },
            { type: "side-conversation" as const, label: "Side conversation", Icon: MessageCircleIcon },
            { type: "review" as const, label: "Review", Icon: Code2Icon },
            { type: "browser" as const, label: "Browser", Icon: GlobeIcon },
          ]
            .filter(c => !query || c.label.toLowerCase().includes(query.toLowerCase()))
            .map(c => (
              <button
                key={c.type}
                onClick={() => handleNewTab(c.type)}
                className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg bg-transparent px-3 py-[9px] text-left text-ui-base text-[var(--color-fg)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-[var(--color-hover)]"
              >
                <c.Icon size={14} />
                <span>{c.label}</span>
                <span className="ml-auto text-ui-xs text-[var(--color-foreground-subtlest)]">sidepanel</span>
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}
