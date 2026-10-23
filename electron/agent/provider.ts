/*
 * PURPOSE: The provider streaming client — the piece of Rcode's own agent that
 * speaks to a model. It POSTs to an OpenAI-compatible `/chat/completions`
 * endpoint with `stream: true`, parses the SSE stream, and maps provider
 * chunks onto the StreamEvent contract defined in engine.ts. Dependency-free:
 * global fetch plus a TextDecoder stream reader.
 *
 * This implements the `openai-completions` api_format, which every provider in
 * the registry uses (all providers are OpenAI-compatible /v1 proxies). The
 * caller routes on provider.apiFormat; other formats would live beside this.
 *
 * WHY THE DELTA HANDLING LOOKS THE WAY IT DOES (from the engine contract):
 *
 *   Providers fragment one assistant message across reasoning and text deltas
 *   in arbitrary order — one provider delivered `reasoning, "F", reasoning,
 *   "ORK-OK"`. Any consumer that treats the last fragment as the answer
 *   persists `ORK-OK` instead of `FORK-OK`. So each round ends with exactly
 *   one `assistant_end` carrying the canonical blocks: all reasoning
 *   concatenated into one `thinking` block, then all text into one `text`
 *   block. The consumer (ipc/chat.ts) replaces only the segment after the
 *   last tool result with them, repairing fragmented streams while leaving
 *   earlier tool history untouched.
 *
 *   Reasoning must be captured BEFORE the text it precedes. Within a single
 *   streamed chunk the same delta can carry both fields in either order, so
 *   the reasoning delta is emitted first whenever a chunk contains both.
 *   Cross-chunk interleaving is left as the provider sent it; the canonical
 *   `assistant_end` is what repairs that.
 *
 *   Tool calls stream as indexed argument fragments. Fragments are
 *   accumulated per index across chunks and each call is emitted exactly
 *   ONCE — as `tool_start` with its complete argument string — when the
 *   assistant message completes. `tool_end` follows once the tool's result
 *   is back. `assistant_end` is emitted BEFORE the round's `tool_start`
 *   events: the consumer's reconcile replaces everything after the last
 *   tool result, so tool events must not precede the message they belong to.
 *
 * LAYERS:
 *
 *   streamAssistantRound — one HTTP round: POST, SSE parse, delta mapping,
 *     usage, `assistant_end`, then a terminal `round_complete` carrying the
 *     completed tool calls. Reusable directly for plain calls without tools
 *     (compaction summarization).
 *
 *   streamProviderTurn — the tool loop for one turn: runs rounds, executes
 *     tools between them through EngineTool.execute, yields
 *     `tool_start`/`tool_end`, appends assistant/tool messages, and finishes
 *     with a `turn_complete` event carrying the result (also reachable via
 *     manual iteration).
 *
 *   runProviderTurn — callback-shaped convenience over streamProviderTurn
 *     matching TurnRequest.onChunk.
 *
 * DECISIONS:
 *
 *   - `stream_options: { include_usage: true }` is requested so standards-
 *     compliant providers return usage; usage is emitted ONCE per round
 *     (the last value seen) because consumers accumulate across rounds. If a
 *     provider rejects the field with a 400, the request is retried once
 *     without it.
 *   - Assistant reasoning is NOT replayed into follow-up rounds' history by
 *     default (DeepSeek rejects `reasoning_content` in requests; most proxies
 *     ignore it). `includeReasoningInHistory` opts back in.
 *   - The `tools` key is omitted entirely when the tool list is empty — some
 *     proxies 400 on `tools: []`.
 *   - Errors are surfaced, never swallowed: HTTP error bodies become
 *     ProviderError with status and capped body; in-stream `{"error": ...}`
 *     chunks abort the round; a connection that dies without [DONE] and
 *     without a finish_reason marks the round `incomplete` instead of
 *     discarding what streamed. Abort via the AbortSignal becomes
 *     ProviderAbortedError so callers can tell cancellation from failure.
 *   - A provider that ignores `stream: true` and answers with plain JSON is
 *     handled through the same chunk machinery.
 */

import type { AssistantBlock, EngineTool, EngineUsage, StreamEvent, ToolContext } from "./engine";

/** A tool call the model asked for, with its complete argument string. */
export interface CompletedToolCall {
  id: string;
  name: string;
  /** Raw JSON text of the arguments, exactly as the model streamed them. */
  args: string;
}

