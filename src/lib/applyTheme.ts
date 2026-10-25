/*
 * PURPOSE: Apply a Theme to the document.
 *
 * A pure function, deliberately not a hook: both the app (via useTheme) and
 * the component gallery call it, so the gallery renders the same palette the
 * app does.
 *
 * WHAT THIS FILE OWNS, AND WHAT IT DOES NOT
 *
 * The stylesheet owns the PALETTE. Each theme's colours live in a block in
 * src/index.css - the One UI block for the product's own language, the :root
 * block for the monochrome family - and they are declared as formulas over a
 * few primitives. A theme switch is therefore one attribute on <html>.
 *
 * This function owns the KNOBS: the values a person actually chose. The
 * accent they picked, the font, the interface size, the corner radius, the
 * contrast, the translucency. It writes those inline on documentElement,
 * where they beat the stylesheet.
 *
 * The old arrangement was the reverse: this function wrote the whole palette
 * inline, which meant the stylesheet's theme blocks had to carry !important
 * on every declaration to have any effect at all, and a customised accent
 * could not reach the derived tokens that depended on it. Both problems are
 * the same problem: two owners for one value.
 *
 * The primitives it writes are exactly the ones the settings UI exposes.
 * Everything else - the text ladder, the hover and selection fills, the
 * border ramp, the shadcn aliases, the radius ladder, the type scale - is
 * derived in CSS and follows automatically.
 */

import type { Theme } from "../types";

/** The palette of a theme, in the mode it is currently in. */
function paletteOf(theme: Theme): Theme {
  if (theme.darkMode || !theme.light) return theme;
  return { ...theme, ...theme.light };
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  const palette = paletteOf(theme);

  // Which theme is on screen. The stylesheet reads these to pick the block.
  root.dataset.theme = theme.preset;
  root.dataset.mode = theme.darkMode ? "dark" : "light";
  root.classList.toggle("one-ui", theme.preset === "one-ui");
  root.dataset.translucent = theme.translucentSidebar ? "true" : "false";
  root.classList.remove("contrast-low", "contrast-high");
  if (theme.contrast !== "medium") {
    root.classList.add(`contrast-${theme.contrast}`);
  }

  // The palette primitives. These are the values the settings UI edits, and
  // they are the only colours written inline: every other colour in the app
  // is a formula over these in the stylesheet, so changing one here changes
  // the whole ladder that depends on it.
  root.style.setProperty("--color-accent", palette.accent);
  root.style.setProperty("--color-bg", palette.background);
  root.style.setProperty("--color-fg", palette.foreground);
  root.style.setProperty("--color-surface", palette.surface);
  root.style.setProperty("--color-sidebar", palette.sidebar);
  root.style.setProperty("--color-border", palette.border);
  root.style.setProperty("--color-success", palette.success);
  root.style.setProperty("--color-warning", palette.warning);
  root.style.setProperty("--color-danger", palette.danger);

  // Typography. The interface size is a multiplier on the theme's own base
  // step, which the stylesheet holds as --ui-font-base: One UI's body step
  // is 15px, the monochrome family's is 14px. Only the multiplier is written
  // here, so the slider moves the whole scale rather than resetting it.
  root.style.setProperty("--font-ui", theme.uiFont);
  root.style.setProperty("--font-code", theme.codeFont);
  root.style.setProperty("--font-scale", String(theme.fontSizeScale));

  // Radius. The ladder is derived in CSS from this one number, so moving the
  // slider moves all four steps together.
  root.style.setProperty("--radius", `${theme.radius}px`);
}
