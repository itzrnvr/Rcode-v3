/*
 * PURPOSE: Theme customization panel — preset cards + live color customization
 *
 * Design: presents 4 curated theme presets (Unsloth Mint, Rcode Blue,
 * Classic Dark, Light Classic) as visual cards. Each card shows a live
 * preview of accent/bg/sidebar colors. Click applies all preset tokens.
 *
 * Below presets: per-token color pickers, font selectors, font-size scale,
 * border-radius, translucent sidebar, contrast.
 *
 * All changes apply immediately via updateTheme (live preview through useTheme
 * hook). Settings persist to DB through the settings repository.
 */

import { useSettings } from "../../state/useSettings";
import { THEME_PRESETS, applyPreset } from "../../types";
import type { Theme, ThemePreset } from "../../types";
import { Toggle } from "../common/Toggle";
import { CheckIcon } from "../common/Icons";

const PRESETS: Array<{
  id: ThemePreset;
  label: string;
  description: string;
}> = [
  { id: "unsloth-mint", label: "Unsloth Mint", description: "Mint accent, warm gray cards" },
  { id: "rcode-blue", label: "Rcode Blue", description: "Cyan accent, dark minimal" },
  { id: "classic-dark", label: "Classic Dark", description: "Blue accent, high contrast" },
  { id: "light-classic", label: "Light Classic", description: "Light surfaces, blue accent" },
  // Prototype: Samsung One UI 6/7 language. The palette, 8/12/16/24 radius
  // ladder, 15px type base and spring motion live in the [data-theme="one-ui"]
  // block at the end of index.css; this card only switches the preset.
  { id: "one-ui", label: "One UI (Samsung)", description: "Prototype — big radii, One UI blue" },
];

const UI_FONTS = [
  "Geist Variable, sans-serif",
  "Inter, sans-serif",
  "system-ui, -apple-system, sans-serif",
  "SF Pro Display, sans-serif",
  "Segoe UI, sans-serif",
  "JetBrains Mono, monospace",
];

const CODE_FONTS = [
  "'Geist Mono Variable', monospace",
  "'JetBrains Mono', monospace",
  "'Cascadia Code', monospace",
  "Menlo, monospace",
  "Consolas, monospace",
  "'Fira Code', monospace",
];

function PresetCard({
  presetId,
  current,
  onApply,
}: {
  presetId: ThemePreset;
  current: Theme;
  onApply: (id: ThemePreset) => void;
}) {
  const preset = THEME_PRESETS[presetId];
  const isActive = current.preset === presetId;
  return (
    <button
      className={`preset-card ${isActive ? "active" : ""}`}
      onClick={() => onApply(presetId)}
      aria-pressed={isActive}
    >
      <div className="preset-card-preview" style={{ background: preset.background, border: `1px solid ${preset.border}` }}>
        <div className="preset-mini-sidebar" style={{ background: preset.sidebar }} />
        <div className="preset-mini-main">
          <span className="preset-mini-line strong" style={{ background: preset.foreground, opacity: 0.85 }} />
          <span className="preset-mini-line" style={{ background: preset.muted }} />
          <div className="preset-mini-card" style={{ background: preset.surface, border: `1px solid ${preset.border}` }} />
          <span className="preset-mini-btn" style={{ background: preset.accent }} />
        </div>
      </div>
      <div className="preset-card-label">{PRESETS.find(p => p.id === presetId)?.label}</div>
      <div className="preset-card-desc">{PRESETS.find(p => p.id === presetId)?.description}</div>
      {isActive && (
        <div className="preset-card-check">
          <CheckIcon size={12} />
        </div>
      )}
    </button>
  );
}

function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="settings-row theme-color-row">
      <label>{label}</label>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, justifyContent: "flex-end", minWidth: 0 }}>
        <span
          className="theme-color-swatch"
          style={{ background: value, borderColor: value }}
          aria-hidden="true"
        />
        <input
          type="color"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="theme-color-input"
          aria-label={`${label} color`}
        />
        <span className="theme-color-hex">{value}</span>
      </div>
    </div>
  );
}