/** One `function` tool call as it appears in an assistant message. */
export interface ProviderToolCallSpec {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface AssistantMessage {
  role: "assistant";
  content: string;
  /** Only sent back to the provider when includeReasoningInHistory is set. */
  reasoning_content?: string;
  tool_calls?: ProviderToolCallSpec[];
}

/** OpenAI-compatible chat message, as sent to /chat/completions. */
export type ProviderMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | AssistantMessage
  | { role: "tool"; tool_call_id: string; content: string };

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** A provider failure the caller can show. HTTP errors carry status + body. */
export class ProviderError extends Error {
  /** HTTP status, when the failure came from a response. */
  status?: number;
  /** Raw response body (capped), when one was available. */
  body?: string;

  constructor(message: string, opts?: { status?: number; body?: string }) {
    super(message);
    this.name = "ProviderError";
    if (opts) {
      this.status = opts.status;
      this.body = opts.body;
    }
  }
}

/** The turn was cancelled through its AbortSignal, as opposed to failing. */
export class ProviderAbortedError extends ProviderError {
  constructor(message = "Turn cancelled") {
    super(message);
    this.name = "ProviderAbortedError";
  }
}

// ---------------------------------------------------------------------------
// One streamed round
// ---------------------------------------------------------------------------

export interface RoundOptions {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  /** Full message list for this round, in OpenAI chat format. */
  messages: ProviderMessage[];
  /** Tools offered to the model. Omitted from the request when empty. */
  tools?: EngineTool[];
  signal?: AbortSignal;
  /** Passed through as `reasoning_effort` when set. */
  effort?: string;
}

/**
 * Events of one round: the engine's text/reasoning/usage/assistant_end events,
 * plus a terminal `round_complete` with everything the tool loop needs to act.
 */
export type ProviderStreamEvent =
  | StreamEvent
  | {
      kind: "round_complete";
      toolCalls: CompletedToolCall[];
      finishReason: string | null;
      /** True when the stream died without [DONE] and without a finish_reason. */
      incomplete: boolean;
    };

/**
 * POST one streaming chat completion and map it onto StreamEvents. Yields
 * text/reasoning deltas as they arrive (reasoning before text within a chunk),
 * exactly one `assistant_end` with the canonical blocks, the round's usage
 * once, and a terminal `round_complete`.
 */
export async function* streamAssistantRound(options: RoundOptions): AsyncGenerator<ProviderStreamEvent, void, void> {
  const state = new RoundState();
  const res = await postCompletion(options, true);
  try {
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      // The provider ignored stream:true and answered with a single JSON body.
      yield* ingestCompletionBody(state, await res.text());
    } else {
      yield* consumeSseStream(res, state);
    }
  } catch (e) {
    if (options.signal?.aborted) throw new ProviderAbortedError();
    if (e instanceof ProviderError) throw e;
    throw new ProviderError(`Provider stream failed: ${errorMessage(e)}`);
  } finally {
    // Release the socket on every exit path, including early consumer exit.
    try {
      await res.body?.cancel();
    } catch {
      // Best effort only; the SSE reader has usually cancelled already.
    }
  }

  yield { kind: "assistant_end", blocks: canonicalBlocks(state) };
  if (state.lastUsage) yield { kind: "usage", usage: state.lastUsage };
  yield {
    kind: "round_complete",
    toolCalls: state.completedCalls(),
    finishReason: state.finishReason,
    incomplete: !state.sawDone && !state.sawFinish,
  };
}

/**
 * Consume one SSE response body. Handles event boundaries split across TCP
 * chunks, CRLF endings, keep-alive comments, the [DONE] sentinel, and a final
 * event without its trailing blank line. If no SSE event ever parses, the
 * captured raw body is re-ingested as a plain JSON completion so its real
 * shape — an error page, an error object, a non-streaming completion —
 * surfaces instead of a silent empty round.
 */
