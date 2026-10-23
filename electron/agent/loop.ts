/*
 * PURPOSE: Rcode's own agent loop — the AgentEngine implementation behind the
 * contract in engine.ts. It owns context assembly, retry rewinding,
 * compaction and the per-round request/response trace; provider.ts owns the
 * HTTP loop and stream parsing, tools.ts owns the tool surface, and
 * ipc/chat.ts owns persistence and renderer chunks.
 *
 * CONTEXT ASSEMBLY — every runTurn rebuilds the request's message list from
 * Rcode's own SQLite history (db/messages), so what the model sees always
 * matches what the user sees, including edits, version switches and branch
 * restores. Each assistant turn's structured events map to OpenAI chat
 * messages: response text becomes assistant content, tool_call/tool_result
 * pairs become one assistant message with tool_calls plus one tool message
 * per result (ids are synthesized per request — only the pairing matters).
 * Persisted reasoning is deliberately NOT replayed: DeepSeek-class providers
 * reject reasoning_content in requests and most proxies ignore it (see
 * provider.ts). A turn whose events are missing falls back to its plain
 * content, which keeps pre-turn-json history usable.
 *
 * RETRY ANCHORS — resetToAnchor arms a pending anchor for the session; the
 * next runTurn truncates the db history at the occurrence-th user message
 * carrying the anchor's exact text, so the regenerated turn sees only history
 * that legitimately precedes it. The abandoned answer and any later tail stay
 * out of the request even though ipc/chat.ts only archives them after the
 * rewind. The anchor is consumed by that one runTurn.
 *
 * COMPACTION — compact() asks the session's own provider to summarize the
 * current context and records the result in the settings store under
 * `compaction:<sessionId>` as { summary, excludedMessageIds }. Every later
 * context build swaps the excluded messages for the summary (injected as a
 * clearly-labelled user message), so compaction survives restarts without a
 * schema change. The db rows themselves are never touched: the transcript
 * stays whole, only the model's context shrinks.
 *
 * PROJECT DIRECTORY — tools run inside the session's project directory, never
 * the user's home. Resolution order: the `projectDir:<sessionId>` setting,
 * then the `projectDir` setting, then the backend process's working
 * directory. A configured directory that no longer exists fails the turn
 * loudly instead of silently running somewhere else.
 *
 * RESTRICTED ALLOWLIST — the `restrictedAllowedPaths:<sessionId>` setting, or
 * `restrictedAllowedPaths`, holds a JSON array of paths (relative to the
 * project directory, or absolute) that ipc/chat.ts hands to createTools for
 * restricted mode. Missing or unparseable means an empty list, which
 * tools.ts treats as fail-closed.
 *
 * TRACE — the loop logs the per-round `request` (the exact context the round
 * was sent, per-message content capped), `reasoning` and `response` entries
 * the Trajectory view renders. ipc/chat.ts logs turn_start, tool_call,
 * tool_result, content and turn_end; the two sets never overlap. Round
 * boundaries are the contract's assistant_end events: a round's request entry
 * is logged at its first delta (or at its end when a round streams nothing),
 * and the round's TTFT is measured from the last tool execution before it.
 */

import { statSync } from "node:fs";
import * as path from "node:path";

import { getMessages } from "../db/messages";
import { getProvider } from "../db/providers";
import { getSetting, getSettings, setSetting } from "../db/settings";
import { logTrace, readTrace } from "./trace";
import { ProviderError, runProviderTurn, type AssistantMessage, type ProviderMessage } from "./provider";
import type { AgentEngine, AnchorRequest, StreamEvent, TurnRequest } from "./engine";
import type { Message } from "../../src/types";

// ---------------------------------------------------------------------------
// Persisted settings keys
// ---------------------------------------------------------------------------

const PROJECT_DIR_KEY = "projectDir";
const ALLOWED_PATHS_KEY = "restrictedAllowedPaths";
const COMPACTION_KEY = "compaction";

const sessionKey = (key: string, sessionId: string) => `${key}:${sessionId}`;

