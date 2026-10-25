<!--
  PROVENANCE

  Rcode's design system. Adapted from zai-org/ZCode (Apache-2.0), version
  3.15.1, commit aac4755666d09fdcd70272fcf063c077a639015f (2026-10-10).

  ZCode's structure, typography scale, spacing rhythm, token discipline and
  accessibility rules are kept. Its palette, its radius ladder and its
  motion vocabulary are not: Rcode ships the One UI language, and the two
  disagree on exactly the three things a design system cannot be vague
  about - accent, radius and motion. Everything ZCode says that Rcode
  follows is credited; everything Rcode changed says so below.

  ZCode's original file is kept unmodified at D:/zcode-ref for comparison.

  STATUS IN RCODE: this is the authority. It is not a reference and it is
  not aspirational. Where the code and this document disagree, the code is
  the part that is wrong.

  Token values are NOT duplicated here. The stylesheet
  (src/index.css) is the value source, and the gallery at
  /gallery.html reads its values live from it. This document states the
  rules; the stylesheet states the numbers.
-->

# Rcode Design System

The design system for Rcode: a local-first coding agent with a desktop app
and a web client that share one interface.

This document is written for coding agents. Read it before designing or
editing UI in this repository. It says what the rules are, not what the
current values are — the values live in `src/index.css` and are printed
live in the gallery.

## Highest-priority constraint: the type scale

All application interface typography comes from the `text-ui-*` scale:

- `text-ui-xl`, `text-ui-lg`, `text-ui-base`, `text-ui-caption`,
  `text-ui-sm`, `text-ui-xs`, `text-ui-2xs`.
- Never Tailwind's built-in `text-xs` / `text-sm` / `text-base` /
  `text-lg` / `text-xl` for application UI.
- Never an arbitrary size (`text-[13px]`) and never an inline
  `font-size`.
- The only exceptions are code, diff and terminal content, which have their
  own settings. Their surrounding labels and controls still use `text-ui-*`.

A `font-size` in this repository that is not on the scale is a defect, and
it is also a functional bug: the interface font-size setting does not move
it, so the UI ends up with two different sizes at the same nominal step.

**Never scale the interface by changing the root `html` font size.**
`--ui-font-size` is the only knob. The root font size also drives Tailwind's
rem-based spacing, so changing it resizes the whole layout rather than the
text.

## Product character

Rcode is a tool for long sessions. The interface should feel calm, dense and
operational rather than decorative.

Design for:

- long sessions and long transcripts
- high information density
- readable chat and tool output
- keyboard-driven workflows
- one interface across desktop, web and mobile
- light and dark themes, and a user who has changed every one of them

Avoid:

- oversized, marketing-style spacing
- gradients and glows as a default visual language
- bright full-surface brand fills
- hierarchy that is ambiguous between the page, a card and an overlay
- icons that carry meaning no text carries (no robot heads, no sparkles)

## Colour

### One owner per value

The stylesheet owns the palette. `applyTheme` owns the knobs — the values a
person actually chose. This split is the rule that makes everything else
work:

- A theme's colours live in a block in `src/index.css`, keyed off
  `data-theme` on `<html>`. A theme switch is one attribute.
- The nine palette primitives — accent, background, foreground, surface,
  sidebar, border, success, warning, danger — are written inline by
  `applyTheme`, because those are the values the settings UI edits.
- Everything else is a **formula over a primitive**, declared once:
  the text ladder, the hover and selection fills, the border ramp, the
  scrim, the shadcn aliases, the radius ladder, the type scale.

So changing the accent moves the soft fills, the focus ring and the border
ramp with it, and a theme can have its own radius ladder and its own motion
without anything having to be `!important`.

A second rule follows from the first: **the stylesheet and the `Theme`
object in `src/types.ts` declare the same values.** They are the fallback
and the live truth respectively; if they drift, the app changes colour when
it hydrates.

### Colour vocabulary

The app namespace is `--color-*`. The names below are the whole vocabulary;
if you need a colour that is not here, add it here first.

