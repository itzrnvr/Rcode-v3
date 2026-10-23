/*
 * PURPOSE: Apply a Theme as CSS variables on :root.
 *
 * A pure function, deliberately not a hook: both the app (via useTheme) and the
 * component gallery (via DEFAULT_THEME, with no React state and no Electron
 * bridge) call it, so the gallery renders the same palette the app does. Before
 * this existed the gallery fell back to the stock shadcn defaults in index.css
 * and showed a different UI than users see.
 *
 * The shadcn-name block keeps the prebuilt primitives in lockstep with the
 * authoritative Rcode palette so model/menu surfaces stay dark in every theme.
 */

import type { Theme } from "../types";

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;

  // Color tokens
  root.style.setProperty("--color-accent", theme.accent);
  root.style.setProperty("--color-bg", theme.background);
  root.style.setProperty("--color-fg", theme.foreground);
  root.style.setProperty("--color-surface", theme.surface);
  root.style.setProperty("--color-sidebar", theme.sidebar);
  root.style.setProperty("--color-border", theme.border);
  root.style.setProperty("--color-muted", theme.muted);
  root.style.setProperty("--color-success", theme.success);
  root.style.setProperty("--color-warning", theme.warning);
  root.style.setProperty("--color-danger", theme.danger);
  root.style.setProperty("--color-bg-secondary", theme.surface);
  root.style.setProperty("--color-bg-tertiary", theme.surface);
  root.style.setProperty("--color-accent-soft", `color-mix(in srgb, ${theme.accent} 12%, transparent)`);
  root.style.setProperty("--color-accent-muted", `color-mix(in srgb, ${theme.accent} 6%, transparent)`);

  // Typography
  root.style.setProperty("--font-ui", theme.uiFont);
  root.style.setProperty("--font-code", theme.codeFont);
  // --ui-font-size is derived from the scale, not a separate setting. It used
  // to be a fixed 14px, so changing the font size in Settings moved body text
  // while every text-ui-* token and every prebuilt component stayed put.
  root.style.setProperty("--font-scale", String(theme.fontSizeScale));
  root.style.setProperty("--ui-font-size", `calc(14px * ${theme.fontSizeScale})`);
  // Root font size also scales every rem-based radius, gap and icon size.
  // DESIGN.md forbids this: interface font size belongs in --ui-font-size only.
  // Kept until every consumer of the rem scale is off it.
  document.documentElement.style.fontSize = `${Math.round(theme.fontSizeScale * 16)}px`;

  /*
   * Derived surfaces and border steps.
   *
   * These were missing entirely, so every hover surface, every overlay edge and
   * every input edge in the app was an ad hoc color-mix with a percentage the
   * author picked at the time. Ten of them meant something different.
   *
   * Those steps are NOT recomputed here. They are declared in index.css as
   * formulas over --color-fg and --color-bg, so they follow whatever theme is
   * active with no JavaScript in the loop. Deriving them in JS instead was
   * wrong twice over: it duplicated the palette in two places, and because
   * theme.border is a translucent white, color-mix interpolated its alpha and
   * resolved --color-input-border to a 2.79:1 edge where 1.85:1 was intended.
   */
  root.style.setProperty("--color-foreground-subtle", theme.muted);

  // shadcn aliases for the prebuilt components, kept in lockstep with the
  // palette above rather than pinned to stock shadcn values.
  root.style.setProperty("--background", theme.background);
  root.style.setProperty("--foreground", theme.foreground);
  root.style.setProperty("--card", theme.surface);
  root.style.setProperty("--card-foreground", theme.foreground);
  root.style.setProperty("--popover", theme.surface);
  root.style.setProperty("--popover-foreground", theme.foreground);
  root.style.setProperty("--primary", theme.accent);
  root.style.setProperty("--primary-foreground", theme.background);
  root.style.setProperty("--secondary", theme.surface);
  root.style.setProperty("--secondary-foreground", theme.foreground);
  root.style.setProperty("--muted", theme.surface);
  root.style.setProperty("--muted-foreground", theme.muted);
  root.style.setProperty("--accent", theme.surface);
  root.style.setProperty("--accent-foreground", theme.foreground);
  root.style.setProperty("--destructive", theme.danger);
  root.style.setProperty("--destructive-foreground", theme.background);
  root.style.setProperty("--border", theme.border);
  root.style.setProperty("--input", theme.border);
  root.style.setProperty("--ring", theme.accent);

  // Geometry — ZCode defines no radius scale of its own; it uses Tailwind's
  // (sm 4 / md 6 / lg 8 / xl 12) with controls at rounded-md and containers at
  // rounded-lg. The user setting drives the middle of that scale, and the
  // other three steps follow its proportions. Rcode previously used
  // radius/radius-6/radius-2/radius+6, which put a 10px base on every control
  // and made the whole UI read a step heavier than the reference.
  const r = theme.radius;
  root.style.setProperty("--radius", `${r}px`);
  root.style.setProperty("--radius-sm", `${Math.max(2, r - 4)}px`);
  root.style.setProperty("--radius-md", `${Math.max(4, r - 2)}px`);
  root.style.setProperty("--radius-lg", `${r}px`);
  root.style.setProperty("--radius-xl", `${r + 4}px`);

  // Dark / light
  root.dataset.theme = theme.preset;
  root.dataset.mode = theme.darkMode ? "dark" : "light";

  /*
   * The one-ui preset is a design language, not just a palette: its surface,
   * radius, type and motion values live in the [data-theme="one-ui"] block at
   * the end of index.css. That block must also win over the inline variables
   * written above, so it is authored with !important and keyed off this class
   * as well as the data-theme attribute — the class form lets the prototype
   * page (oneui.html) scope the same tokens to a subtree. Removing the preset
   * from types.ts, this toggle and that block removes One UI entirely.
   */
  root.classList.toggle("one-ui", theme.preset === "one-ui");

  root.dataset.translucent = theme.translucentSidebar ? "true" : "false";

  root.classList.remove("contrast-low", "contrast-high");
  if (theme.contrast !== "medium") {
    root.classList.add(`contrast-${theme.contrast}`);
  }
}