/**
 * The directory the session's tools run in. Per-session setting, then the
 * global one, then the backend's own working directory. An explicitly
 * configured directory must exist — a silent fallback would run tools
 * somewhere the user did not point at.
 */
export function resolveProjectDir(sessionId: string): string {
  const perSession = getSetting(sessionKey(PROJECT_DIR_KEY, sessionId));
  if (perSession !== null) return validatedDir(perSession, sessionKey(PROJECT_DIR_KEY, sessionId));
  const global = getSetting(PROJECT_DIR_KEY);
  if (global !== null) return validatedDir(global, PROJECT_DIR_KEY);
  return process.cwd();
}

function validatedDir(raw: string, key: string): string {
  const trimmed = raw.trim();
  let ok = false;
  try {
    ok = statSync(path.resolve(trimmed)).isDirectory();
  } catch {
    ok = false;
  }
  if (!trimmed || !ok) {
    throw new Error(
      `Project directory setting "${key}" is "${trimmed}", which is not an accessible directory. ` +
        "Fix or clear it before starting a turn.",
    );
  }
  return path.resolve(trimmed);
}

/** Restricted-mode allowlist for the session, as tools.ts expects it. */
export function resolveRestrictedAllowedPaths(sessionId: string): string[] {
  const raw = getSetting(sessionKey(ALLOWED_PATHS_KEY, sessionId)) ?? getSetting(ALLOWED_PATHS_KEY);
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "");
}

// ---------------------------------------------------------------------------
// Compaction record
// ---------------------------------------------------------------------------

interface CompactionRecord {
  summary: string;
  /** ids of the db messages the summary replaces in the model's context. */
  excludedMessageIds: string[];
}

export function readCompactionRecord(sessionId: string): CompactionRecord | null {
  const raw = getSetting(sessionKey(COMPACTION_KEY, sessionId));
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CompactionRecord> | null;
    if (
      parsed &&
      typeof parsed.summary === "string" &&
      parsed.summary.trim() !== "" &&
      Array.isArray(parsed.excludedMessageIds)
    ) {
      return {
        summary: parsed.summary,
        excludedMessageIds: parsed.excludedMessageIds.filter((id): id is string => typeof id === "string"),
      };
    }
  } catch {
    // A corrupt record is treated as absent; the next compaction rewrites it.
  }
  return null;
}

function writeCompactionRecord(sessionId: string, record: CompactionRecord): void {
  setSetting(sessionKey(COMPACTION_KEY, sessionId), JSON.stringify(record));
}

function summaryMessage(summary: string): ProviderMessage {
  return {
    role: "user",
    content:
      "[Context summary] The earlier part of this conversation was compacted into the summary below. " +
      "Treat it as background, not as a new request.\n\n" +
      summary,
  };
}

// ---------------------------------------------------------------------------
// History → OpenAI chat messages
// ---------------------------------------------------------------------------

interface CallRef {
  id: string;
  name: string;
}

/** Pair a tool result with the earliest unpaired call of the same name. */
function takePendingCall<T extends CallRef>(pending: T[], name: string): T | undefined {
  const idx = pending.findIndex(call => call.name === name);
  return idx >= 0 ? pending.splice(idx, 1)[0] : pending.shift();
}

/**
 * Map persisted messages onto OpenAI chat messages. Assistant turns become
 * alternating assistant/tool messages following their event order; tool call
 * ids are synthesized because the persisted events do not carry them.
 */