**Surfaces** — four solid steps, everything else is alpha over them, so a
hover inside a card and a hover inside a panel read the same:

| Token | Role |
| --- | --- |
| `--color-bg` | the page and the app workspace |
| `--color-surface` | low-elevation containers: cards, rows, the composer |
| `--color-menu` | dropdown, popover and select surfaces — one step above a card, so an overlay always reads as above |
| `--color-sidebar` | the session drawer and the side panel |

**Text** — a three-step ladder, each an alpha mix of the foreground, so it
reads correctly on every surface it lands on:

| Token | Role |
| --- | --- |
| `--color-fg` | reading text |
| `--color-foreground-subtle` | metadata, descriptions, supporting labels |
| `--color-foreground-subtlest` | placeholders, weak hints, disabled-adjacent copy |
| `--color-muted` | the alias the settings preview card prints |

**Interaction fills** — alpha over whatever is behind them, never a fixed
grey:

| Token | Role |
| --- | --- |
| `--color-hover` | hover on a control or a row |
| `--color-active` | pressed, and the second step of a selected state |
| `--color-selected` | the selected row, the active tab pill |
| `--color-menu-hover` | hover on a menu item |

**Borders** — one ramp, split by what they enclose:

| Token | Role |
| --- | --- |
| `--color-border` | separators and default edges |
| `--color-border-hover` | a hovered border |
| `--color-card-border`, `--color-popover-border` | the border of that surface |
| `--color-input-border` | a field's edge |
| `--color-input-border-hover` | a hovered field's edge |
| `--color-input-border-focused` | a focused field takes the accent |

**Accent and status** — the accent is the brand and marks the primary
action and the current selection. The status colours are for real state and
nothing else:

| Token | Role |
| --- | --- |
| `--color-accent` | the brand; the primary action, focus, the active marker |
| `--color-brand` | the alias for brand surfaces |
| `--color-accent-soft`, `--color-accent-muted` | the two accent fill weights |
| `--color-accent-tint` | a tinted backplate behind accent-coloured text |
| `--color-success`, `--color-warning`, `--color-danger` | real state |
| `--color-success-soft`, `--color-warning-soft`, `--color-danger-soft` | the same, as a soft fill behind coloured text |
| `--color-danger-muted` | the faintest danger fill |

**Overlay and data** — the scrim, and the two palettes that carry data
rather than chrome:

| Token | Role |
| --- | --- |
| `--color-scrim` | the dim behind a modal, a dialog or a drawer |
| `--color-code-keyword`, `--color-code-type`, `--color-code-string`, `--color-code-number`, `--color-code-comment` | syntax |
| `--color-diff-added`, `--color-diff-removed` | the diff markers |
| `--color-diff-added-soft`, `--color-diff-removed-soft` | the diff row fills |

Diff colours are their own tokens on purpose. A green that means "added"
in a diff must not be the green that means "healthy" on a badge.

### Colour usage rules

- Semantic tokens only. No raw hex, `rgb()`, `hsl()` or `oklch()` in
  ordinary UI work, and no arbitrary Tailwind colour like `bg-[#1e1e1e]`.
- `bg-bg` for a page root, `bg-surface` for a container, `bg-menu` for an
  overlay. Never mix the three without a layering reason.
- `bg-hover` for hover, `bg-selected` for selection.
- The accent is reserved. It marks the primary action and the current
  selection, and it does not appear on ordinary surfaces.
- Use text hierarchy before adding borders or colours.
- Pair a status colour with readable text. Never colour alone.

### Themes

Rcode ships two languages, and each is a full set — palette, radius ladder,
type base, motion — not a recolouring of the other.

- **One UI** (`data-theme="one-ui"`, the default): the product's own
  language. Accent `#4d8dff`. A blue brand, allowed to carry chrome. Body
  step 15px. Radius 8 / 12 / 16 / 24. Motion 200 / 300 / 450ms with an
  overshoot curve for entrances.
