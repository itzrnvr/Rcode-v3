/*
 * PURPOSE: Custom title bar — logo, sidebar toggle, window controls
 *
 * Layout (left to right):
 *   - Toggle sidebar icon
 *   - Logo + App Name
 *   - Drag region
 *   - macOS traffic lights (close, min, max)
 *
 * The model picker was moved into ChatInput.
 */

import { api } from "../../api/client";
import { PanelLeftIcon, PanelRightIcon, HighlighterIcon } from "../common/Icons";

interface TitleBarProps {
  onToggleSidebar: () => void;
  onToggleSidePanel?: () => void;
  onToggleFeedback?: () => void;
}

export function TitleBar({ onToggleSidebar, onToggleSidePanel, onToggleFeedback }: TitleBarProps) {
  const isWin = (navigator.platform || "").toLowerCase().includes("win");
  const inElectron = typeof window !== "undefined" && typeof window.electron !== "undefined";
  return (
    <div className="titlebar" style={inElectron && isWin ? { paddingRight: 138 } : undefined}>
      <div className="titlebar-left">
        <button
          className="titlebar-sidebar-toggle"
          onClick={onToggleSidebar}
          title="Toggle sidebar"
          aria-label="Toggle sidebar"
        >
          <PanelLeftIcon size={16} />
        </button>

        <div className="titlebar-logo">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
            <g strokeLinecap="square" strokeLinejoin="miter">
              {/* Left half — formal straight stem with serif */}
              <path d="M7 3.8 V20.2" strokeWidth="2.8" strokeLinecap="square" />
              <path d="M6.2 3.8 H7.8" strokeWidth="2.8" />
              <path d="M6.2 20.2 H7.8" strokeWidth="2.8" />
            </g>
            <g strokeLinecap="round" strokeLinejoin="round">
              {/* Right half — sharp cursive bowl + leg */}
              <path d="M7 3.8 H13.1 C15.3 3.8, 17.2 5.4, 17.2 8 C17.2 10.6, 15.3 12.2, 13.1 12.2 H7" strokeWidth="1.9" />
              <path d="M11.8 12.2 C13.4 14.8, 15.2 17.6, 16.8 19.4 C17.9 20.6, 19.4 21.6, 20.2 20.6 C20.5 20.2, 20.3 19.4, 19.7 18.2" strokeWidth="1.9" />
              {/* Hairline spine where halves meet — personality split */}
              <path d="M7 8.2 H12.6" opacity="0.28" strokeWidth="1.0" />
            </g>
          </svg>
        </div>
        <span className="titlebar-name">Rcode</span>
      </div>

      <div className="titlebar-right">
        {onToggleFeedback && (
          <button
            className="titlebar-sidebar-toggle"
            onClick={onToggleFeedback}
            title="Annotate UI feedback (Ctrl+Shift+A)"
            aria-label="Annotate UI feedback"
          >
            <HighlighterIcon size={15} />
          </button>
        )}
        {onToggleSidePanel && (
          <button
            className="titlebar-sidebar-toggle"
            onClick={onToggleSidePanel}
            title="Toggle side panel"
            aria-label="Toggle side panel"
            style={{ marginRight: 8 }}
          >
            <PanelRightIcon size={16} />
          </button>
        )}
        {inElectron && !isWin && <div className="traffic-group">
          <button
            className="traffic-light traffic-close"
            onClick={() => api.windowClose()}
            title="Close"
            aria-label="Close window"
          />
          <button
            className="traffic-light traffic-min"
            onClick={() => api.windowMinimize()}
            title="Minimize"
            aria-label="Minimize window"
          />
          <button
            className="traffic-light traffic-max"
            onClick={() => api.windowMaximize()}
            title="Maximize"
            aria-label="Maximize window"
          />
        </div>}
      </div>
    </div>
  );
}
