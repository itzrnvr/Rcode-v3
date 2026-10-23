/*
 * Tests for electron/agent/tools.ts — the v1 tool surface — and its access
 * modes. Every tool receives ToolContext { signal, cwd }; paths resolve
 * against cwd and every file operation is confined to it.
 *
 * Pinned here:
 *   - plan mode is read-only: write_file, edit_file and shell refuse with a
 *     message that tells the model to propose instead of act; reads still work;
 *   - restricted mode fails closed: with no allowlist nothing is accessible;
 *     with an allowlist only paths under it (and under cwd) are accessible,
 *     and shell is refused outright;
 *   - paths escaping cwd are refused lexically AND through symlinks (the
 *     symlink case is a directory junction on Windows, which needs no
 *     privileges, and a plain directory symlink elsewhere);
 *   - every oversized output is truncated and says so with counts.
 */
import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { createTools, normalizeAccessMode } from "../electron/agent/tools.ts";
import type { EngineTool, ToolContext } from "../electron/agent/engine.ts";

// ---------------------------------------------------------------------------
// Fixture tree
// ---------------------------------------------------------------------------

let base = ""; // mkdtemp root
let root = ""; // the turn's cwd
let outside = ""; // a sibling directory outside cwd

before(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), "rcode-tools-test-"));
  root = path.join(base, "work");
  outside = path.join(base, "outside");
  await fs.mkdir(path.join(root, "sub"), { recursive: true });
  await fs.mkdir(outside, { recursive: true });
  await fs.writeFile(path.join(root, "a.txt"), "alpha line\nbeta line\n", "utf8");
  await fs.writeFile(path.join(root, "sub", "b.txt"), "inside sub\n", "utf8");
  await fs.writeFile(path.join(outside, "secret.txt"), "top secret\n", "utf8");
});

after(async () => {
  await fs.rm(base, { recursive: true, force: true });
});

function byName(tools: EngineTool[], name: string): EngineTool {
  const tool = tools.find((t) => t.name === name);
  assert.ok(tool, `tool ${name} exists`);
  return tool;
}

function ctx(cwd: string = root, signal?: AbortSignal): ToolContext {
  return { cwd, signal: signal ?? new AbortController().signal };
}

/** Run a tool expecting a refusal; returns the refusal message. */
async function expectRefuse(promise: Promise<unknown>, pattern: RegExp): Promise<string> {
  return assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof Error, `expected an Error, got ${String(err)}`);
    assert.match(err.message, pattern, `refusal message mismatch: ${err.message}`);
    return true;
  }) as unknown as Promise<string>;
}

// ---------------------------------------------------------------------------
// normalizeAccessMode
// ---------------------------------------------------------------------------

test("normalizeAccessMode maps composer spellings and falls back to full-access", () => {
  assert.equal(normalizeAccessMode("plan"), "plan");
  assert.equal(normalizeAccessMode("  PLAN "), "plan");
  assert.equal(normalizeAccessMode("read-only"), "plan");
  assert.equal(normalizeAccessMode("readonly"), "plan");
  assert.equal(normalizeAccessMode("restricted"), "restricted");
  assert.equal(normalizeAccessMode("restricted-access"), "restricted");
  assert.equal(normalizeAccessMode("full-access"), "full-access");
  assert.equal(normalizeAccessMode(""), "full-access");
  assert.equal(normalizeAccessMode(null), "full-access");
  assert.equal(normalizeAccessMode(undefined), "full-access");
  assert.equal(normalizeAccessMode("nonsense"), "full-access");
});

test("the tool surface is exactly the six v1 tools", () => {
  const names = createTools().map((t) => t.name);
  assert.deepEqual(names.sort(), ["edit_file", "grep", "list_dir", "read_file", "shell", "write_file"]);
  for (const tool of createTools()) {
    assert.equal(typeof tool.description, "string");
    assert.ok(tool.description.length > 0, `${tool.name} has a description`);
    assert.equal(typeof tool.execute, "function");
    assert.equal(tool.parameters.type, "object");
  }
});

// ---------------------------------------------------------------------------
// Full access: the happy paths the refusals are measured against
// ---------------------------------------------------------------------------