async function* consumeSseStream(res: Response, state: RoundState): AsyncGenerator<ContentDelta> {
  const body = res.body;
  if (!body) throw new ProviderError("Provider returned a response with no body");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let raw = ""; // capped copy, used only if no SSE event ever parses
  let dataLines: string[] = [];
  let dataEvents = 0;
  try {
    readLoop: for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        const tail = decoder.decode();
        if (tail) buffer += tail;
        // A final line without its trailing newline still counts as a line.
        if (buffer) buffer += "\n";
      } else {
        const piece = decoder.decode(value, { stream: true });
        if (raw.length < RAW_CAPTURE_CAP) raw += piece.slice(0, RAW_CAPTURE_CAP - raw.length);
        buffer += piece;
      }
      // Split into complete SSE lines; keep any partial line in the buffer.
      let nl = buffer.indexOf("\n");
      while (nl >= 0) {
        let line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line === "") {
          // Blank line = event boundary; dispatch accumulated data lines.
          const payload = dataLines.join("\n");
          dataLines = [];
          if (payload) {
            const handled = handleData(state, payload);
            if (handled.done) {
              state.sawDone = true;
              break readLoop;
            }
            if (handled.parsed) dataEvents++;
            for (const delta of handled.deltas) yield delta;
          }
        } else if (line.startsWith(":")) {
          // SSE comment / keep-alive.
        } else if (line.startsWith("data:")) {
          let data = line.slice(5);
          if (data.startsWith(" ")) data = data.slice(1);
          dataLines.push(data);
        }
        // `event:`, `id:`, `retry:` and anything else is irrelevant here.
        nl = buffer.indexOf("\n");
      }
      if (buffer.length > SSE_BUFFER_CAP) {
        throw new ProviderError("Provider stream sent an oversized line without a newline");
      }
      if (state.sawDone || done) break;
    }
    // A final event may lack its trailing blank line.
    if (!state.sawDone && dataLines.length > 0) {
      const handled = handleData(state, dataLines.join("\n"));
      dataLines = [];
      if (handled.parsed) dataEvents++;
      for (const delta of handled.deltas) yield delta;
    }
    if (dataEvents === 0) {
      for (const delta of ingestCompletionBody(state, raw)) yield delta;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Best effort only.
    }
  }
}

// ---------------------------------------------------------------------------
// The tool loop for one turn
// ---------------------------------------------------------------------------

export const DEFAULT_MAX_ROUNDS = 32;

export interface ProviderTurnOptions extends RoundOptions {
  /** Working directory handed to tool executions. */
  cwd: string;
  /** Safety cap on model rounds. Default DEFAULT_MAX_ROUNDS. */
  maxRounds?: number;
  /**
   * Replay assistant reasoning_content into follow-up rounds' history. Off by
   * default: DeepSeek rejects reasoning_content in requests, and most
   * OpenAI-compatible proxies ignore it.
   */
  includeReasoningInHistory?: boolean;
}

export interface ProviderTurnResult {
  /** Assistant + tool messages produced by this turn, in order. */
  newMessages: ProviderMessage[];
  /** Token usage accumulated across every round. */
  usage: EngineUsage;
  /** finish_reason of the last round. */
  finishReason: string | null;
  rounds: number;
}

export type TurnStreamEvent =
  | StreamEvent
  | { kind: "turn_complete"; result: ProviderTurnResult };

/**
 * Run the full tool loop for one turn as a stream of StreamEvents. Each round
 * streams one assistant message; when it requests tools, `assistant_end` comes
 * first, then `tool_start` with complete args and `tool_end` with the result
 * of executing it, then the next round begins with the tool results appended.
 */
export async function* streamProviderTurn(options: ProviderTurnOptions): AsyncGenerator<TurnStreamEvent, void, void> {
  const byName = new Map((options.tools ?? []).map(tool => [tool.name, tool]));
  const messages = [...options.messages];
  const newMessages: ProviderMessage[] = [];
  const usage: EngineUsage = { input: 0, output: 0 };
  const maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const ctx: ToolContext = {
    signal: options.signal ?? new AbortController().signal,
    cwd: options.cwd,
  };
  let finishReason: string | null = null;
  let round = 0;

  for (;;) {
    if (options.signal?.aborted) throw new ProviderAbortedError();
    round++;
    if (round > maxRounds) {
      throw new ProviderError(`Tool loop did not settle within ${maxRounds} rounds`);
    }

    let blocks: AssistantBlock[] = [];
    let calls: CompletedToolCall[] = [];
    for await (const event of streamAssistantRound({ ...options, messages })) {
      if (event.kind === "assistant_end") {
        blocks = event.blocks;
        yield event;
      } else if (event.kind === "round_complete") {
        calls = event.toolCalls;
        finishReason = event.finishReason;
      } else if (event.kind === "usage") {
        usage.input += event.usage.input;
        usage.output += event.usage.output;
        yield event;
      } else if (event.kind === "text" || event.kind === "reasoning") {
        yield event;
      }
    }

    const text = blocks.find(block => block.type === "text")?.text ?? "";
    const thinking = blocks.find(block => block.type === "thinking")?.text ?? "";

    if (calls.length === 0) {
      if (text.trim()) {
        const assistant: AssistantMessage = { role: "assistant", content: text };
        messages.push(assistant);
        newMessages.push(assistant);
      }
      yield { kind: "turn_complete", result: { newMessages, usage, finishReason, rounds: round } };
      return;
    }

    const assistant: AssistantMessage = {
      role: "assistant",
      content: text,
      ...(options.includeReasoningInHistory && thinking ? { reasoning_content: thinking } : {}),
      tool_calls: calls.map(call => ({
        id: call.id,
        type: "function" as const,
        function: { name: call.name, arguments: call.args },
      })),
    };
    messages.push(assistant);
    newMessages.push(assistant);

    for (const call of calls) {
      if (options.signal?.aborted) throw new ProviderAbortedError();
      yield { kind: "tool_start", toolName: call.name, args: call.args };
      const outcome = await runTool(call, byName.get(call.name), ctx);
      yield { kind: "tool_end", toolName: call.name, result: outcome.text, isError: outcome.isError };
      const toolMessage: ProviderMessage = {
        role: "tool",
        tool_call_id: call.id,
        content: outcome.text || "(no output)",
      };
      messages.push(toolMessage);
      newMessages.push(toolMessage);
    }
  }
}

