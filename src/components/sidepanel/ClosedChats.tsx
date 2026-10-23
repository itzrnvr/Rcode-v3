/*
 * PURPOSE: Closed side chats list — reopenable rows in the One UI language
 *
 * CONSUMERS: sidepanel/SidePanel.tsx (currently superseded by the tab
 * manager's "Recently closed" section; kept in sync with the panel's design
 * so the component stays drop-in ready).
 */

import type { SideChatTab } from "../../types";

interface ClosedChatsProps {
  tabs: SideChatTab[];
  onReopen: (tabId: string) => void;
}

export function ClosedChats({ tabs, onReopen }: ClosedChatsProps) {
  if (tabs.length === 0) return null;

  return (
    <div className="border-t border-[var(--color-border)] p-2">
      <div className="sidechat-index-label">Closed ({tabs.length})</div>
      {tabs.map(tab => (
        <div key={tab.id} className="sidechat-item sidechat-item-closed">
          <button
            type="button"
            className="sidechat-item-open"
            onClick={() => onReopen(tab.id)}
            title="Click to reopen"
          >
            <span className="sidechat-item-title">{tab.sideChatTitle ?? "Untitled"}</span>
          </button>
          <span aria-hidden className="shrink-0 pr-2 text-ui-xs text-[var(--color-foreground-subtlest)]">↺</span>
        </div>
      ))}
    </div>
  );
}