test("write_file creates nested parents and read_file returns numbered lines", async () => {
  const tools = createTools({ mode: "full-access" });
  const write = await byName(tools, "write_file").execute(
    { path: "deep/nested/f.txt", content: "one\ntwo" },
    ctx(),
  );
  assert.equal(write, `Wrote 7 bytes to ${path.join("deep", "nested", "f.txt")}.`);
  const read = await byName(tools, "read_file").execute({ path: "deep/nested/f.txt" }, ctx());
  assert.equal(read, "1\tone\n2\ttwo");
});

test("absolute paths inside cwd are accepted", async () => {
  const tools = createTools({ mode: "full-access" });
  const result = await byName(tools, "read_file").execute({ path: path.join(root, "a.txt") }, ctx());
  assert.match(String(result), /alpha line/);
});

test("edit_file replaces a unique passage", async () => {
  const tools = createTools({ mode: "full-access" });
  const result = await byName(tools, "edit_file").execute(
    { path: "a.txt", old_string: "beta line", new_string: "BETA LINE" },
    ctx(),
  );
  assert.equal(result, "Replaced 1 occurrence in a.txt.");
  const read = await byName(tools, "read_file").execute({ path: "a.txt" }, ctx());
  assert.match(String(read), /BETA LINE/);
});

test("shell runs a command and reports its status and output", async () => {
  const tools = createTools({ mode: "full-access" });
  const result = String(
    await byName(tools, "shell").execute({ command: "echo rcode-shell-test" }, ctx()),
  );
  assert.match(result, /exit code 0/);
  assert.match(result, /rcode-shell-test/);
});

// ---------------------------------------------------------------------------
// Plan mode: read-only, and the refusal says to propose instead of act
// ---------------------------------------------------------------------------

test("plan mode refuses write_file before touching anything", async () => {
  const tools = createTools({ mode: "plan" });
  await expectRefuse(
    byName(tools, "write_file").execute({ path: "planned.txt", content: "nope" }, ctx()),
    /write_file refused: plan mode is read-only/,
  );
  await assert.rejects(fs.stat(path.join(root, "planned.txt")), { code: "ENOENT" }, "nothing was written");
});

test("plan mode refuses edit_file and shell", async () => {
  const tools = createTools({ mode: "plan" });
  await expectRefuse(
    byName(tools, "edit_file").execute({ path: "a.txt", old_string: "alpha", new_string: "x" }, ctx()),
    /edit_file refused: plan mode is read-only/,
  );
  await expectRefuse(
    byName(tools, "shell").execute({ command: "echo hi" }, ctx()),
    /shell refused: plan mode is read-only/,
  );
});