/** Callback-shaped convenience over streamProviderTurn, matching onChunk. */
export async function runProviderTurn(
  options: ProviderTurnOptions & { onEvent: (event: StreamEvent) => void },
): Promise<ProviderTurnResult> {
  let result: ProviderTurnResult | undefined;
  for await (const event of streamProviderTurn(options)) {
    if (event.kind === "turn_complete") result = event.result;
    else options.onEvent(event);
  }
  if (!result) throw new ProviderError("Provider turn ended without a result");
  return result;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

type ContentDelta = Extract<StreamEvent, { kind: "text" } | { kind: "reasoning" }>;

interface ToolAccumulator {
  id: string;
  name: string;
  args: string;
}

const RAW_CAPTURE_CAP = 2_000_000;
const SSE_BUFFER_CAP = 8_000_000;
const ERROR_BODY_CAP = 4096;

class RoundState {
  readonly reasoning: string[] = [];
  readonly text: string[] = [];
  readonly toolCalls = new Map<number, ToolAccumulator>();
  nextToolIndex = 0;
  lastToolIndex: number | null = null;
  lastUsage: EngineUsage | null = null;
  finishReason: string | null = null;
  sawFinish = false;
  sawDone = false;

  completedCalls(): CompletedToolCall[] {
    return [...this.toolCalls.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([key, call]) => ({ id: call.id || `tool_call_synthetic_${key}`, name: call.name, args: call.args }));
  }
}

/**
 * Ingest one SSE data payload. Returns whether it was the [DONE] sentinel,
 * whether a chunk actually parsed (for the empty-stream fallback), and the
 * content deltas to yield — reasoning first when the chunk carried both.
 */
function handleData(
  state: RoundState,
  payload: string,
): { done: boolean; parsed: boolean; deltas: ContentDelta[] } {
  const trimmed = payload.trim();
  if (trimmed === "[DONE]") return { done: true, parsed: false, deltas: [] };
  const chunk = parseJsonLoose(trimmed);
  if (!chunk) return { done: false, parsed: false, deltas: [] };
  return { done: false, parsed: true, deltas: ingestChunk(state, chunk) };
}

/**
 * Map one provider chunk onto state + deltas. When the chunk contains both
 * reasoning and text, the reasoning delta is emitted first regardless of the
 * order the fields appeared in — reasoning must be captured before the text
 * it precedes. Tool call fragments are only accumulated here; they are
 * emitted once, complete, at round end.
 */
function ingestChunk(state: RoundState, chunk: Record<string, unknown>): ContentDelta[] {
  if (chunk.error !== undefined && chunk.error !== null) throw wireError(chunk.error);
  const deltas: ContentDelta[] = [];
  const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
  const choice =
    choices.find(entry => isRecord(entry) && entry.index === 0) ?? (isRecord(choices[0]) ? choices[0] : undefined);
  if (choice) {
    const delta = isRecord(choice.delta) ? choice.delta : isRecord(choice.message) ? choice.message : {};
    const parts = deltaParts(delta);
    if (parts.reasoning) {
      state.reasoning.push(parts.reasoning);
      deltas.push({ kind: "reasoning", delta: parts.reasoning });
    }
    if (parts.text) {
      state.text.push(parts.text);
      deltas.push({ kind: "text", delta: parts.text });
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const fragment of delta.tool_calls) addToolFragment(state, fragment);
    }
    if (typeof choice.finish_reason === "string" && choice.finish_reason) {
      state.finishReason = choice.finish_reason;
      state.sawFinish = true;
    }
  }
  if (isRecord(chunk.usage) && chunk.usage !== null) state.lastUsage = normalizeUsage(chunk.usage);
  return deltas;
}

