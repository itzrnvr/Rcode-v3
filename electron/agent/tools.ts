/*
 * PURPOSE: The v1 tool surface for Rcode's own agent loop — six real tools the
 * model may call: read_file, write_file, edit_file, list_dir, grep, shell.
 *
 * Every execute() receives ToolContext { signal, cwd } from agent/engine.ts:
 *   - relative paths resolve against ctx.cwd, and EVERY file operation is
 *     confined to ctx.cwd. Absolute paths are accepted only when they land
 *     inside it; symlink escapes are caught by realpathing the deepest
 *     existing ancestor of the target and re-checking containment.
 *   - long operations (grep's walk, shell) check the signal while they run,
 *     so an aborted turn stops the work itself, not just the stream.
 *
 * ACCESS MODES — createTools({ mode, allowedPaths }) builds one tool set per
 * turn (TurnRequest.mode is per turn, so build the set per turn too):
 *   full-access  all six tools; file operations confined to ctx.cwd.
 *   plan         read-only. write_file, edit_file and shell refuse with a
 *                message that tells the model to propose instead of act.
 *   restricted   every file operation must land under one of `allowedPaths`,
 *                intersected with the ctx.cwd confinement. shell is refused:
 *                an arbitrary command cannot honour a path allowlist. With
 *                no allowlist configured nothing is accessible — restricted
 *                fails closed.
 *   Unknown or empty mode strings fall back to "full-access", matching the
 *   composer's documented default.
 *
 * OUTPUT BUDGET — tool results are serialized into the model context, so every
 * result is a bounded string (see the *_MAX / *_CAP constants). Every
 * truncation says so, with counts, so the model knows what it did not see.
 *
 * Known limitations, accepted for v1: confinement is checked per call, so a
 * TOCTOU race between the check and the fs operation is theoretically open;
 * directory walks do not follow symlinks; grep uses fixed skip lists rather
 * than .gitignore parsing; shell output keeps head+tail, so the middle of a
 * very long log is not visible.
 */

import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { EngineTool, ToolContext } from "./engine";

// ---------------------------------------------------------------------------
// Output budget
// ---------------------------------------------------------------------------

/** Hard cap on any single tool result; results go straight into the context. */
const RESULT_CAP = 20_000;
/** read_file: default max lines per call, and the byte ceiling before we stop. */
const READ_MAX_LINES = 2_000;
const READ_MAX_BYTES = 1_000_000;
/** grep: match, scan and per-file caps. */
const GREP_MAX_MATCHES = 200;
const GREP_MAX_FILES = 2_000;
const GREP_MAX_FILE_BYTES = 1_000_000;
const GREP_LINE_SLICE = 300;
/** list_dir: maximum entries shown. */
const LIST_MAX_ENTRIES = 500;
/** shell: head+tail characters kept per stream, and the timeout clamp. */
const SHELL_STREAM_KEEP = 4_000;
const SHELL_DEFAULT_TIMEOUT_SECS = 120;
const SHELL_MAX_TIMEOUT_SECS = 600;

/** Directories the grep walk never descends into. */
const GREP_SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "out", "build", "coverage",
  "__pycache__", ".venv", "venv", ".next", ".cache", ".turbo",
]);

// ---------------------------------------------------------------------------
// Access mode
// ---------------------------------------------------------------------------

export type ToolMode = "full-access" | "plan" | "restricted";

export interface ToolSetOptions {
  /**
   * Composer access mode for the turn: "full-access", "plan" or "restricted".
   * Unknown or empty values fall back to "full-access".
   */
  mode?: string;
  /**
   * restricted mode only: paths (relative to the turn's cwd, or absolute)
   * that file operations may touch. Intersected with the cwd confinement.
   * Empty or missing means restricted mode allows nothing (fail closed).
   */
  allowedPaths?: string[];
}

/** Normalize a raw mode string from the composer into a ToolMode. */
export function normalizeAccessMode(raw: string | null | undefined): ToolMode {
  const s = String(raw ?? "").trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (s === "plan" || s === "read-only" || s === "readonly") return "plan";
  if (s === "restricted" || s === "restricted-access") return "restricted";
  return "full-access";
}

/**
 * Build the tool set for one turn. Call once per turn: the mode and allowlist
 * are captured at creation.
 */