- **The monochrome family** (`rcode-blue`, `classic-dark`, `unsloth-mint`,
  `light-classic`): adapted from ZCode, which is deliberately flat and
  separates with hairlines. The accent varies per preset — white, cyan,
  blue, mint, or blue on white — over a near-black or white ground. Body
  step 14px. Radius 4 / 6 / 8 / 12. Motion 120 / 160 / 200ms, no overshoot.

The presets inside the monochrome family differ in palette only; they share
that family's radius, type and motion. A preset is chosen in
Settings → Theme, and its customisations are the nine primitives above
plus the fonts, the interface size, the corner radius, the contrast and the
translucency.

One UI also has a light variant, used by the gallery's shell section. The
app itself is dark-only.

## Typography

### Families

- **UI Sans** — the app's default stack (`--font-sans`): Geist Variable,
  system-ui, -apple-system, "Segoe UI", sans-serif.
- **UI Mono** — `--font-mono`: Geist Mono Variable, JetBrains Mono,
  Cascadia Code, Menlo, Consolas, monospace. Paths, commands, code,
  identifiers, shortcuts, commit hashes, model IDs, terminal-like data.

### The scale

Every step is a function of `--ui-font-size`, and `--ui-font-size` is
`--ui-font-base` times the font-size setting. A theme sets the base; the
setting multiplies it. This is why One UI's body step is 15px and the
monochrome family's is 14px without either of them hard-coding a size.

| Token | Formula | One UI | Monochrome |
| --- | --- | ---: | ---: |
| `text-ui-xl` | base + 6 / + 4 | 21px | 18px |
| `text-ui-lg` | base + 4 / + 2 | 19px | 16px |
| `text-ui-base` | base | 15px | 14px |
| `text-ui-caption` | base − 1 | 14px | 13px |
| `text-ui-sm` | base − 2 | 13px | 12px |
| `text-ui-xs` | base − 3 | 12px | 10px |
| `text-ui-2xs` | base − 4 | 11px | 9px |

`text-ui-2xs` is a restricted step: badge-scale labels, counters and very
weak metadata. It is not for content, labels or descriptions.

### Roles

- `text-ui-xl` / `text-ui-lg` — first- and second-level reading headings.
- `text-ui-base` — body copy, buttons, workspace and section titles, the
  default for application UI.
- `text-ui-caption` — supporting copy one step below body text.
- `text-ui-sm` — secondary copy, helper text, tooltip copy, markdown inline
  code.
- `text-ui-xs` — badges, compact labels, counters, keyboard shortcuts.
- `text-ui-2xs` — the weakest metadata there is.

Choose by role, not by visual preference. Font size and colour hierarchy
are independent decisions: pair secondary copy with
`--color-foreground-subtle` and weak metadata with
`--color-foreground-subtlest`.

Markdown rendered in an assistant response uses the same scale: `h1` is
`text-ui-xl`, `h2` is `text-ui-lg`, `h3`–`h6` are `text-ui-base` and are
told apart by weight, body and links are `text-ui-base`, and inline code is
`font-mono text-ui-sm`. Code-block body keeps its own size setting.

### Rules

- Compact and readable. `font-medium` for headings and labels.
- Monospace only where the content is inherently technical.
- Respect expansion. Do not build a layout that only works for short
  English labels, and do not rely on tight truncation as the only way a
  component survives translation.

## Spacing

The base unit is 4px.

- `4px` — tight icon and text spacing
- `8px` — compact control padding and inline gaps
- `12px` — dense list items and menu rows
- `16px` — standard card and panel padding
- `20px`–`24px` — larger sections and dialog interiors

Rules:

- Keep dense operational UI compact by default.
- Prefer a small set of repeated gaps over arbitrary values.
- In a flex row whose text truncates, the truncating element needs
  `min-w-0`; in a nested scroll or split-panel layout, the scrolling
  region needs `min-h-0`. `overflow-auto` alone does not create a
  shrinkable flex region.
- Prefer `w-full` with a `max-w-*` over a hard-coded width.

## Radius

Radius follows the nesting of visible rounded containers, not the
importance of the component.

