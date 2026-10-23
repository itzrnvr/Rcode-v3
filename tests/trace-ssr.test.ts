/*
 * SSR contract tests for the real Trace component (src/components/ui/trace.tsx).
 *
 * The component is TSX with a "@/..." import alias, so node cannot load it
 * directly. `before()` compiles it (plus react, Base UI's collapsible and its
 * other imports) into one self-contained bundle in the OS temp dir with
 * esbuild — the same compiler Vite uses — and the tests then render it with
 * react-dom/server in this bare node process: no DOM, no Electron bridge, no
 * dev server, per the project rule that components must mount in a plain
 * browser with no shell around them.
 *
 * What is pinned is the markup contract the chat renderer will rely on:
 *   - TraceLine carries data-status only when a status is given, and the
 *     running state shimmers while motion-reduce keeps the title still;
 *   - TraceIcon is aria-hidden (decorative);
 *   - a TraceCollapsible that is open renders its content, one that is closed
 *     does not (unless keepMounted, which renders it hidden);
 *   - the trigger exposes aria-expanded and carries the chevron rotation.
 */
import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import esbuild from "esbuild";

interface TraceSsrBundle {
  render(ui: unknown): string;
  h(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): unknown;
  Trace: unknown;
  TraceLine: unknown;
  TraceIcon: unknown;
  TraceTitle: unknown;
  TraceDescription: unknown;
  TraceCollapsible: unknown;
  TraceCollapsibleTrigger: unknown;
  TraceCollapsibleContent: unknown;
}

let bundle: TraceSsrBundle;
let outfile = "";

before(async () => {
  outfile = path.join(os.tmpdir(), `rcode-trace-ssr-${process.pid}-${Date.now()}.cjs`);
  await esbuild.build({
    entryPoints: [path.resolve(import.meta.dirname, "trace-ssr-entry.ts")],
    outfile,
    bundle: true,
    format: "cjs",
    platform: "node",
    jsx: "automatic",
    alias: { "@": path.resolve(import.meta.dirname, "..", "src") },
    logLevel: "silent",
  });
  const mod = (await import(pathToFileURL(outfile).href)) as { default?: TraceSsrBundle } & TraceSsrBundle;
  bundle = (mod.default ?? mod) as TraceSsrBundle;
  assert.equal(typeof bundle.render, "function", "the SSR bundle exposes render()");
});

after(async () => {
  if (outfile) await fs.rm(outfile, { force: true });
});

// bundle is only populated once before() has built and imported it, so all
// call sites go through this delegate rather than a top-level destructure.
const h: TraceSsrBundle["h"] = (...args) => bundle.h(...args);

// ---------------------------------------------------------------------------

test("TraceLine marks the status and only then", () => {
  const running = bundle.render(h(bundle.TraceLine, { status: "running" }, h(bundle.TraceTitle, null, "reading")));
  assert.match(running, /data-slot="trace-line"/);
  assert.match(running, /data-status="running"/);

  const error = bundle.render(h(bundle.TraceLine, { status: "error" }, h(bundle.TraceTitle, null, "failed")));
  assert.match(error, /data-status="error"/);

  const finished = bundle.render(h(bundle.TraceLine, null, h(bundle.TraceTitle, null, "done")));
  assert.match(finished, /data-slot="trace-line"/);
  assert.ok(!finished.includes("data-status"), "a finished line carries no data-status attribute");
});

test("a running line shimmers and motion-reduce keeps its title still", () => {
  const html = bundle.render(h(bundle.TraceLine, { status: "running" }, h(bundle.TraceTitle, null, "working")));
  assert.match(html, /shimmer/, "the running status drives the shimmer animation");
  assert.match(html, /motion-reduce:shimmer-none/, "prefers-reduced-motion must disable the shimmer");
});

