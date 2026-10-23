/*
 * PURPOSE: Closed side chats list — reopenable tabs shown at bottom of side panel
 *
 * CONSUMERS: sidepanel/SidePanel.tsx
 */

import type { SideChatTab } from "../../types";

interface ClosedChatsProps {
  tabs: SideChatTab[];
  onReopen: (tabId: string) => void;
}

export function ClosedChats({ tabs, onReopen }: ClosedChatsProps) {
  if (tabs.length === 0) return null;

  return (
    <div style={{ borderTop: "1px solid var(--color-border)", padding: "8px" }}>
      <div style={{ fontSize: 11, color: "var(--color-foreground-subtle)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>
        Closed ({tabs.length})
      </div>
      {tabs.map(tab => (
        <div
          key={tab.id}
          className="sidechat-item"
          onClick={() => onReopen(tab.id)}
          title="Click to reopen"
        >
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {tab.sideChatTitle ?? "Untitled"}
          </span>
          <span style={{ fontSize: 11, color: "var(--color-foreground-subtle)" }}>↺</span>
        </div>
      ))}
    </div>
  );
}
