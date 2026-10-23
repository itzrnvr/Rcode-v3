# Tests

Two suites live in `tests/`: Node's built-in runner for the backend units, and
Playwright for real-layout UI coverage.

## Unit tests — `node --test`

`tests/*.test.ts` run on Node's built-in test runner (v26 strips TS types
natively). Run them from the repo root with bare:

```bash
node --test
```

`node --test tests/` does **not** work: the positional argument is loaded as a
module (`Cannot find module '…\tests'`) instead of being scanned for test
files. Use the bare form, which discovers the suite on its own.

What is covered, one file per backend layer:

- **`provider-sse.test.ts`** — the OpenAI-compatible streaming client, against
  scripted SSE bodies: chunk-boundary parsing, keep-alive comments, `[DONE]`
  and incomplete-round handling, reasoning-before-text ordering within a chunk,
  fragment repair into canonical `assistant_end` blocks, tool-call fragments
  merged by index, usage emission, HTTP and in-stream errors, aborts, the
  outgoing request shape (auth, `tools` omitted when empty, the one-retry
  without `stream_options` on a 400), and the turn loop's event ordering.
- **`tools.test.ts`** — the v1 tool surface: exactly the six tools, access
  modes (plan refuses writes and shell, restricted allowlist fails closed),
  path confinement including symlink escapes from the working directory,
  truncation caps that state what was withheld, and refusal once the turn's
  abort signal has fired.
- **`trace-mapping.test.ts`** — mapping StreamEvents onto trace rows:
  reasoning deltas coalescing into one thinking row, tool rows opening and
  resolving, `assistant_end` repairing fragmented streams, and the
  open/pinned/folded click behaviour.
- **`trace-ssr.test.ts`** — the Trace component rendered server-side with no
  browser and no Electron bridge: status marking, the shimmer and how
  `prefers-reduced-motion` stills it, truncation, and collapsible open/close
  semantics.

## Playwright UI tests

Playwright end-to-end tests covering **responsive layout and interaction**.

### Why Playwright and not renderer unit tests

jsdom has no layout engine, no media queries and no real hit-testing. A panel
that hangs 20px past the edge of a phone, or two composer controls whose
bounding boxes overlap, passes every `render()` test. The recurring failure
mode in this app is exactly that class of bug, so these tests assert real
geometry — positions, widths and overlap — at three viewport sizes.

### Running

```bash
npm test                 # all three viewports
npm run test:mobile      # mobile only
npm run test:responsive  # tablet + mobile
npm run test:ui          # Playwright's interactive inspector
```

The dev server is started automatically by Playwright and an already-running one
on port 5173 is reused.

### What is covered

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

No test asserts a successful turn against a **live provider** — the unit suite
scripts its SSE bodies and temp directories, and the UI suite would need real
credentials to drive a real model. The layers between them (SSE parsing, tool
execution, trace mapping, persistence) are each covered on their own.