test("TraceTitle truncates to one line", () => {
  const html = bundle.render(h(bundle.TraceTitle, null, "a very long title"));
  assert.match(html, /data-slot="trace-title"/);
  assert.match(html, /\btruncate\b/);
});

test("TraceDescription renders secondary text and never truncates", () => {
  const html = bundle.render(h(bundle.TraceDescription, null, "1.2s · 12 lines"));
  assert.match(html, /data-slot="trace-description"/);
  assert.match(html, /1\.2s · 12 lines/);
  assert.ok(!html.includes("truncate"), "descriptions are not clipped to one line");
});

test("TraceIcon is decorative (aria-hidden)", () => {
  const html = bundle.render(h(bundle.TraceIcon, null));
  assert.match(html, /data-slot="trace-icon"/);
  assert.match(html, /aria-hidden="true"/);
});

test("an open collapsible renders its content and announces aria-expanded", () => {
  const html = bundle.render(
    h(
      bundle.TraceCollapsible,
      { open: true },
      h(bundle.TraceCollapsibleTrigger, null, "read_file"),
      h(bundle.TraceCollapsibleContent, null, "the file body"),
    ),
  );
  assert.match(html, /data-open=""/);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /the file body/);
  assert.match(
    html,
    /<div data-open=""[^>]*data-slot="trace-collapsible-content"/,
    "the open panel is rendered without a hidden attribute",
  );
});

test("a closed collapsible unmounts its content", () => {
  const html = bundle.render(
    h(
      bundle.TraceCollapsible,
      { open: false },
      h(bundle.TraceCollapsibleTrigger, null, "read_file"),
      h(bundle.TraceCollapsibleContent, null, "the file body"),
    ),
  );
  assert.match(html, /data-closed=""/);
  assert.match(html, /aria-expanded="false"/);
  assert.ok(!html.includes("the file body"), "closed content is not in the tree at all");
});

test("keepMounted keeps closed content in the tree but hidden", () => {
  const html = bundle.render(
    h(
      bundle.TraceCollapsible,
      { open: false },
      h(bundle.TraceCollapsibleTrigger, null, "read_file"),
      h(bundle.TraceCollapsibleContent, { keepMounted: true }, "the file body"),
    ),
  );
  assert.match(html, /data-slot="trace-collapsible-content"/);
  assert.match(html, /<div data-closed="" hidden=""/, "the panel is present but hidden");
  assert.match(html, /the file body/);
});

test("defaultOpen opens without a controller", () => {
  const html = bundle.render(
    h(
      bundle.TraceCollapsible,
      { defaultOpen: true },
      h(bundle.TraceCollapsibleTrigger, null, "read_file"),
      h(bundle.TraceCollapsibleContent, null, "body"),
    ),
  );
  assert.match(html, /data-open=""/);
  assert.match(html, /body/);
});

test("the trigger carries the chevron and its rotation utility", () => {
  const html = bundle.render(
    h(
      bundle.TraceCollapsible,
      { open: true },
      h(bundle.TraceCollapsibleTrigger, null, "read_file"),
      h(bundle.TraceCollapsibleContent, null, "body"),
    ),
  );
  assert.match(html, /data-slot="trace-collapsible-trigger"/);
  assert.match(html, /<svg[^>]*lucide-chevron-right/);
  assert.match(html, /rotate-90/, "the chevron rotates when expanded");
});

test("Trace groups rows and renders without any Electron bridge", () => {
  const html = bundle.render(
    h(
      bundle.Trace,
      null,
      h(
        bundle.TraceCollapsible,
        { open: true },
        h(bundle.TraceCollapsibleTrigger, null, h(bundle.TraceLine, { status: "running" }, h(bundle.TraceTitle, null, "working"))),
        h(bundle.TraceCollapsibleContent, null, "detail"),
      ),
    ),
  );
  assert.match(html, /data-slot="trace"/);
  assert.match(html, /data-slot="trace-line"/);
  assert.match(html, /data-status="running"/);
});