One UI's ladder is 8 / 12 / 16 / 24; the monochrome family's is 4 / 6 / 8 /
12. Both are derived from one number, `--radius`, so the radius slider in
Settings moves all four steps together:

| Step | One UI | Monochrome | Used by |
| --- | ---: | ---: | --- |
| `--radius-sm` | 8px | 4px | small controls, chips |
| `--radius-md` | 12px | 6px | buttons and inputs, a control inside a card |
| `--radius-lg` | 16px | 8px | cards, panels, menu items |
| `--radius-xl` | 24px | 12px | large containers, the composer card |

Rules:

- The first rounded container starts a level down from the one around it.
  Peer containers at the same level share a radius.
- A basic control — button, input, select trigger, menu trigger — takes the
  step of its nearest rounded parent: one level down from a card, two from a
  panel.
- `rounded-full` is for deliberate pills and circles only. A button, a
  badge or a counter does not earn it by being a button.
- Values below the floor (2px, 3px) are hairlines, not corners. Leave them.
- Do not use the bare `rounded` utility; it is ambiguous.

## Sizing

- Icons: `size-3`, `size-3.5`, `size-4` (the default), `size-5`, `size-6`.
- Square icon buttons: `size-6`, `size-7`, `size-8`, `size-9`.
- Control heights: `h-6`, `h-7`, `h-8`, `h-9`.
- Regular inputs: `h-9`. Compact filters and inline inputs: `h-7`, `h-8`.

Use the shared Button's `size` variants rather than width and height
overrides. Prefer fluid widths for content; fixed widths are fine for
menus, popovers, dialogs and the stable side panels.

## Components

### Buttons

`primary` (the default accent fill), `secondary`, `outline`, `ghost`,
`destructive`, `link`. Sizes `xs`, `default`, `sm`, `lg`, `icon-*`.

- Use the existing variants first.
- Keep icon-only buttons square.
- Do not promote every action to primary. A panel has one primary action,
  and the accent is how you say which.

### Inputs

`bg-input border-input-border text-foreground`, hovering to
`--color-input-border-hover`, focusing to `--color-input-border-focused`.
Inputs should feel calm and integrated, never glowing. Do not style an
ordinary input like a card.

### Cards and panels

`bg-surface` with the surface border. A card sits above the page and below
an overlay. Keep card surfaces quieter than overlays, and do not mix
several card backgrounds in one view unless they encode real hierarchy.

### Menus, popovers and dialogs

- Menus: `bg-menu`, `rounded-lg` (One UI: `--radius-lg`), `shadow-md`,
  `border-popover-border`, `p-1`, dense rows.
- Menu items: `rounded-md`, `bg-menu-hover` on hover, and a checkmark or a
  trailing marker for the selected item rather than a strong full-row fill.
- Popovers: `bg-popover`, `border-popover-border`, `shadow-md`.
- Dialogs: `bg-popover`, `rounded-xl` or larger, `shadow-md`.
- Option rows in a menu are separated by a fixed 2px vertical gap.

Interactive overlays render above passive tooltips. A tooltip must never
cover an option in an open menu.

### Tabs and selection

An inactive tab stays neutral. The active one takes the neutral
`--color-selected` fill, not a brand block. A selected list row takes the
same fill and keeps its own state marker.

### Chat and tool output

- The answer is the dominant element. Tool calls and reasoning stay quiet
  and expandable: a summary row that folds away, opening only on demand.
- Tool output, terminal-like blocks, paths, hashes and commands are
  monospace.
- Diff UI uses the diff tokens, never the success and danger colours.
- A user message is a bubble with a trimmed corner; the assistant's answer
  is not.

## Elevation

Layer with background contrast and borders first; reach for a shadow last.

- **Base** — no shadow. Structure comes from the surface steps.
- **Overlay** — `shadow-md` for menus, popovers and dialogs.
- **Attention** — `shadow-lg` only for toasts and rare floating cards.

Do not use a large soft shadow for ordinary layout, and do not invent a
shadow: `--shadow-md` and `--shadow-lg` are the only two.

## Motion