/**
 * Extract the chunk's reasoning and text, including the field-name variants
 * providers actually use (`reasoning_content`, `reasoning`) and block-array
 * content shapes some proxies emit. Fragments within the chunk are merged —
 * fragmentation is only meaningful across chunks.
 */
function deltaParts(delta: Record<string, unknown>): { reasoning: string; text: string } {
  const reasoning: string[] = [];
  const text: string[] = [];
  const addReasoning = (value: unknown) => {
    const piece = plainText(value);
    if (piece) reasoning.push(piece);
  };
  const addText = (value: unknown) => {
    const piece = plainText(value);
    if (piece) text.push(piece);
  };
  addReasoning(delta.reasoning_content);
  addReasoning(delta.reasoning);
  const content = delta.content;
  if (typeof content === "string") {
    addText(content);
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (!isRecord(block)) continue;
      if (block.type === "thinking" || block.type === "reasoning") {
        addReasoning(block.thinking ?? block.text ?? block.reasoning);
      } else {
        addText(block.text);
      }
    }
  } else {
    addText(delta.text); // legacy field some proxies still emit
  }
  return { reasoning: reasoning.join(""), text: text.join("") };
}

/**
 * Accumulate one streamed tool-call fragment. Calls are keyed by their
 * declared `index`; when a fragment carries no index, its `id` identifies the
 * call, and a fragment with neither continues the most recent call. Argument
 * fragments append verbatim so a call split across chunks reassembles whole.
 */
function addToolFragment(state: RoundState, raw: unknown): void {
  if (!isRecord(raw)) return;
  const fn = isRecord(raw.function) ? raw.function : {};
  const id = typeof raw.id === "string" ? raw.id : "";
  const name = typeof fn.name === "string" ? fn.name : "";

  let key: number;
  const index =
    typeof raw.index === "number"
      ? raw.index
      : typeof raw.index === "string" && raw.index.trim() !== "" && Number.isFinite(Number(raw.index))
        ? Number(raw.index)
        : null;
  if (index !== null) {
    key = index;
  } else if (id) {
    const existing = [...state.toolCalls.entries()].find(([, call]) => call.id === id);
    key = existing ? existing[0] : state.nextToolIndex++;
  } else {
    key = state.lastToolIndex ?? state.nextToolIndex++;
  }
  state.lastToolIndex = key;

  let call = state.toolCalls.get(key);
  if (!call) {
    call = { id: "", name: "", args: "" };
    state.toolCalls.set(key, call);
  }
  if (id && !call.id) call.id = id;
  if (name && !call.name) call.name = name;
  const args = fn.arguments;
  if (typeof args === "string") call.args += args;
  else if (isRecord(args) || Array.isArray(args)) call.args += JSON.stringify(args);
}

/** Canonical blocks for the completed message: thinking, then text. */
function canonicalBlocks(state: RoundState): AssistantBlock[] {
  const blocks: AssistantBlock[] = [];
  const reasoning = state.reasoning.join("");
  const text = state.text.join("");
  if (reasoning.trim()) blocks.push({ type: "thinking", text: reasoning });
  if (text.trim()) blocks.push({ type: "text", text });
  return blocks;
}

/**
 * Ingest a non-streaming JSON completion body through the same chunk
 * machinery. Anything that is not a completion — empty body, an error object,
 * an HTML page — becomes a ProviderError instead of a silent empty round.
 */