export function ThemeSettings() {
  const { settings, updateTheme } = useSettings();
  const theme = settings.theme;

  const handleChange = <K extends keyof Theme>(key: K, value: Theme[K]) => {
    updateTheme({ ...theme, [key]: value });
  };

  const applyPresetById = (id: ThemePreset) => {
    const merged = applyPreset(id, {
      accent: theme.accent === THEME_PRESETS[theme.preset].accent
        ? THEME_PRESETS[id].accent
        : theme.accent,
    });
    updateTheme(merged);
  };

  return (
    <div className="theme-settings">
      <h3 className="settings-h3">Presets</h3>
      <div className="preset-grid">
        {PRESETS.map(({ id }) => (
          <PresetCard
            key={id}
            presetId={id}
            current={theme}
            onApply={applyPresetById}
          />
        ))}
      </div>

      <div className="theme-code-preview">
        <div className="theme-code-pane theme-code-old">
          <div className="theme-code-line"><span className="ln">1</span><span className="kw">const</span> themePreview: <span className="tp">ThemeConfig</span> = {"{"}</div>
          <div className="theme-code-line del"><span className="ln">2</span>  surface: "sidebar",</div>
          <div className="theme-code-line del"><span className="ln">3</span>  accent: "#2563eb",</div>
          <div className="theme-code-line del"><span className="ln">4</span>  contrast: 42,</div>
          <div className="theme-code-line"><span className="ln">5</span>{"};"}</div>
        </div>
        <div className="theme-code-pane theme-code-new">
          <div className="theme-code-line"><span className="ln">1</span><span className="kw">const</span> themePreview: <span className="tp">ThemeConfig</span> = {"{"}</div>
          <div className="theme-code-line add"><span className="ln">2</span>  surface: "sidebar-elevated",</div>
          <div className="theme-code-line add"><span className="ln">3</span>  accent: "#0ea5e9",</div>
          <div className="theme-code-line add"><span className="ln">4</span>  contrast: 68,</div>
          <div className="theme-code-line"><span className="ln">5</span>{"};"}</div>
        </div>
      </div>

      <h3 className="settings-h3">Colors</h3>

      <ColorRow label="Accent" value={theme.accent} onChange={v => handleChange("accent", v)} />
      <ColorRow label="Background" value={theme.background} onChange={v => handleChange("background", v)} />
      <ColorRow label="Surface (cards)" value={theme.surface} onChange={v => handleChange("surface", v)} />
      <ColorRow label="Sidebar" value={theme.sidebar} onChange={v => handleChange("sidebar", v)} />
      <ColorRow label="Border" value={theme.border} onChange={v => handleChange("border", v)} />
      <ColorRow label="Muted text" value={theme.muted} onChange={v => handleChange("muted", v)} />
      <ColorRow label="Foreground" value={theme.foreground} onChange={v => handleChange("foreground", v)} />

      <h3 className="settings-h3">Typography</h3>

      <div className="settings-row">
        <label>UI Font</label>
        <select value={theme.uiFont} onChange={e => handleChange("uiFont", e.target.value)}>
          {UI_FONTS.map(f => <option key={f} value={f}>{f.split(",")[0]}</option>)}
        </select>
      </div>

      <div className="settings-row">
        <label>Code Font</label>
        <select value={theme.codeFont} onChange={e => handleChange("codeFont", e.target.value)}>
          {CODE_FONTS.map(f => <option key={f} value={f}>{f.split(",")[0].replace(/'/g, "")}</option>)}
        </select>
      </div>

      <div className="settings-row">
        <label>Font size</label>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, justifyContent: "flex-end" }}>
          <input
            type="range"
            min="0.85"
            max="1.15"
            step="0.05"
            value={theme.fontSizeScale}
            onChange={e => handleChange("fontSizeScale", parseFloat(e.target.value))}
            style={{ ["--range-pct" as string]: `${((theme.fontSizeScale - 0.85) / 0.3) * 100}%` } as React.CSSProperties}
          />
          <span style={{ minWidth: 44, textAlign: "right", fontSize: 12, fontVariantNumeric: "tabular-nums", color: "var(--color-foreground-subtle)", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 6, padding: "2px 6px" }}>{theme.fontSizeScale.toFixed(2)}×</span>
        </div>
      </div>

      <div className="settings-row">
        <label>Corner radius</label>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, justifyContent: "flex-end" }}>
          <input
            type="range"
            min="4"
            max="22"
            step="1"
            value={theme.radius}
            onChange={e => handleChange("radius", parseInt(e.target.value, 10))}
            style={{ ["--range-pct" as string]: `${((theme.radius - 4) / 18) * 100}%` } as React.CSSProperties}
          />
          <span style={{ minWidth: 44, textAlign: "right", fontSize: 12, fontVariantNumeric: "tabular-nums", color: "var(--color-foreground-subtle)", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 6, padding: "2px 6px" }}>{theme.radius}px</span>
        </div>
      </div>

      <h3 className="settings-h3">Effects</h3>

      <div className="settings-row" style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <label style={{ marginBottom: 0 }}>Translucent Sidebar</label>
        <Toggle on={theme.translucentSidebar} onChange={v => handleChange("translucentSidebar", v)} />
      </div>

      <div className="settings-row">
        <label>Contrast</label>
        <select value={theme.contrast} onChange={e => handleChange("contrast", e.target.value as Theme["contrast"])}>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </div>
    </div>
  );
}