Fast and low-drama. Motion should clarify a state change, not decorate the
screen.

| Token | One UI | Monochrome | Used by |
| --- | ---: | ---: | --- |
| `--duration-fast` | 200ms | 120ms | hovers, colour and fill changes |
| `--duration-normal` | 300ms | 160ms | overlays, menus, dialogs |
| `--duration-slow` | 450ms | 200ms | rare, large transitions |
| `--duration-panel` | 300ms | 260ms | the drawer and the side panel opening and closing |

Easing: `--ease-out` for everything that fades or changes colour.
`--ease-spring` (an overshoot curve) exists only in One UI and only for
things that move — entrances. Overshoot on a hover reads as a toy.

Rules:

- Every duration and easing comes from a token. A literal millisecond value
  in a rule is a defect.
- `transition: all` is never correct. Name the properties.
- `prefers-reduced-motion` flattens the durations; it does not remove the
  state change.

## Workspace layout

Three panes: the session drawer, the conversation, and the side panel.

- The drawer collapses to **width zero** on `--duration-panel`; it does not
  become an icon rail. Its content is held at a fixed width inside, so
  nothing reflows mid-animation, and `visibility` flips after the collapse
  finishes so a closed drawer leaves the tab order and the accessibility
  tree.
- The side panel is the same mechanism, and it is a pill tab rail: the tab
  set is open-ended, so pills scroll rather than compress, and the active
  pill takes the neutral selected fill.
- Panel widths are the `--panel-sessions-w` and `--panel-side-w` custom
  properties, so the drag resizer and the collapsed state drive the same
  number.
- The titlebar, the drawer and the side panel each own one control for
  their own panel. Two controls for one panel, or one control for two
  panels, is a bug.

## Responsive behaviour

**Size components by their container, not by the window.** The composer is
the same component in the chat column and in the 320px side panel, and
viewport breakpoints cannot tell those apart — at a 1440px window the
panel's composer got the full desktop control sizes and ran off the
panel's edge.

So the composer is a query container, and its compact rules are measured
against the space it actually has:

- 900px — the model trigger gives up its 260px cap.
- 560px — the access-mode label goes. An icon alone cannot say whether the
  agent can currently run commands, so it keeps its label as long as the
  row can afford it.
- 400px — the reasoning-effort label follows.
- 340px — the model's provider prefix goes before the model name does. The
  name is what identifies what will run.

Other rules:

- Start with a stable base layout, then enhance with breakpoints.
- Breakpoints change layout, width, visibility and density — never the
  semantic meaning of a component.
- Keep the primary actions available at every breakpoint.
- A collapse that reacts to the viewport is **transient**. It is a
  reaction to the current size, not a preference, and it must not be
  written to the settings store — otherwise opening the app in a narrow
  window collapses the panel in every later window too. Only an explicit
  toggle is a preference.

## Accessibility and internationalisation

- Keyboard navigation is a first-class path, not an afterthought.
- Every focusable control has a visible focus indicator. The global
  `:focus-visible` outline lives in the base layer, so a component can opt
  out of it — but only if it has a replacement.
- Status is never colour alone; it is always paired with text or a shape.
- Contrast holds in every theme. The gallery measures it and prints the
  table.
- Layouts tolerate longer translations and wider labels.

## Working in this repository

- The stylesheet is the value source; the gallery reads it live; this
  document is the rule. A value in this document that disagrees with
  `src/index.css` is wrong here.
- A new token is added in `src/index.css` first, then to the vocabulary
  above, then to the gallery's swatch groups.
- Every component belongs in the gallery at `/gallery.html`, rendered in
  isolation with mock data, with no backend and no Electron bridge. A
  component that needs the app shell to render is a defect, not a reason to
  move the gallery toward the app.
- The gallery must print live values. A hard-coded number in the gallery
  rots the moment the stylesheet changes, which is worse than leaving it
  out.
- Reuse the primitives in `src/components/ui/` and
  `src/components/ai-elements/` before inventing a variant.
- When in doubt, prefer the quieter UI and the stronger hierarchy.