export function createTools(options: ToolSetOptions = {}): EngineTool[] {
  const mode = normalizeAccessMode(options.mode);
  const allowedPaths = (options.allowedPaths ?? []).filter(
    (p): p is string => typeof p === "string" && p.trim() !== "",
  );

  /** Resolve, confine to ctx.cwd, and in restricted mode allowlist-check. */
  const confineForTool = async (
    ctx: ToolContext,
    requested: string,
  ): Promise<{ effective: string; display: string }> => {
    ensureLive(ctx.signal);
    const effective = await confine(ctx.cwd, requested);
    const cwdAbs = path.resolve(ctx.cwd);
    const display = displayPath(cwdAbs, effective);
    if (mode === "restricted") {
      const roots = await restrictedRoots(allowedPaths, cwdAbs);
      requireAllowed(effective, cwdAbs, roots, display);
    }
    return { effective, display };
  };

  return [
    {
      name: "read_file",
      description:
        "Read a text file and return its contents with line numbers. " +
        "Paths are relative to the working directory; anything outside it is refused. " +
        "Binary files are detected and reported instead of dumped. " +
        "Use offset and limit to page through large files instead of reading them whole.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path, relative to the working directory." },
          offset: { type: "integer", description: "1-based line number to start from (default 1)." },
          limit: { type: "integer", description: `Maximum lines to return (default ${READ_MAX_LINES}).` },
        },
        required: ["path"],
        additionalProperties: false,
      },
      execute: async (rawArgs, ctx) => {
        const args = rawArgs ?? {};
        const { effective, display } = await confineForTool(ctx, requirePath(args.path));
        return readTextFile(effective, display, optInt(args, "offset"), optInt(args, "limit"));
      },
    },
    {
      name: "write_file",
      description:
        "Create a file inside the working directory with the exact content provided, " +
        "overwriting it if it exists; parent directories are created as needed. " +
        "This modifies the filesystem: it is refused in plan mode.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path, relative to the working directory." },
          content: { type: "string", description: "Full content to write. An empty string creates an empty file." },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
      execute: async (rawArgs, ctx) => {
        const args = rawArgs ?? {};
        if (mode === "plan") {
          refuse("write_file", "plan mode is read-only. Present the change as a proposal in your reply; the user applies approved edits in a later turn.");
        }
        const { effective, display } = await confineForTool(ctx, requirePath(args.path));
        const content = requireString(args, "content");
        await withFsErrors(display, () => fs.mkdir(path.dirname(effective), { recursive: true }));
        await withFsErrors(display, () => fs.writeFile(effective, content, "utf8"));
        return `Wrote ${fmtBytes(Buffer.byteLength(content, "utf8"))} to ${display}.`;
      },
    },
    {
      name: "edit_file",
      description:
        "Replace an exact text passage in an existing file inside the working directory. " +
        "old_string must match the file content exactly, including whitespace and indentation, " +
        "and must appear exactly once unless replace_all is true; otherwise the edit is refused " +
        "and the file is left untouched. This modifies the filesystem: it is refused in plan mode.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path, relative to the working directory." },
          old_string: { type: "string", description: "Exact existing text to replace, including whitespace." },
          new_string: { type: "string", description: "Replacement text; an empty string deletes the passage." },
          replace_all: { type: "boolean", description: "Replace every occurrence instead of refusing on multiple matches (default false)." },
        },
        required: ["path", "old_string", "new_string"],
        additionalProperties: false,
      },
      execute: async (rawArgs, ctx) => {
        const args = rawArgs ?? {};
        if (mode === "plan") {
          refuse("edit_file", "plan mode is read-only. Present the change as a proposal in your reply; the user applies approved edits in a later turn.");
        }
        const { effective, display } = await confineForTool(ctx, requirePath(args.path));
        const oldString = requireString(args, "old_string");
        if (oldString === "") {
          throw new Error("edit_file: old_string must not be empty; use write_file to replace a whole file.");
        }
        const newString = requireString(args, "new_string");
        const replaceAll = optBool(args, "replace_all") === true;
        return editTextFile(effective, display, oldString, newString, replaceAll);
      },
    },
    {
      name: "list_dir",
      description:
        "List one directory level inside the working directory: subdirectories first (trailing /), " +
        "then files with sizes. Use it to explore the project structure before reading files.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory to list, relative to the working directory (default '.')." },
          include_hidden: { type: "boolean", description: "Also list dotfiles and dot-directories (default false)." },
        },
        additionalProperties: false,
      },
      execute: async (rawArgs, ctx) => {
        const args = rawArgs ?? {};
        const { effective, display } = await confineForTool(ctx, optString(args, "path") ?? ".");
        return listDirectory(effective, display, optBool(args, "include_hidden") === true);
      },
    },
    {
      name: "grep",
      description:
        "Search the contents of text files under a directory in the working directory with a " +
        "regular expression and return matching lines as path:line: text. Dependency, build and " +
        "VCS directories (node_modules, .git, dist, ...) are skipped, as are binary files and " +
        "symlinks. Use this to find where a symbol or string appears before reading files.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "JavaScript-style regular expression, matched per line." },
          path: { type: "string", description: "Directory or file to search, relative to the working directory (default '.')." },
          glob: { type: "string", description: "Only search files whose name matches this wildcard, e.g. '*.ts' or '*.test.*'." },
          ignore_case: { type: "boolean", description: "Case-insensitive matching (default false)." },
          include_hidden: { type: "boolean", description: "Also search dotfiles and dot-directories (default false)." },
        },
        required: ["pattern"],
        additionalProperties: false,
      },
      execute: async (rawArgs, ctx) => {
        const args = rawArgs ?? {};
        const { effective, display } = await confineForTool(ctx, optString(args, "path") ?? ".");
        const pattern = requireString(args, "pattern");
        if (pattern === "") throw new Error("grep: pattern must not be empty");
        let re: RegExp;
        try {
          re = new RegExp(pattern, optBool(args, "ignore_case") === true ? "i" : "");
        } catch (err) {
          throw new Error(`grep: invalid regular expression: ${(err as Error).message}`);
        }
        const glob = optString(args, "glob");
        const globRe = glob === undefined ? null : globToRegExp(glob);
        const cwdAbs = path.resolve(ctx.cwd);
        return runGrep(effective, display, cwdAbs, re, globRe, optBool(args, "include_hidden") === true, ctx.signal);
      },
    },
    {
      name: "shell",
      description:
        "Run a command through the system shell in the working directory and return the exit " +
        "status, stdout and stderr. There is a timeout and the command can be interrupted. " +
        "A command can read and modify anything the shell can reach, so it is refused in plan " +
        "mode and unavailable in restricted mode.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The command line to run." },
          timeout_secs: { type: "integer", description: `Kill the command after this many seconds (default ${SHELL_DEFAULT_TIMEOUT_SECS}, max ${SHELL_MAX_TIMEOUT_SECS}).` },
          cwd: { type: "string", description: "Directory to run in, relative to the working directory (default the working directory itself)." },
        },
        required: ["command"],
        additionalProperties: false,
      },
      execute: async (rawArgs, ctx) => {
        const args = rawArgs ?? {};
        if (mode === "plan") {
          refuse("shell", "plan mode is read-only. Inspect the project with read_file, list_dir or grep instead.");
        }
        if (mode === "restricted") {
          refuse("shell", "restricted mode confines file access to an allowlist, which an arbitrary shell command cannot honour.");
        }
        ensureLive(ctx.signal);
        const command = requireString(args, "command");
        if (command.trim() === "") throw new Error("shell: command must not be empty");
        const timeoutSecs = clampTimeout(optInt(args, "timeout_secs"));
        let shellCwd = ctx.cwd;
        const rawCwd = optString(args, "cwd");
        if (rawCwd !== undefined) {
          const { effective, display } = await confineForTool(ctx, rawCwd);
          const st = await withFsErrors(display, () => fs.stat(effective));
          if (!st.isDirectory()) throw new Error(`shell: ${display} is not a directory`);
          shellCwd = effective;
        }
        const startedAt = Date.now();
        const { outcome, stdout, stderr } = await runShell(command, shellCwd, ctx.signal, timeoutSecs * 1000);
        const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
        const status = outcome.timedOut
          ? `timed out after ${timeoutSecs}s; process killed`
          : outcome.signalName
            ? `killed by signal ${outcome.signalName}`
            : `exit code ${outcome.code ?? "unknown"}`;
        const head = `${status} (${secs}s)`;
        if (stdout === "" && stderr === "") return `${head}\n(no output)`;
        return capResult(`${head}\n--- stdout ---\n${stdout === "" ? "(empty)" : stdout}\n--- stderr ---\n${stderr === "" ? "(empty)" : stderr}`);
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Errors, argument and small formatting helpers
// ---------------------------------------------------------------------------

function ensureLive(signal: AbortSignal): void {
  if (signal.aborted) throw abortReason(signal);
}

function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error ? reason : new Error("Turn aborted");
}