function historyToProviderMessages(messages: Message[]): ProviderMessage[] {
  const out: ProviderMessage[] = [];
  let callSeq = 0;
  const newCallId = () => `call_hist_${++callSeq}`;

  for (const m of messages) {
    if (m.role !== "assistant") {
      out.push({ role: m.role, content: m.content });
      continue;
    }

    const events = m.turn?.events;
    if (!Array.isArray(events) || events.length === 0) {
      if (m.content.trim() !== "") out.push({ role: "assistant", content: m.content });
      continue;
    }

    let text = "";
    const calls: Array<CallRef & { args: string }> = [];
    const unanswered: CallRef[] = [];

    const flushAssistant = () => {
      if (text.trim() === "" && calls.length === 0) return;
      out.push({
        role: "assistant",
        content: text,
        ...(calls.length > 0
          ? {
              tool_calls: calls.map(call => ({
                id: call.id,
                type: "function" as const,
                function: { name: call.name, arguments: call.args },
              })),
            }
          : {}),
      });
      text = "";
      calls.length = 0;
    };

    for (const ev of events) {
      if (ev.kind === "response") {
        text += ev.text;
      } else if (ev.kind === "tool_call") {
        const call = { id: newCallId(), name: ev.name, args: ev.args ?? "" };
        calls.push(call);
        unanswered.push(call);
      } else if (ev.kind === "tool_result") {
        flushAssistant();
        const call = takePendingCall(unanswered, ev.name);
        if (call) out.push({ role: "tool", tool_call_id: call.id, content: ev.result ?? "" });
        // An orphan result (no call to answer) is skipped: providers reject
        // tool messages without a preceding tool_call.
      }
      // reasoning events are not replayed (see provider.ts).
    }
    flushAssistant();
    // A call whose result never persisted (an interrupted turn) still needs
    // its tool message, or the next request carries an unanswered tool_call.
    for (const call of unanswered) {
      out.push({ role: "tool", tool_call_id: call.id, content: "(no result recorded)" });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Context build
// ---------------------------------------------------------------------------

interface PendingAnchor {
  promptText: string;
  occurrence: number;
}

/** The pending anchors, keyed by session; consumed by the next runTurn. */
const pendingAnchors = new Map<string, PendingAnchor>();

/** Index of the occurrence-th user message with exactly this text, or -1. */
function findAnchorIndex(messages: Message[], promptText: string, occurrence: number): number {
  let seen = 0;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === "user" && m.content === promptText) {
      seen += 1;
      if (seen === occurrence) return i;
    }
  }
  return -1;
}

/**
 * The message list for one provider call: system prompt, compaction summary
 * (when one exists), the session's history, and the prompt. The prompt is
 * already persisted by the caller, so it is the last db message on every
 * normal path; it is appended only when that is not the case.
 */
function buildTurnMessages(
  sessionId: string,
  systemPrompt: string,
  promptText: string,
  anchor: PendingAnchor | null,
): ProviderMessage[] {
  const dbMessages = getMessages(sessionId);
  let scoped = dbMessages;
  if (anchor) {
    const idx = findAnchorIndex(dbMessages, anchor.promptText, anchor.occurrence);
    // Anchor not found (history changed between resetToAnchor and now):
    // fall back to the full history rather than dropping the retry.
    if (idx >= 0) scoped = dbMessages.slice(0, idx + 1);
  }

  const record = readCompactionRecord(sessionId);
  const excluded = record ? new Set(record.excludedMessageIds) : null;
  const context = excluded ? scoped.filter(m => !excluded.has(m.id)) : scoped;

  const messages: ProviderMessage[] = [];
  if (systemPrompt.trim() !== "") messages.push({ role: "system", content: systemPrompt });
  if (record) messages.push(summaryMessage(record.summary));
  messages.push(...historyToProviderMessages(context));

  const last = messages[messages.length - 1];
  if (!(last && last.role === "user" && last.content === promptText)) {
    messages.push({ role: "user", content: promptText });
  }
  return messages;
}

// ---------------------------------------------------------------------------
// Per-round trace entries
// ---------------------------------------------------------------------------

const TRACE_MESSAGE_CAP = 20_000;

function capTraceMessage(message: ProviderMessage): ProviderMessage {
  if (typeof message.content !== "string" || message.content.length <= TRACE_MESSAGE_CAP) return message;
  return {
    ...message,
    content:
      message.content.slice(0, TRACE_MESSAGE_CAP) +
      `…[trace truncated, ${message.content.length - TRACE_MESSAGE_CAP} more chars]`,
  };
}

/**
 * Logs the per-round request/reasoning/response entries from the event
 * stream. Rounds are delimited by assistant_end; the request entry for round
 * N mirrors exactly what provider.ts appends between rounds (assistant text +
 * tool_calls, then tool messages), so the logged context matches the real
 * request shape.
 */
class TurnTracer {
  private round = 1;
  private roundStartedAt = Date.now();
  private firstDeltaAt: number | null = null;
  private chunks = 0;
  private reasoningText = "";
  private responseText = "";
  private requestLogged = false;
  /** Messages from completed rounds, appended to every request entry. */
  private prior: ProviderMessage[] = [];
  /** Index in prior of the current round's assistant message, -1 if none yet. */
  private openIndex = -1;
  private unpaired: CallRef[] = [];
  private callSeq = 0;

  constructor(
    private readonly sessionId: string,
    private readonly turn: number,
    private readonly initialMessages: ProviderMessage[],
    private readonly toolNames: string[],
  ) {}

  observe(event: StreamEvent): void {
    switch (event.kind) {
      case "text":
      case "reasoning": {
        this.ensureRequestLogged();
        if (this.firstDeltaAt === null) this.firstDeltaAt = Date.now();
        this.chunks += 1;
        if (event.kind === "reasoning") this.reasoningText += event.delta;
        else this.responseText += event.delta;
        break;
      }
      case "assistant_end":
        this.finalizeRound();
        break;
      case "tool_start": {
        const spec = {
          id: `call_trace_${++this.callSeq}`,
          name: event.toolName,
          arguments: event.args,
        };
        if (this.openIndex >= 0) {
          const assistant = this.prior[this.openIndex] as AssistantMessage;
          (assistant.tool_calls ??= []).push({
            id: spec.id,
            type: "function",
            function: { name: spec.name, arguments: spec.arguments },
          });
        } else {
          this.openIndex = this.prior.length;
          this.prior.push({
            role: "assistant",
            content: "",
            tool_calls: [
              { id: spec.id, type: "function", function: { name: spec.name, arguments: spec.arguments } },
            ],
          });
        }
        this.unpaired.push({ id: spec.id, name: spec.name });
        break;
      }
      case "tool_end": {
        const call = takePendingCall(this.unpaired, event.toolName);
        this.prior.push({
          role: "tool",
          tool_call_id: call?.id ?? `call_trace_${++this.callSeq}`,
          content: event.result || "(no output)",
        });
        // The next round's HTTP call starts once tool execution is done.
        this.roundStartedAt = Date.now();
        break;
      }
      case "usage":
        break;
    }
  }

  private ensureRequestLogged(): void {
    if (this.requestLogged) return;
    this.requestLogged = true;
    logTrace(this.sessionId, {
      kind: "request",
      turn: this.turn,
      round: this.round,
      messages: [...this.initialMessages, ...this.prior].map(capTraceMessage),
      toolNames: this.toolNames,
    });
  }

  private finalizeRound(): void {
    this.ensureRequestLogged();
    if (this.reasoningText.trim() !== "") {
      logTrace(this.sessionId, {
        kind: "reasoning",
        turn: this.turn,
        round: this.round,
        text: this.reasoningText,
      });
    }
    logTrace(this.sessionId, {
      kind: "response",
      turn: this.turn,
      round: this.round,
      status: "ok",
      firstChunkMs: this.firstDeltaAt === null ? null : this.firstDeltaAt - this.roundStartedAt,
      totalMs: Date.now() - this.roundStartedAt,
      chunks: this.chunks,
    });
    // Mirror provider.ts's history append: the assistant message is always
    // kept when it requested tools, and kept on non-empty text otherwise.
    if (this.responseText.trim() !== "") {
      this.openIndex = this.prior.length;
      this.prior.push({ role: "assistant", content: this.responseText });
    } else {
      this.openIndex = -1;
    }
    this.round += 1;
    this.roundStartedAt = Date.now();
    this.firstDeltaAt = null;
    this.chunks = 0;
    this.reasoningText = "";
    this.responseText = "";
    this.requestLogged = false;
    this.unpaired = [];
  }
}

// ---------------------------------------------------------------------------
// Compaction
// ---------------------------------------------------------------------------

const COMPACTION_SYSTEM_PROMPT =
  "You are the context compactor for Rcode, a coding assistant. " +
  "You summarize a coding conversation so work can continue in a fresh context without losing anything that matters.";

const COMPACTION_INSTRUCTION =
  "Summarize the conversation above so work can continue with only your summary as context. Preserve, in order:\n" +
  "1. The user's goals, decisions and constraints, in their words where it matters.\n" +
  "2. Concrete state: files created or modified (with paths), key tool results, errors hit and their resolutions.\n" +
  "3. What remains to be done, and any open questions.\n" +
  "Write plain prose under 400 words. Output only the summary — no preamble, no commentary.";

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

export const rcodeEngine: AgentEngine = {
  async runTurn(request: TurnRequest): Promise<void> {
    const sid = request.sessionId;
    const armed = pendingAnchors.get(sid) ?? null;
    pendingAnchors.delete(sid);
    // An anchor only applies to the retry it was armed for; anything else
    // consumes it and runs on the full history.
    const anchor = armed && armed.promptText === request.promptText ? armed : null;

    const messages = buildTurnMessages(sid, request.systemPrompt, request.promptText, anchor);
    // chat.ts logs turn_start (with this same number) right before calling
    // runTurn, so the count of turn_start entries is this turn's number.
    const turn = readTrace(sid).filter(entry => entry.kind === "turn_start").length;
    const tracer = new TurnTracer(sid, turn, messages, request.tools.map(tool => tool.name));

    await runProviderTurn({
      baseUrl: request.baseUrl,
      apiKey: request.apiKey,
      modelId: request.modelId,
      messages,
      tools: request.tools,
      effort: request.effort,
      cwd: request.cwd || resolveProjectDir(sid),
      onEvent: event => {
        tracer.observe(event);
        request.onChunk(event);
      },
    });
  },

  async resetToAnchor(anchor: AnchorRequest): Promise<void> {
    pendingAnchors.set(anchor.sessionId, {
      promptText: anchor.promptText,
      occurrence: anchor.occurrence,
    });
  },

  async compact(sessionId: string): Promise<string> {
    const settings = getSettings();
    const providerRow = getProvider(settings.providerName);
    const baseUrl = providerRow?.baseUrl || settings.apiBase;
    const modelId = settings.model;
    if (!baseUrl || !modelId) {
      throw new ProviderError("No provider configured; compaction needs a working model.");
    }

    const dbMessages = getMessages(sessionId);
    if (dbMessages.length === 0) throw new ProviderError("Nothing to compact: the session has no messages.");

    const previous = readCompactionRecord(sessionId);
    const excluded = previous ? new Set(previous.excludedMessageIds) : null;
    const context = excluded ? dbMessages.filter(m => !excluded.has(m.id)) : dbMessages;
    const messages: ProviderMessage[] = [
      { role: "system", content: COMPACTION_SYSTEM_PROMPT },
      ...(previous ? [summaryMessage(previous.summary)] : []),
      ...historyToProviderMessages(context),
      { role: "user", content: COMPACTION_INSTRUCTION },
    ];

    let summary = "";
    await runProviderTurn({
      baseUrl,
      apiKey: providerRow?.apiKey || "",
      modelId,
      messages,
      tools: [],
      cwd: resolveProjectDir(sessionId),
      onEvent: event => {
        if (event.kind === "text") summary += event.delta;
      },
    });
    if (summary.trim() === "") throw new ProviderError("Compaction produced an empty summary.");

    writeCompactionRecord(sessionId, {
      summary: summary.trim(),
      excludedMessageIds: dbMessages.map(m => m.id),
    });
    return summary.trim();
  },
};
