# UI tests

Playwright end-to-end tests covering **responsive layout and interaction**.

## Why Playwright and not unit tests

jsdom has no layout engine, no media queries and no real hit-testing. A panel
that hangs 20px past the edge of a phone, or two composer controls whose
bounding boxes overlap, passes every `render()` test. The recurring failure mode
in this app is exactly that class of bug, so these tests assert real geometry —
positions, widths and overlap — at three viewport sizes.

## Running

```bash
npm test                 # all three viewports
npm run test:mobile      # mobile only
npm run test:responsive  # tablet + mobile
npm run test:ui          # Playwright's interactive inspector
```

The dev server is started automatically by Playwright and an already-running one
on port 5173 is reused.

## What is covered

- Document never scrolls horizontally at any viewport
- Left sidebar collapses and expands — as a 52px rail on desktop, as an
  off-canvas drawer on mobile, because those are two different mechanisms
- Right side panel opens, closes, and **reopens** (a toggle that only opens once
  is the bug this exists to catch), and stays inside the viewport when open
- Composer controls do not overlap — asserted as pairwise non-intersecting
  bounding boxes
- Model picker opens and renders its selected row

## Deliberately not covered

Electron-only window chrome — the titlebar, traffic lights and tray. Those have
no representation in a browser tab, so testing them here would test a mock. If
you want them covered they need a Playwright **Electron** project
(`_electron.launch()`), which is a separate piece of setup.

The agent engine is not wired (`getEngine()` throws), so no test asserts on a
successful chat turn.
