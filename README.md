# Rcode

Minimal, fast desktop AI coding assistant. Native, local-first, with persistent side chats and a Codex-inspired composer.

Rcode owns its own agent. There is no external agent backend and no fallback — the tool loop, context assembly and compaction live in this repo, so the harness stays stable while you iterate on models and evaluation.

## Status

The agent backend is Rcode's own, implemented end to end in `electron/agent/`:

- **`engine.ts`** — the contract `ipc/chat.ts` consumes: `AgentEngine`
  (runTurn / resetToAnchor / compact), the `StreamEvent` set (text, reasoning,
  tool_start, tool_end, usage, assistant_end), `EngineTool`, `TurnRequest`.
- **`provider.ts`** — the OpenAI-compatible streaming client. POSTs
  `stream: true` to `/chat/completions`, parses the SSE stream into
  StreamEvents, and runs the tool loop across rounds. Dependency-free — global
  fetch plus a TextDecoder. Every round ends with one `assistant_end` carrying
  canonical blocks, which repairs arbitrarily fragmented reasoning/text
  interleaving (the `F`/`ORK-OK` case).
- **`tools.ts`** — the v1 tool surface: `read_file`, `write_file`, `edit_file`,
  `list_dir`, `grep`, `shell`. Every file operation is confined to the
  session's project directory, symlink-checked; results are size-capped and
  every truncation says what was withheld.
- **`loop.ts`** — the `AgentEngine` implementation. Rebuilds each turn's
  request context from SQLite history so the model sees what the user sees
  (edits, version switches, restores included), arms retry anchors, persists
  compaction summaries as settings, and logs the per-round trace entries the
  Trajectory view renders.

The composer's access mode gates the tool set per turn: **full-access** runs
all six tools, **plan** is read-only (writes and shell refuse and ask the model
to propose instead of act), **restricted** confines file operations to a
configured path allowlist and refuses shell outright — with no allowlist
configured, restricted mode allows nothing (fail closed).

Everything around the agent is built and working — transcript, persistence,
retry/version branching, tracing, trajectory, settings, side chats.

## Features

- **Persistent chats** — SQLite-backed sessions, side chats that survive restarts, promote to main
- **Nested side chats** — thread depth indicators, breadcrumb back
- **Typed turns** — reasoning, response, tool_call and tool_result persisted as ordered events; tool results are turn-segment boundaries
- **Retry versioning** — retry replaces its target in place and archives the tail per version; version arrows restore it
- **Session forking** — fork from any message into a real side chat
- **Trajectory viewer** — full request/response JSONL trace, timeline with zoom/brush, inspector
- **Side panel** — Terminal (node-pty), embedded Browser preview, Review, Git
- **Annotation** — in-app screenshot markup with pen/arrow/box and numbered element picking
- **Composer** — access mode, model picker, reasoning effort, slash commands, steering queue
- **Theming** — 4 presets with live CSS vars, translucent sidebar, font scaling
- **Runs in a browser** — the full UI against the same backend at `http://127.0.0.1:5173`

## Tech

Electron 44 · React 19 · Vite 6 · Tailwind 3 · Radix + Base UI · streamdown + shiki · SQLite via `better-sqlite3` (WAL) · node-pty

## Quick start

```bash
npm install
npm run build          # tsc -p tsconfig.node.json && vite build
npm run dev            # vite on 5173 + electron
```

Electron loads `dist/renderer/index.html` when it exists, otherwise the Vite dev server.

### UI development runs in the browser

For UI work, run the browser-only loop:

```bash
npm run dev:web    # Vite + a headless backend, no Electron window
```

Open `http://127.0.0.1:5173`. The Electron window is reserved for window-chrome
work — titlebar, traffic lights, tray.

**`gallery.html`** at `http://127.0.0.1:5173/gallery.html` renders components in
isolation against mock data, with no backend and no Electron bridge. Use it to
build, review and customise components without running the app, and extend it
when a component or its states change. A component that needs the app shell to
mount is a defect — components reach `window.electron` optionally at render time.

`strictPort` is on, so a busy 5173 fails loudly instead of falling through to
5174, which is the API server.

The browser API server also runs on `127.0.0.1:5174`, exposing the same handler registry as Electron IPC with SSE streaming, proxied by Vite at `/api/ipc`, `/api/events`, `/api/health`.

### Native modules

`better-sqlite3` and `node-pty` ship prebuilt binaries but need their install
scripts allowed. `package.json` pins them in `allowScripts` — if you bump either
dependency, update that map too or npm silently skips the native step.

## State

All state lives under `~/.rcode` (override with `RCODE_HOME`):

```
data/rcode.db     SQLite: sessions, messages, turn_versions, providers, settings
traces/           per-session agent request/response JSONL
feedback/         saved UI annotations
electron/         Chromium profile
```

## Project structure

```
src/
  api/            typed client; browserElectron.ts adapts the web bridge
  components/
    ai-elements/  vendored shadcn primitives (conversation, message, reasoning, tool)
    chat/         AgentConversation / AgentMessage / AgentTurnView / AgentPromptInput
    layout/       AppShell, TitleBar
    sessions/     SessionList
    settings/     SettingsModal, Theme, Model
    sidepanel/    SidePanel, TrajectoryView, BrowserPane, Terminal
    feedback/     FeedbackOverlay
    dev/          Gallery — every component in isolation, no backend
  state/          AppContext, useChat, useSessions, useSideChats
electron/
  agent/          engine.ts (AgentEngine contract), provider.ts, tools.ts,
                  loop.ts, trace.ts
  chat/           systemPrompt
  db/             sessions, messages, sideChats, providers, settings
  ipc/            one module per domain, registered in ipc/index.ts
  api/            registry.ts + webServer.ts, shared by IPC and the browser bridge
```

## Architecture notes

**One handler registry.** `electron/api/registry.ts` backs both Electron IPC and
the HTTP bridge, so the desktop app and the browser build cannot drift.

**Typed turn model.** Assistant turns persist ordered events in
`messages.turn_json`; `content` is only the final answer. A compatibility
parser handles rows written before this model existed.

**Stream fragmentation.** Providers interleave reasoning and text arbitrarily
within one assistant message. An engine must emit one `assistant_end` per
completed message carrying canonical blocks; the consumer replaces only the
segment after the last tool result. Without this, a stream that ends
`reasoning, "F", reasoning, "ORK-OK"` persists `ORK-OK`.

## Design

`DESIGN.md` is the design system, copied verbatim from
[zai-org/ZCode](https://github.com/zai-org/ZCode) (Apache-2.0, v3.15.1). It is
the authority for colour semantics, the typography scale, radius hierarchy,
spacing, sizing and motion, and a violation of it is a design-system defect
rather than a style preference.

It is currently unimplemented — Rcode's own theme layer still carries three
generations of tokens (a dead purple/navy palette in `tailwind.config.ts`,
shadcn names, and `--color-*` names), and interface font scaling mutates the
root `html` font size, which the spec forbids. Porting is staged.

Read `DESIGN.md` before writing UI.

## Known issues

**Two shiki versions ship in the bundle.** `package.json` pins `shiki@4.4.3`
(used by `code-block.tsx`), while `@streamdown/code` declares `shiki@^3.19.0`
and resolves a nested 3.23.0. Both emit their own grammar and theme chunks,
producing ~178 byte-identical files and ~4.6 MB of dead weight in
`dist/renderer/assets`. Fixing it means either dropping the direct `shiki`
dependency in favour of streamdown's, or forcing a single version with an npm
`overrides` entry. Not done here because both paths need rendering checks this
project has no automated coverage for.

## License

MIT — see `LICENSE`.