function refuse(tool: string, why: string): never {
  throw new Error(`${tool} refused: ${why}`);
}

function requirePath(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Error("path is required and must be a non-empty string");
  }
  if (raw.includes("\0")) throw new Error("path contains a null byte");
  return raw;
}

function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (v === undefined || v === null) throw new Error(`${key} is required`);
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  throw new Error(`${key} must be a string`);
}

function optString(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  throw new Error(`${key} must be a string`);
}

function optInt(args: Record<string, unknown>, key: string): number | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isInteger(n)) throw new Error(`${key} must be an integer`);
  return n;
}

function optBool(args: Record<string, unknown>, key: string): boolean | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  throw new Error(`${key} must be a boolean`);
}

function clampTimeout(secs: number | undefined): number {
  if (secs === undefined) return SHELL_DEFAULT_TIMEOUT_SECS;
  return Math.min(Math.max(secs, 1), SHELL_MAX_TIMEOUT_SECS);
}

/** Run a filesystem operation, mapping common errno codes to plain messages. */
function withFsErrors<T>(display: string, op: () => Promise<T>): Promise<T> {
  return op().catch((err: unknown) => fsFail(err, display));
}

function fsFail(err: unknown, display: string): never {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  if (code === "ENOENT") throw new Error(`${display}: no such file or directory`);
  if (code === "EISDIR") throw new Error(`${display}: is a directory, not a file`);
  if (code === "ENOTDIR") throw new Error(`${display}: not a directory`);
  if (code === "EACCES" || code === "EPERM") throw new Error(`${display}: permission denied`);
  throw err;
}