function ingestCompletionBody(state: RoundState, body: string): ContentDelta[] {
  const trimmed = body.trim();
  if (!trimmed) throw new ProviderError("Provider returned an empty response body");
  let parsed: Record<string, unknown> | undefined;
  try {
    const value: unknown = JSON.parse(trimmed);
    parsed = isRecord(value) ? value : undefined;
  } catch {
    throw new ProviderError(`Provider returned invalid JSON instead of a completion: ${snippet(trimmed)}`);
  }
  if (!parsed) throw new ProviderError(`Unrecognized provider response: ${snippet(trimmed)}`);
  if (parsed.error !== undefined && parsed.error !== null) throw wireError(parsed.error);
  if (!Array.isArray(parsed.choices)) {
    throw new ProviderError(`Unrecognized provider response: ${snippet(trimmed)}`);
  }
  return ingestChunk(state, { choices: parsed.choices, usage: parsed.usage });
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

async function postCompletion(options: RoundOptions, includeUsage: boolean): Promise<Response> {
  const url = `${options.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.apiKey) headers.Authorization = `Bearer ${options.apiKey}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(buildPayload(options, includeUsage)),
      signal: options.signal,
    });
  } catch (e) {
    if (options.signal?.aborted) throw new ProviderAbortedError();
    throw new ProviderError(`Could not reach the provider at ${url}: ${errorMessage(e)}`);
  }
  if (!res.ok) {
    const body = await readCapped(res, ERROR_BODY_CAP);
    // Providers that predate stream_options reject it with a 400; retry once
    // without it rather than failing the turn over a usage nicety.
    if (res.status === 400 && includeUsage && body.includes("stream_options")) {
      return postCompletion(options, false);
    }
    const detail = extractErrorMessage(body) ?? snippet(body);
    throw new ProviderError(`Provider request failed (HTTP ${res.status}): ${detail}`, {
      status: res.status,
      body,
    });
  }
  return res;
}

function buildPayload(options: RoundOptions, includeUsage: boolean): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    model: options.modelId,
    messages: options.messages,
    stream: true,
  };
  if (includeUsage) payload.stream_options = { include_usage: true };
  const tools = options.tools ?? [];
  if (tools.length > 0) {
    payload.tools = tools.map(tool => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
    payload.tool_choice = "auto";
  }
  if (options.effort) payload.reasoning_effort = options.effort;
  return payload;
}

async function readCapped(res: Response, cap: number): Promise<string> {
  const text = await res.text().catch(() => "");
  return text.length > cap ? text.slice(0, cap) + "…[truncated]" : text;
}

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

async function runTool(
  call: CompletedToolCall,
  tool: EngineTool | undefined,
  ctx: ToolContext,
): Promise<{ text: string; isError: boolean }> {
  if (!tool) return { text: `Unknown tool: ${call.name || "(unnamed)"}`, isError: true };
  const raw = call.args.trim();
  let args: Record<string, unknown> = {};
  if (raw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return { text: `Invalid arguments for ${call.name}: ${errorMessage(e)}`, isError: true };
    }
    if (!isRecord(parsed)) {
      return { text: `Invalid arguments for ${call.name}: expected a JSON object`, isError: true };
    }
    args = parsed;
  }
  try {
    return { text: stringifyResult(await tool.execute(args, ctx)), isError: false };
  } catch (e) {
    return { text: `${call.name} failed: ${errorMessage(e)}`, isError: true };
  }
}

/**
 * Tool arguments and results are serialized to strings so the persisted turn
 * and the trace stay plain text regardless of what a tool returns.
 */
function stringifyResult(result: unknown): string {
  if (typeof result === "string") return result;
  if (result === undefined) return "(no result)";
  try {
    return JSON.stringify(result) ?? String(result);
  } catch {
    return String(result);
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function plainText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(entry => (typeof entry === "string" ? entry : "")).join("");
  return "";
}

function parseJsonLoose(text: string): Record<string, unknown> | undefined {
  if (!text.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function normalizeUsage(usage: Record<string, unknown>): EngineUsage {
  return {
    input: countTokens(usage.prompt_tokens) ?? countTokens(usage.input_tokens) ?? 0,
    output: countTokens(usage.completion_tokens) ?? countTokens(usage.output_tokens) ?? 0,
  };
}

function countTokens(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function wireError(err: unknown): ProviderError {
  let message = "";
  if (typeof err === "string") message = err;
  else if (isRecord(err)) {
    if (typeof err.error === "string") message = err.error;
    else if (isRecord(err.error)) message = firstString(err.error.message, err.error.code) ?? "";
    if (!message) message = firstString(err.message, err.detail, err.code) ?? "";
  }
  return new ProviderError(message ? `Provider error: ${message}` : "Provider returned an unspecified error");
}

function extractErrorMessage(body: string): string | null {
  const parsed = parseJsonLoose(body);
  if (!parsed) return null;
  if (typeof parsed.error === "string") return parsed.error;
  if (isRecord(parsed.error)) return firstString(parsed.error.message, parsed.error.code) ?? null;
  return firstString(parsed.message, parsed.detail) ?? null;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}

function snippet(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "(empty body)";
  return trimmed.length > 400 ? trimmed.slice(0, 400) + "…[truncated]" : trimmed;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