test("plan mode still allows reading, listing and grepping", async () => {
  const tools = createTools({ mode: "plan" });
  const read = String(await byName(tools, "read_file").execute({ path: "a.txt" }, ctx()));
  assert.match(read, /alpha line/);
  const list = String(await byName(tools, "list_dir").execute({}, ctx()));
  assert.match(list, /a\.txt/);
  assert.match(list, /sub\//);
  const grep = String(await byName(tools, "grep").execute({ pattern: "alpha", path: "." }, ctx()));
  assert.match(grep, /a\.txt:1: alpha line/);
});

// ---------------------------------------------------------------------------
// Restricted mode: fail closed, then allow only the allowlist
// ---------------------------------------------------------------------------

test("restricted mode with no allowlist refuses every file operation", async () => {
  for (const allowedPaths of [undefined, []]) {
    const tools = createTools({ mode: "restricted", allowedPaths });
    await expectRefuse(
      byName(tools, "read_file").execute({ path: "a.txt" }, ctx()),
      /restricted mode is active but no allowlist \(allowedPaths\) was configured/,
    );
    await expectRefuse(
      byName(tools, "write_file").execute({ path: "w.txt", content: "x" }, ctx()),
      /restricted mode is active but no allowlist/,
    );
    await expectRefuse(
      byName(tools, "edit_file").execute({ path: "a.txt", old_string: "alpha", new_string: "x" }, ctx()),
      /restricted mode is active but no allowlist/,
    );
    await expectRefuse(byName(tools, "list_dir").execute({}, ctx()), /restricted mode is active but no allowlist/);
    await expectRefuse(
      byName(tools, "grep").execute({ pattern: "alpha", path: "." }, ctx()),
      /restricted mode is active but no allowlist/,
    );
  }
});

test("a whitespace-only allowlist fails closed too", async () => {
  const tools = createTools({ mode: "restricted", allowedPaths: ["   "] });
  await expectRefuse(
    byName(tools, "read_file").execute({ path: "a.txt" }, ctx()),
    /no allowlist \(allowedPaths\) was configured/,
  );
});

test("restricted mode allows only paths under the allowlist", async () => {
  const tools = createTools({ mode: "restricted", allowedPaths: ["sub"] });

  const read = String(await byName(tools, "read_file").execute({ path: "sub/b.txt" }, ctx()));
  assert.match(read, /inside sub/);

  const write = String(
    await byName(tools, "write_file").execute({ path: "sub/new.txt", content: "fresh" }, ctx()),
  );
  assert.match(write, /Wrote 5 bytes to sub[\\/]new\.txt/);

  const edit = String(
    await byName(tools, "edit_file").execute(
      { path: "sub/b.txt", old_string: "inside sub", new_string: "edited sub" },
      ctx(),
    ),
  );
  assert.match(edit, /Replaced 1 occurrence/);

  const list = String(await byName(tools, "list_dir").execute({ path: "sub" }, ctx()));
  assert.match(list, /b\.txt/);
  const grep = String(await byName(tools, "grep").execute({ pattern: "edited", path: "sub" }, ctx()));
  assert.match(grep, /b\.txt:1: edited sub/);
});

test("restricted mode refuses paths outside the allowlist, naming the allowed roots", async () => {
  const tools = createTools({ mode: "restricted", allowedPaths: ["sub"] });
  await expectRefuse(
    byName(tools, "read_file").execute({ path: "a.txt" }, ctx()),
    /outside the restricted allowlist \(allowed: sub\)/,
  );
  await expectRefuse(byName(tools, "list_dir").execute({}, ctx()), /outside the restricted allowlist/);
  await expectRefuse(
    byName(tools, "grep").execute({ pattern: "alpha", path: "." }, ctx()),
    /outside the restricted allowlist/,
  );
  await expectRefuse(
    byName(tools, "write_file").execute({ path: "elsewhere.txt", content: "x" }, ctx()),
    /outside the restricted allowlist/,
  );
});

test("restricted mode refuses shell outright", async () => {
  const tools = createTools({ mode: "restricted", allowedPaths: ["sub"] });
  await expectRefuse(
    byName(tools, "shell").execute({ command: "echo hi" }, ctx()),
    /shell refused: restricted mode confines file access to an allowlist/,
  );
});

// ---------------------------------------------------------------------------
// Confinement: nothing reaches outside cwd, lexically or through symlinks
// ---------------------------------------------------------------------------

test("paths resolving outside cwd are refused, in every spelling", async () => {
  const tools = createTools({ mode: "full-access" });
  const read = byName(tools, "read_file");
  await expectRefuse(read.execute({ path: "../outside/secret.txt" }, ctx()), /resolves outside the working directory/);
  await expectRefuse(
    read.execute({ path: path.join(outside, "secret.txt") }, ctx()),
    /resolves outside the working directory/,
  );
  await expectRefuse(read.execute({ path: "sub/../../outside/secret.txt" }, ctx()), /resolves outside the working directory/);
  await expectRefuse(byName(tools, "list_dir").execute({ path: ".." }, ctx()), /resolves outside the working directory/);
  await expectRefuse(
    byName(tools, "grep").execute({ pattern: "x", path: ".." }, ctx()),
    /resolves outside the working directory/,
  );
  await expectRefuse(
    byName(tools, "write_file").execute({ path: "../evil.txt", content: "x" }, ctx()),
    /resolves outside the working directory/,
  );
  await expectRefuse(
    byName(tools, "edit_file").execute(
      { path: "../outside/secret.txt", old_string: "a", new_string: "b" },
      ctx(),
    ),
    /resolves outside the working directory/,
  );
  await assert.rejects(fs.stat(path.join(base, "evil.txt")), { code: "ENOENT" }, "nothing was written outside");
});

test("a symlink inside cwd pointing outside cwd is refused", async () => {
  const link = path.join(root, "jump");
  try {
    // "junction" needs no privileges on Windows and is treated as a directory
    // symlink elsewhere, so this case runs on every platform that allows it.
    await fs.symlink(outside, link, "junction");
  } catch {
    test.skip("symlink creation is not permitted in this environment", () => {});
    return;
  }
  const tools = createTools({ mode: "full-access" });
  await expectRefuse(
    byName(tools, "read_file").execute({ path: "jump/secret.txt" }, ctx()),
    /reaches outside the working directory through a symlink/,
  );
  await expectRefuse(
    byName(tools, "write_file").execute({ path: "jump/planted.txt", content: "x" }, ctx()),
    /through a symlink/,
  );
});

test("a symlink inside cwd pointing inside cwd still works", async () => {
  const link = path.join(root, "within");
  try {
    await fs.symlink(path.join(root, "sub"), link, "junction");
  } catch {
    test.skip("symlink creation is not permitted in this environment", () => {});
    return;
  }
  const tools = createTools({ mode: "full-access" });
  const read = String(await byName(tools, "read_file").execute({ path: "within/b.txt" }, ctx()));
  assert.match(read, /inside sub|edited sub/);
});

// ---------------------------------------------------------------------------
// Output budget: truncation always says what was cut
// ---------------------------------------------------------------------------

test("read_file truncates oversized results and states the remainder", async () => {
  const big = path.join(root, "big.txt");
  await fs.writeFile(big, "x".repeat(30_000), "utf8");
  const tools = createTools();
  const result = String(await byName(tools, "read_file").execute({ path: "big.txt" }, ctx()));
  assert.match(result, /result truncated, \d+ more characters/);
  assert.ok(result.length > 20_000 && result.length < 20_200, `capped near 20k, got ${result.length}`);
  assert.ok(result.startsWith("1\t"), "the body is intact up to the cap");
});

test("read_file pages at 2000 lines and says exactly what was withheld", async () => {
  // Short base36 line bodies keep 2000 lines under the 20k character result
  // cap, so this file exercises the line cap rather than the character cap.
  const lines: string[] = [];
  for (let i = 0; i < 2100; i += 1) lines.push(i.toString(36));
  await fs.writeFile(path.join(root, "long.txt"), `${lines.join("\n")}\n`, "utf8");
  const tools = createTools();

  const first = String(await byName(tools, "read_file").execute({ path: "long.txt" }, ctx()));
  assert.match(first, /\[showing lines 1-2000 of 2100; pass a higher offset to continue\]/);
  assert.ok(first.includes("2000\t1jj"), "line 2000 (body 1jj) is the last line shown");
  assert.ok(!first.includes("1jk"), "line 2001 (body 1jk) is not shown yet");

  const rest = String(await byName(tools, "read_file").execute({ path: "long.txt", offset: 2001 }, ctx()));
  assert.match(rest, /\[showing lines 2001-2100 of 2100\]/);
  assert.ok(rest.includes("2001\t1jk"), "the page resumes exactly at line 2001");
});

test("list_dir caps entries and reports how many were withheld", async () => {
  const many = path.join(root, "many");
  await fs.mkdir(many, { recursive: true });
  const names: string[] = [];
  for (let i = 0; i < 505; i += 1) names.push(`f${String(i).padStart(3, "0")}.txt`);
  await Promise.all(names.map((n) => fs.writeFile(path.join(many, n), "", "utf8")));

  const tools = createTools();
  const result = String(await byName(tools, "list_dir").execute({ path: "many" }, ctx()));
  const shown = result.split("\n");
  assert.equal(shown.length, 501, "500 entries plus the withheld-count note");
  assert.equal(shown[shown.length - 1], "[5 more entries not shown]");
});

test("grep stops at the 200-match cap and says so in the header", async () => {
  const lines: string[] = [];
  for (let i = 0; i < 250; i += 1) lines.push(`needle ${String(i).padStart(3, "0")}`);
  await fs.writeFile(path.join(root, "capfile.txt"), `${lines.join("\n")}\n`, "utf8");
  const tools = createTools();
  const result = String(
    await byName(tools, "grep").execute({ pattern: "needle", path: "capfile.txt" }, ctx()),
  );
  assert.ok(
    result.startsWith("[200 matches in 1 file; 1 files scanned; stopped at the 200-match cap]"),
    `header should carry counts and the cap, got: ${result.split("\n")[0]}`,
  );
  assert.equal(result.split("\n").length - 1, 200);
});

// ---------------------------------------------------------------------------
// Abort
// ---------------------------------------------------------------------------

test("tools refuse to run once the turn's signal has aborted", async () => {
  const ac = new AbortController();
  ac.abort();
  const tools = createTools();
  await expectRefuse(
    byName(tools, "read_file").execute({ path: "a.txt" }, ctx(root, ac.signal)),
    /abort/i,
  );
});