function capResult(text: string): string {
  return text.length <= RESULT_CAP
    ? text
    : `${text.slice(0, RESULT_CAP)}\n[… result truncated, ${text.length - RESULT_CAP} more characters]`;
}

/** Path for display: cwd-relative when possible, absolute when it is not. */
function displayPath(cwdAbs: string, abs: string): string {
  const rel = path.relative(cwdAbs, abs);
  if (rel === "") return ".";
  return rel.startsWith("..") || path.isAbsolute(rel) ? abs : rel;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} bytes`;
  const units = ["K", "M", "G"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 100 ? Math.round(v) : Math.round(v * 10) / 10}${units[i]}`;
}

function looksBinary(buf: Buffer): boolean {
  const end = Math.min(buf.length, 8192);
  for (let i = 0; i < end; i += 1) {
    if (buf[i] === 0) return true;
  }
  return false;
}

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/** Minimal basename wildcard for grep's glob filter: * and ? only. */
function globToRegExp(glob: string): RegExp {
  const source = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${source}$`, "i");
}

// ---------------------------------------------------------------------------
// Path confinement
// ---------------------------------------------------------------------------

/** True when target equals root or lies beneath it, component-wise. */
function pathInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  if (rel === "") return true;
  if (path.isAbsolute(rel)) return false;
  return rel.split(path.sep)[0] !== "..";
}

function stripWinPrefix(p: string): string {
  if (process.platform !== "win32") return p;
  if (p.startsWith("\\\\?\\UNC\\")) return `\\\\${p.slice(8)}`;
  if (p.startsWith("\\\\?\\")) return p.slice(4);
  return p;
}

async function safeReal(p: string): Promise<string | null> {
  try {
    return stripWinPrefix(await fs.realpath(p));
  } catch {
    return null;
  }
}

/**
 * Resolve `requested` against cwd and return the path to actually touch:
 * lexically confined to cwd, then re-checked through realpath of the deepest
 * existing ancestor, so a symlink inside cwd cannot reach outside it.
 */
async function confine(cwd: string, requested: string): Promise<string> {
  const cwdAbs = path.resolve(cwd);
  const lexical = path.resolve(cwdAbs, requested);
  if (!pathInside(cwdAbs, lexical)) {
    throw new Error(`Refused: "${requested}" resolves outside the working directory.`);
  }
  const cwdReal = await safeReal(cwdAbs);
  let probe = lexical;
  const tail: string[] = [];
  for (let depth = 0; depth < 128; depth += 1) {
    const real = await safeReal(probe);
    if (real !== null) {
      const effective = tail.length > 0 ? path.join(real, ...tail) : real;
      if (cwdReal !== null && !pathInside(cwdReal, effective)) {
        throw new Error(`Refused: "${requested}" reaches outside the working directory through a symlink.`);
      }
      return effective;
    }
    const parent = path.dirname(probe);
    if (parent === probe) break;
    tail.unshift(path.basename(probe));
    probe = parent;
  }
  return lexical;
}

/** Restricted mode: normalize the allowlist against this turn's cwd. */
async function restrictedRoots(allowedPaths: string[], cwdAbs: string): Promise<string[] | null> {
  if (allowedPaths.length === 0) return null;
  return Promise.all(
    allowedPaths.map(async (p) => {
      const abs = path.resolve(cwdAbs, p);
      return (await safeReal(abs)) ?? path.normalize(abs);
    }),
  );
}

function requireAllowed(effective: string, cwdAbs: string, roots: string[] | null, display: string): void {
  if (roots === null) {
    throw new Error(
      "Refused: restricted mode is active but no allowlist (allowedPaths) was configured, " +
        "so no paths are accessible.",
    );
  }
  for (const root of roots) {
    if (pathInside(root, effective)) return;
  }
  throw new Error(
    `Refused: ${display} is outside the restricted allowlist ` +
      `(allowed: ${roots.map((r) => displayPath(cwdAbs, r)).join(", ")}).`,
  );
}

// ---------------------------------------------------------------------------
// Tool bodies
// ---------------------------------------------------------------------------

async function readTextFile(
  effective: string,
  display: string,
  offset: number | undefined,
  limit: number | undefined,
): Promise<string> {
  const full = await withFsErrors(display, () => fs.readFile(effective));
  if (looksBinary(full)) {
    return `${display} is a binary file (${fmtBytes(full.length)}); its bytes are not shown.`;
  }
  let buf = full;
  const notes: string[] = [];
  if (buf.length > READ_MAX_BYTES) {
    notes.push(`file is ${fmtBytes(buf.length)}; only the first ${fmtBytes(READ_MAX_BYTES)} bytes were read`);
    buf = buf.subarray(0, READ_MAX_BYTES);
  }
  const lines = buf.toString("utf8").split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const total = lines.length;
  const start = Math.max(1, offset ?? 1);
  if (start > total) {
    return `${display} has ${total} lines; offset ${start} is past the end.`;
  }
  const max = Math.max(1, limit ?? READ_MAX_LINES);
  const end = Math.min(total, start - 1 + max);
  const width = String(end).length;
  const body: string[] = [];
  for (let i = start - 1; i < end; i += 1) {
    body.push(`${String(i + 1).padStart(width)}\t${lines[i].replace(/\r$/, "")}`);
  }
  if (start > 1 || end < total) {
    notes.push(`[showing lines ${start}-${end} of ${total}${end < total ? "; pass a higher offset to continue" : ""}]`);
  }
  // Notes go first so capResult can never cut the one thing that tells the
  // model what it did not see.
  const header = notes.length > 0 ? `${notes.join("\n")}\n` : "";
  return capResult(`${header}${body.join("\n")}`);
}

async function editTextFile(
  effective: string,
  display: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
): Promise<string> {
  const buf = await withFsErrors(display, () => fs.readFile(effective));
  if (looksBinary(buf)) throw new Error(`${display} is a binary file; edit_file works on text only`);
  let content = buf.toString("utf8");
  let needle = oldString;
  let replacement = newString;
  // Models usually quote text as they saw it (LF); also match CRLF files.
  if (!content.includes(needle)) {
    if (content.includes("\r\n") && needle.includes("\n")) {
      const crlfNeedle = needle.replace(/\r?\n/g, "\r\n");
      if (content.includes(crlfNeedle)) {
        needle = crlfNeedle;
        replacement = newString.replace(/\r?\n/g, "\r\n");
      }
    } else if (!content.includes("\r") && needle.includes("\r\n")) {
      const lfNeedle = needle.replace(/\r\n/g, "\n");
      if (content.includes(lfNeedle)) {
        needle = lfNeedle;
        replacement = newString.replace(/\r\n/g, "\n");
      }
    }
  }
  const count = content.split(needle).length - 1;
  if (count === 0) {
    throw new Error(
      `edit_file: old_string does not appear in ${display}; re-read the file and copy the exact text, including whitespace.`,
    );
  }
  if (count > 1 && !replaceAll) {
    throw new Error(
      `edit_file refused: old_string matches ${count} locations in ${display}; ` +
        "include more surrounding text to make it unique, or pass replace_all: true.",
    );
  }
  // The replacer function avoids $-pattern expansion in new_string.
  const updated =
    count > 1 ? content.split(needle).join(replacement) : content.replace(needle, () => replacement);
  await withFsErrors(display, () => fs.writeFile(effective, updated, "utf8"));
  return `Replaced ${count === 1 ? "1 occurrence" : `${count} occurrences`} in ${display}.`;
}

async function listDirectory(effective: string, display: string, includeHidden: boolean): Promise<string> {
  const entries = await withFsErrors(display, () => fs.readdir(effective, { withFileTypes: true }));
  const visible = includeHidden ? entries : entries.filter((e) => !e.name.startsWith("."));
  const dirs = visible.filter((e) => e.isDirectory()).map((e) => e.name).sort(compareNames);
  const files = visible.filter((e) => !e.isDirectory()).map((e) => e.name).sort(compareNames);
  const total = dirs.length + files.length;
  if (total === 0) return `${display} is empty.`;
  const capped = total > LIST_MAX_ENTRIES;
  const shownDirs = capped ? dirs.slice(0, LIST_MAX_ENTRIES) : dirs;
  const shownFiles = capped ? files.slice(0, Math.max(0, LIST_MAX_ENTRIES - shownDirs.length)) : files;
  const lines = await Promise.all(
    shownFiles.map(async (name) => {
      const st = await fs.stat(path.join(effective, name)).catch(() => null);
      const size = st !== null && st.isFile() && st.size > 0 ? `  ${fmtBytes(st.size)}` : "";
      return `${name}${size}`;
    }),
  );
  const body = [...shownDirs.map((n) => `${n}/`), ...lines];
  if (capped) body.push(`[${total - body.length} more entries not shown]`);
  return capResult(body.join("\n"));
}

async function runGrep(
  target: string,
  display: string,
  cwdAbs: string,
  re: RegExp,
  globRe: RegExp | null,
  includeHidden: boolean,
  signal: AbortSignal,
): Promise<string> {
  const st = await withFsErrors(display, () => fs.stat(target));
  const files: string[] = [];
  if (st.isFile()) {
    files.push(target);
  } else if (st.isDirectory()) {
    await walkFiles(target, includeHidden, files, signal);
  } else {
    throw new Error(`${display} is neither a file nor a directory`);
  }
  if (files.length === 0) {
    return `No files to search under ${display} (dotfiles, dependencies and build directories are skipped).`;
  }

  const matches: string[] = [];
  let scanned = 0;
  let binarySkipped = 0;
  let sizeSkipped = 0;
  let filesMatched = 0;
  for (const file of files) {
    if (matches.length >= GREP_MAX_MATCHES) break;
    ensureLive(signal);
    scanned += 1;
    if (globRe !== null && !globRe.test(path.basename(file))) continue;
    const buf = await fs.readFile(file).catch(() => null);
    if (buf === null) continue;
    if (buf.length > GREP_MAX_FILE_BYTES) {
      sizeSkipped += 1;
      continue;
    }
    if (looksBinary(buf)) {
      binarySkipped += 1;
      continue;
    }
    const rel = displayPath(cwdAbs, file);
    const lines = buf.toString("utf8").split("\n");
    let fileMatched = false;
    for (let i = 0; i < lines.length && matches.length < GREP_MAX_MATCHES; i += 1) {
      if (re.test(lines[i])) {
        matches.push(`${rel}:${i + 1}: ${lines[i].replace(/\r$/, "").slice(0, GREP_LINE_SLICE)}`);
        fileMatched = true;
      }
    }
    if (fileMatched) filesMatched += 1;
  }

  const parts: string[] = [
    `${matches.length} matches in ${filesMatched} ${filesMatched === 1 ? "file" : "files"}`,
    `${scanned} files scanned`,
  ];
  if (matches.length >= GREP_MAX_MATCHES) parts.push(`stopped at the ${GREP_MAX_MATCHES}-match cap`);
  if (files.length >= GREP_MAX_FILES) parts.push(`hit the ${GREP_MAX_FILES}-file scan cap`);
  if (binarySkipped > 0) parts.push(`skipped ${binarySkipped} binary files`);
  if (sizeSkipped > 0) parts.push(`skipped ${sizeSkipped} files over ${fmtBytes(GREP_MAX_FILE_BYTES)}`);
  if (matches.length === 0) {
    return `No matches for /${re.source}/ under ${display} (${parts.join("; ")}).`;
  }
  // The summary is the header, so capResult can never cut it off.
  return capResult(`[${parts.join("; ")}]\n${matches.join("\n")}`);
}

async function walkFiles(root: string, includeHidden: boolean, out: string[], signal: AbortSignal): Promise<void> {
  const stack = [root];
  while (stack.length > 0 && out.length < GREP_MAX_FILES) {
    ensureLive(signal);
    const dir = stack.pop() as string;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null);
    if (entries === null) continue;
    for (const entry of entries) {
      if (out.length >= GREP_MAX_FILES) break;
      if (!includeHidden && entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!GREP_SKIP_DIRS.has(entry.name)) stack.push(full);
      } else if (entry.isFile()) {
        out.push(full);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// shell
// ---------------------------------------------------------------------------

interface ShellOutcome {
  code: number | null;
  signalName: string | null;
  timedOut: boolean;
}

/** Keep the head and the tail of a stream; drop the middle, count what went. */
class HeadTail {
  private head = "";
  private tail = "";
  private overflow = 0;

  push(chunk: string): void {
    if (this.head.length < SHELL_STREAM_KEEP) {
      const take = Math.min(chunk.length, SHELL_STREAM_KEEP - this.head.length);
      this.head += chunk.slice(0, take);
      chunk = chunk.slice(take);
    }
    if (chunk.length > 0) {
      this.overflow += chunk.length;
      this.tail = (this.tail + chunk).slice(-SHELL_STREAM_KEEP);
    }
  }

  render(): string {
    if (this.overflow === 0) return this.head;
    if (this.overflow <= this.tail.length) return this.head + this.tail;
    return `${this.head}\n[${this.overflow - this.tail.length} characters truncated]\n${this.tail}`;
  }
}

/**
 * Run `command` under a real shell and collect its streams. On Windows this
 * mirrors child_process.exec (cmd.exe /d /s /c with verbatim quoting); on
 * POSIX it is /bin/sh -c in its own process group so the whole tree can be
 * killed on timeout or abort.
 */
async function runShell(
  command: string,
  cwd: string,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<{ outcome: ShellOutcome; stdout: string; stderr: string }> {
  const env = { ...process.env, NO_COLOR: "1" };
  const child =
    process.platform === "win32"
      ? spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `"${command}"`], {
          cwd,
          env,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
          windowsVerbatimArguments: true,
        })
      : spawn("/bin/sh", ["-c", command], {
          cwd,
          env,
          stdio: ["ignore", "pipe", "pipe"],
          detached: true,
        });

  const out = new HeadTail();
  const err = new HeadTail();
  child.stdout?.on("data", (chunk: Buffer) => out.push(chunk.toString("utf8")));
  child.stderr?.on("data", (chunk: Buffer) => err.push(chunk.toString("utf8")));

  return new Promise((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    const onAbort = () => killTree(child);
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    };
    if (signal.aborted) killTree(child);
    else signal.addEventListener("abort", onAbort, { once: true });

    child.on("error", (err) => {
      finish();
      reject(new Error(`shell could not start: ${err.message}`));
    });
    child.on("close", (code, signalName) => {
      finish();
      if (signal.aborted) {
        reject(abortReason(signal));
        return;
      }
      resolve({ outcome: { code, signalName, timedOut }, stdout: out.render(), stderr: err.render() });
    });
  });
}

function killTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) {
    try { child.kill("SIGKILL"); } catch { /* already gone */ }
    return;
  }
  if (process.platform === "win32") {
    // /T takes the whole tree; cmd.exe wrappers survive a plain child.kill().
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" })
      .on("error", () => { /* best effort */ });
  } else {
    // detached: true gave the child its own process group; -pid targets it.
    try { process.kill(-pid, "SIGTERM"); } catch { /* group already gone */ }
    setTimeout(() => {
      try { process.kill(-pid, "SIGKILL"); } catch { /* already gone */ }
    }, 2_000);
  }
}
