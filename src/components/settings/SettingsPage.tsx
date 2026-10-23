/*
 * PURPOSE: Settings page with sidebar nav of categories
 *
 * Full-page layout (not a modal) — replaces the old SettingsModal.
 *
 * Layout (left to right):
 *   [back arrow] Rcode   | [Theme] [Providers] [Data] | right pane
 *
 * Uses lucide-react icons — no emojis, no inline SVGs.
 */

import { useState, useEffect } from "react";

import { useSettings } from "../../state/useSettings";

import { ThemeSettings } from "./ThemeSettings";
import { InstructionsEditor } from "./InstructionsEditor";
import { api } from "../../api/client";
import { ModelSettings } from "./ModelSettings";

import {
  ArrowLeftIcon,
  PaletteIcon,
  CpuIcon,
  HistoryIcon,
  InfoIcon,
} from "../common/Icons";

type SettingsCategory =
  | "theme"
  | "model"
  | "data"
  | "about";

interface CategoryDef {
  id: SettingsCategory;
  label: string;
  Icon: React.FC<{ size?: number; className?: string }>;
  description: string;
}

const CATEGORIES: CategoryDef[] = [
  {
    id: "theme",
    label: "Theme",
    Icon: PaletteIcon,
    description: "Colors, fonts, density",
  },
  {
    id: "model",
    label: "Providers",
    Icon: CpuIcon,
    description: "Providers, endpoints, model lists",
  },
];

interface SettingsPageProps {
  onClose: () => void;
  initialCategory?: SettingsCategory;
}

export function SettingsPage({ onClose, initialCategory }: SettingsPageProps) {
  const [active, setActive] = useState<SettingsCategory>(initialCategory ?? "model");
  useEffect(() => {
    if (initialCategory) setActive(initialCategory);
  }, [initialCategory]);
  const { settings } = useSettings();
  const [sidebarWidth, setSidebarWidth] = useState(280);

  useEffect(() => {
    api.getSetting("settingsSidebarWidth").then(v => {
      const n = parseInt(v ?? "", 10);
      if (!isNaN(n) && n >= 200 && n <= 480) setSidebarWidth(n);
    }).catch(() => {});
  }, []);

  const handleResizerMouseDown = (e: React.MouseEvent) => {
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      const next = Math.min(480, Math.max(200, startW + delta));
      setSidebarWidth(next);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    };
    const onUp = (ev: MouseEvent) => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      const delta = ev.clientX - startX;
      const finalW = Math.min(480, Math.max(200, startW + delta));
      setSidebarWidth(finalW);
      api.setSetting("settingsSidebarWidth", String(finalW));
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const category = CATEGORIES.find(c => c.id === active) ?? CATEGORIES[0];

  return (
    <div className="settings-page">
      {/* Left sidebar: back arrow + category nav */}
      <aside className="settings-sidebar" style={{ width: sidebarWidth, minWidth: sidebarWidth }}>
        <button
          className="settings-sidebar-back"
          onClick={onClose}
          aria-label="Back to chat"
        >
          <ArrowLeftIcon size={16} />
          <span>Back to app</span>
        </button>

        <div className="settings-search-wrap">
          <input className="settings-search" placeholder="Search settings..." />
        </div>

        <nav className="settings-sidebar-nav" aria-label="Settings categories">
          <div className="settings-nav-section">Personal</div>
          {CATEGORIES.map(c => {
            const Icon = c.Icon;
            const isActive = c.id === active;
            return (
              <button
                key={c.id}
                className={`settings-sidebar-item ${isActive ? "active" : ""}`}
                onClick={() => setActive(c.id)}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon size={16} />
                <span className="settings-sidebar-item-label">{c.label}</span>
                {isActive && (
                  <span className="settings-sidebar-item-indicator" aria-hidden="true" />
                )}
              </button>
            );
          })}
          {/*
            Data, About and the Integrations / Coding section headers are gone
            for v1. The Plugins and Browser entries under Integrations were
            already inert - pointerEvents:'none' at half opacity - so they were
            navigation-shaped placeholders rather than features.
            Additive to restore.
          */}
        </nav>
      </aside>
      <div className="settings-sidebar-resizer" onMouseDown={handleResizerMouseDown} role="separator" aria-orientation="vertical" title="Drag to resize" />

      {/* Right pane: category content */}
      <main className="settings-content">
        <header className="settings-content-header">
          <h2 className="settings-content-title">{category.label}</h2>
          <p className="settings-content-desc">{category.description}</p>
        </header>

        <div className="settings-content-body">
          {active === "theme" && <ThemeSettings />}

          {active === "model" && (
            <div className="settings-section-block">
              <ModelSettings />
            </div>
          )}

          {active === "data" && <InstructionsEditor />}
        </div>
      </main>
    </div>
  );
}
