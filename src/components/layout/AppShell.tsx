/*
 * PURPOSE: Layout shell — titlebar over a three-panel body (session drawer,
 * chat, side panel)
 *
 * The session drawer is the One UI prototype's .oui-sidebar ported onto
 * .panel-sessions: it collapses to width 0 on --duration-panel while its
 * fixed-width inner holds the layout (see index.css). The width itself is
 * the --panel-sessions-w custom property, so the drag resizer and the
 * collapsed state drive the same number and the inner never reflows
 * mid-transition. The side panel keeps its own width handling.
 *
 * Panel widths (configurable via CSS):
 *   - titlebar: 44px tall
 *   - sessions: --panel-sessions-w (200-480px via drag), 0 collapsed
 *   - chat: flex 1
 *   - sidePanel: 300px when present, 0 when collapsed
 */

import { type ReactNode } from "react";

interface AppShellProps {
  titleBar: ReactNode;
  sessions: ReactNode;
  chat: ReactNode;
  sidePanel: ReactNode | null;
  sidebarCollapsed?: boolean;
  sidebarWidth?: number;
  onSidebarWidthChange?: (w: number) => void;
  onToggleSidebar?: () => void;
  sidePanelCollapsed?: boolean;
  sidePanelWidth?: number;
  onSidePanelWidthChange?: (w: number) => void;
  onToggleSidePanel?: () => void;
}

export function AppShell({ titleBar, sessions, chat, sidePanel, sidebarCollapsed, sidebarWidth, onSidebarWidthChange, onToggleSidebar, sidePanelCollapsed, sidePanelWidth, onSidePanelWidthChange, onToggleSidePanel }: AppShellProps) {
  let leftDragMoved = false;
  let rightDragMoved = false;

  const handleLeftMouseDown = (e: React.MouseEvent) => {
    if (sidebarCollapsed) return;
    const startX = e.clientX;
    const startW = sidebarWidth ?? 280;
    let moved = false;
    const el = document.querySelector(".panel-sessions") as HTMLElement | null;
    const prevTransition = el?.style.transition;
    if (el) el.style.transition = "none";
    const onMove = (ev: MouseEvent) => {
      if (Math.abs(ev.clientX - startX) > 3) moved = true;
      const delta = ev.clientX - startX;
      const next = Math.min(480, Math.max(200, startW + delta));
      // Direct DOM update for smooth 60fps without React re-render per pixel.
      // The panel width reads --panel-sessions-w, and the fixed-width inner
      // reads the same property, so panel and content track together.
      if (el) el.style.setProperty("--panel-sessions-w", `${next}px`);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    };
    const onUp = (ev: MouseEvent) => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (el) el.style.transition = prevTransition ?? "";
      const delta = ev.clientX - startX;
      const finalW = Math.min(480, Math.max(200, startW + delta));
      onSidebarWidthChange?.(finalW);
      leftDragMoved = moved;
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const handleRightMouseDown = (e: React.MouseEvent) => {
    if (sidePanelCollapsed) return;
    const startX = e.clientX;
    const startW = sidePanelWidth ?? 380;
    let moved = false;
    const el = document.querySelector(".panel-side") as HTMLElement | null;
    const prevTransition = el?.style.transition;
    if (el) el.style.transition = "none";
    const onMove = (ev: MouseEvent) => {
      if (Math.abs(startX - ev.clientX) > 3) moved = true;
      const delta = startX - ev.clientX; // drag left to increase width
      const next = Math.min(600, Math.max(240, startW + delta));
      if (el) {
        el.style.width = `${next}px`;
        el.style.minWidth = `${next}px`;
      }
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    };
    const onUp = (ev: MouseEvent) => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (el) el.style.transition = prevTransition ?? "";
      const delta = startX - ev.clientX;
      const finalW = Math.min(600, Math.max(240, startW + delta));
      // Collapse if dragged very narrow
      if (finalW < 260 && onToggleSidePanel) {
        // keep width for next expand, just collapse
        onToggleSidePanel();
      } else {
        onSidePanelWidthChange?.(finalW);
      }
      rightDragMoved = moved;
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  return (
    <div
      className="app-shell"
      data-sidebar-open={!sidebarCollapsed}
      data-sidepanel-open={!sidePanelCollapsed}
    >
      {titleBar}
      <div className="app-body">
        {sessions}
        {!sidebarCollapsed && (
          <div
            className="sidebar-resizer"
            onMouseDown={handleLeftMouseDown}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            title="Drag to resize • click to collapse"
            onClick={() => { if (!leftDragMoved) onToggleSidebar?.(); leftDragMoved = false; }}
          />
        )}
        {chat}
        {!sidePanelCollapsed && sidePanel && (
          <div
            className="sidebar-resizer sidepanel-resizer"
            onMouseDown={handleRightMouseDown}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize side panel"
            title="Drag to resize • click to collapse"
            style={{ cursor: "col-resize" }}
            onClick={() => { if (!rightDragMoved) onToggleSidePanel?.(); rightDragMoved = false; }}
          />
        )}
        {!sidePanelCollapsed && sidePanel}
        {/*
         * The panel-edge-expand strips are gone. They rendered as a 16px,
         * full-height button pinned to the opposite edge of the window - the
         * control for the LEFT sidebar sat on the far RIGHT - while the
         * titlebar already has a Toggle sidebar and a Toggle side panel.
         * Two ways to do one thing, one of them in the wrong place.
         */}
      </div>
    </div>
  );
}
