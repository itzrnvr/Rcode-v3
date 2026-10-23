/*
 * PURPOSE: The contract Rcode's own agent loop must satisfy.
 *
 * Rcode used to drive `pi-coding-agent` as an out-of-process backend. That is
 * gone. Rcode now owns its agent: the tool loop, context assembly, compaction
 * and stream parsing all live in this repo, because the experiment and model
 * work this project exists for requires exact control over the request shape
 * and a harness that does not change underneath a running evaluation.
 *
 * This file is the seam. It defines only what `ipc/chat.ts` consumes; the
 * implementation is `rcodeEngine` in `agent/loop.ts`.
 *
 * WHAT MOVED HERE FROM THE DELETED PI BACKEND, AND WHY IT IS NOT PI-SPECIFIC:
 *
 *   AssistantBlock / assistant_end — providers fragment a single assistant
 *   message across reasoning and text deltas in arbitrary order. One provider
 *   previously delivered `reasoning, "F", reasoning, "ORK-OK"`, and any
 *   consumer that treats the last fragment as the answer persists `ORK-OK`
 *   instead of `FORK-OK`. An engine MUST emit one `assistant_end` per completed
 *   assistant message carrying the canonical blocks, in final order. The
 *   consumer replaces only the segment after the last tool result with them,
 *   leaving earlier tool history untouched. This is a general property of
 *   OpenAI-compatible streaming, not a property of any one backend.
 *
 *   StreamEvent ordering — `reasoning` deltas must be captured before the
 *   response text they precede. Same-chunk text/reasoning pairs arriving in
 *   the wrong order need reordering at capture time.
 *
 *   resetToAnchor — retry must resume from legitimate history before the
 *   anchor user message and must not carry the abandoned answer or any later
 *   tail. An Rcode-native engine owns its context, so it reconstructs the
 *   message list from Rcode's `turn_versions` rather than branching an
 *   external session tree.
 *
 *   Tool arguments and results are serialized to strings by the engine, so the
 *   persisted turn and the trace stay plain text regardless of what a tool
 *   returns.
 */

import { rcodeEngine } from "./loop";

/** A canonical block from one completed assistant message. */
export interface AssistantBlock {
  type: "thinking" | "text";
  text: string;
}

/** Token accounting for one turn. */
export interface EngineUsage {
  input: number;
  output: number;
}

/**
 * Ordered, incremental stream events for a single turn.
 *
 * `tool_start` precedes `tool_end` for the same call. `usage` may arrive at
 * any point and accumulates across the turn. Exactly one `assistant_end` is
 * emitted per completed assistant message.
 */
export type StreamEvent =
  | { kind: "text"; delta: string }
  | { kind: "reasoning"; delta: string }
  | { kind: "tool_start"; toolName: string; args: string }
  | { kind: "tool_end"; toolName: string; result: string; isError: boolean }
  | { kind: "usage"; usage: EngineUsage }
  | { kind: "assistant_end"; blocks: AssistantBlock[] };

/** A tool the loop may call. Rcode owns these definitions. */
export interface EngineTool {
  name: string;
  description: string;
  /** JSON Schema for the tool's parameters. */
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

export interface ToolContext {
  signal: AbortSignal;
  cwd: string;
}

/** Everything an engine needs to run one turn. */
export interface TurnRequest {
  sessionId: string;
  /** The prompt for this turn, already persisted by the caller. */
  promptText: string;
  providerId: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  /** Model ids available for the provider, for routing and fallback. */
  modelList: string[];
  cwd: string;
  systemPrompt: string;
  /** Composer access mode: gates which tools the loop may call. */
  mode: string;
  effort?: string;
  /** Tool surface available to the loop for this turn. */
  tools: EngineTool[];
  onChunk: (event: StreamEvent) => void;
}

/** Retry anchor: the user message to regenerate from. */
export interface AnchorRequest {
  sessionId: string;
  /** Full text of the anchor user message. */
  promptText: string;
  /**
   * Ordinal of the anchor among user messages sharing this exact text, 1-based.
   * Duplicate prompts are disambiguated by occurrence, not by text.
   */
  occurrence: number;
  cwd: string;
}

export interface AgentEngine {
  /** Run one turn, streaming via `onChunk`. Resolves when the turn ends. */
  runTurn(request: TurnRequest): Promise<void>;

  /**
   * Rewind context to the anchor so a retry continues from history that
   * legitimately precedes it, excluding the abandoned answer and later tail.
   */
  resetToAnchor(anchor: AnchorRequest): Promise<void>;

  /**
   * Summarize the session's context in place and return the summary text that
   * replaces the compacted range.
   */
  compact(sessionId: string): Promise<string>;
}

/**
 * The active engine: Rcode's own loop, implemented in agent/loop.ts.
 */
export function getEngine(): AgentEngine {
  return rcodeEngine;
}
