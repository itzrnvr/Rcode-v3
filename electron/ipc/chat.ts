/*
 * PURPOSE: Chat turns — stream an engine turn into the renderer and persist it.
 *
 * This module owns everything above the agent: it persists the user message,
 * maps engine StreamEvents onto the renderer's ChatChunk stream, repairs
 * fragmented provider streams, and persists the finished turn in Rcode's
 * SQLite as ordered typed events: reasoning, response, tool_call, tool_result.
 * `content` remains the final answer.
 *
 * The agent itself is Rcode's own loop, behind the AgentEngine contract in
 * agent/engine.ts. There is no external backend and no fallback.
 */

import type { IpcMainInvokeEvent } from "electron";
import { registerApiHandler } from "../api/registry";

import { getSession } from "../db/sessions";
import { getMessages, addMessage, appendAssistantVersion, archiveTail } from "../db/messages";
import { getSettings } from "../db/settings";
import { getProvider } from "../db/providers";
import { buildSystemPrompt } from "../chat/systemPrompt";
import { logTrace, readTrace } from "../agent/trace";
import { createTools } from "../agent/tools";
import { readCompactionRecord, resolveProjectDir, resolveRestrictedAllowedPaths } from "../agent/loop";
import { getEngine, type AssistantBlock } from "../agent/engine";

import type { AgentTurn, AgentTurnEvent, ChatRequest, ChatChunk, Settings, TurnUsage } from "../../src/types";

/**
 * Stream one engine turn into the renderer and collect the persistable turn.
 * persist() runs BEFORE the done chunk so a post-done message refetch sees it.
 */
async function runTurn(
  event: IpcMainInvokeEvent,
  request: ChatRequest,
  settings: Settings,
  opts: { promptText: string; persist: (turn: AgentTurn) => void },
): Promise<void> {
  const sid = request.sessionId;
  const session = getSession(sid);
  const sendChunk = (chunk: ChatChunk) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send(`chat:chunk:${sid}`, chunk);
    }
  };
  const startedAt = Date.now();
  let finalContent = "";
  const events: AgentTurnEvent[] = [];
  let usageIn = 0;
  let usageOut = 0;
  // Keep tool results as turn-segment boundaries. At each completed assistant
  // message we replace only the latest raw delta segment with its canonical
  // blocks.
  // This repairs fragmented provider streams without changing earlier traces or
  // assuming that all text/reasoning deltas arrive as one contiguous run.
  const reconcileAssistantSegment = (blocks: AssistantBlock[]) => {
    const boundary = events.findLastIndex(item => item.kind === "tool_result");
    const segmentStart = boundary + 1;
    const canonical = blocks.flatMap(block => {
      const kind = block.type === "thinking" ? "reasoning" : "response";
      if (!block.text.trim()) return [];
      return [{ kind, text: block.text } as AgentTurnEvent];
    });

    events.splice(segmentStart, events.length - segmentStart, ...canonical);
    const lastResponse = canonical.findLast(item => item.kind === "response");
    if (lastResponse && lastResponse.kind === "response") {
      finalContent = lastResponse.text;
    }
  };
  const providerRow = getProvider(settings.providerName);
  // Tools run in the session's project directory, never the user's home, and
  // the tool surface is gated by the composer's access mode for this turn.
  const cwd = resolveProjectDir(sid);
  const tools = createTools({ mode: request.mode, allowedPaths: resolveRestrictedAllowedPaths(sid) });
  const effort = request.reasoningEffort || (settings as Settings & { reasoningEffort?: string }).reasoningEffort;
  const turn = readTrace(sid).filter(e => e.kind === "turn_start").length + 1;
  const systemPrompt = buildSystemPrompt(settings.globalInstructions, session?.customInstructions ?? null);
  logTrace(sid, {
    kind: "turn_start", turn, model: request.model ?? settings.model,
    baseUrl: providerRow?.baseUrl ?? settings.apiBase, mode: request.mode || "full-access",
    effort: effort ?? "", userMessage: opts.promptText,
  });
  // The system prompt and the user's message are their own rows in the
  // trajectory, not a field of some other row. They used to live only inside
  // the request payload, where the system prompt was indistinguishable from a
  // tool's JSON arguments - the one thing the trajectory exists to tell apart.
  logTrace(sid, { kind: "system", turn, text: systemPrompt });
  logTrace(sid, { kind: "user", turn, text: opts.promptText });
  try {
    await getEngine().runTurn({
      sessionId: sid,
      promptText: opts.promptText,
      providerId: settings.providerName,
      baseUrl: providerRow?.baseUrl || settings.apiBase,
      apiKey: providerRow?.apiKey || "",
      modelId: request.model ?? settings.model,
      modelList: providerRow?.modelList.map(m => m.id) ?? [],
      cwd,
      systemPrompt,
      mode: (request.mode as string) || "full-access",
      effort,
      tools,
      onChunk: c => {
        if (c.kind === "text" && c.delta) {
          // Whitespace-only text deltas are kept. They are not a meaningful
          // response on their own - the renderer drops them when it picks the
          // answer - but they are part of the answer's text, and dropping them
          // here made the live answer differ from the persisted one until the
          // turn ended.
          const last = events[events.length - 1];
          if (last?.kind === "response") {
            last.text += c.delta;
            finalContent = last.text;
          } else {
            events.push({ kind: "response", text: c.delta });
            finalContent = c.delta;
          }
          sendChunk({ content: c.delta, done: false });
        } else if (c.kind === "reasoning" && c.delta) {
          const last = events[events.length - 1];
          if (last?.kind === "reasoning") last.text += c.delta;
          else events.push({ kind: "reasoning", text: c.delta });
          sendChunk({ content: "", reasoning: c.delta, done: false });
        } else if (c.kind === "tool_start") {
          events.push({ kind: "tool_call", name: c.toolName ?? "tool", args: c.args });
          logTrace(sid, { kind: "tool_call", turn, name: c.toolName ?? "tool", args: c.args });
          sendChunk({ content: "", done: false, kind: "tool_call", tool: { name: c.toolName ?? "tool", args: c.args } });
        } else if (c.kind === "tool_end") {
          events.push({ kind: "tool_result", name: c.toolName ?? "tool", result: c.result, isError: Boolean(c.isError) });
          logTrace(sid, { kind: "tool_result", turn, name: c.toolName ?? "tool", result: c.result });
          sendChunk({ content: "", done: false, kind: "tool_result", tool: { name: c.toolName ?? "tool", result: c.result } });
        } else if (c.kind === "usage" && c.usage) {
          usageIn += c.usage.input;
          usageOut += c.usage.output;
        } else if (c.kind === "assistant_end" && c.blocks) {
          reconcileAssistantSegment(c.blocks);
          // The canonical blocks go to the renderer too. The transcript is
          // repaired here; without this the live view kept the raw wire order
          // and only snapped into shape when the turn ended, which is how a
          // fragmented stream showed the reader "ORK-OK" instead of
          // "FORK-OK" for the whole turn.
          sendChunk({
            content: "",
            done: false,
            kind: "assistant_end",
            blocks: c.blocks.map(block => ({ type: block.type, text: block.text })),
          });
        }
      },
    });
  } catch (e) {
    logTrace(sid, { kind: "turn_end", turn, secs: Math.round((Date.now() - startedAt) / 1000), error: e instanceof Error ? e.message : String(e) });
    throw e;
  }

  const secs = Math.round((Date.now() - startedAt) / 1000);
  logTrace(sid, { kind: "content", turn, round: "final", text: finalContent });
  logTrace(sid, { kind: "turn_end", turn, secs });

  const usage: TurnUsage | undefined = usageIn || usageOut
    ? { prompt_tokens: usageIn, completion_tokens: usageOut, reasoning_tokens: 0, cached_tokens: 0 }
    : undefined;
  opts.persist({
    secs,
    usage,
    events,
    finalContent: finalContent || "(no response)",
  });
  sendChunk({
    content: "", done: true, secs,
    usage: usageIn || usageOut ? {
      prompt_tokens: usageIn,
      completion_tokens: usageOut,
      prompt_tokens_details: { cached_tokens: 0 },
      completion_tokens_details: { reasoning_tokens: 0 },
    } : undefined,
  });
}

export function registerChatHandler(): void {
  registerApiHandler("chat:send", async (event: IpcMainInvokeEvent, request: ChatRequest) => {
    const settings = getSettings();
    const session = getSession(request.sessionId);
    if (!session) throw new Error("Session not found");
    addMessage(request.sessionId, "user", request.userMessage);
    await runTurn(event, request, settings, {
      promptText: request.userMessage,
      persist: turn => addMessage(request.sessionId, "assistant", turn.finalContent, turn),
    });
  });

  // Re-run a turn anchored at a user message (retry / edit-and-resend).
  registerApiHandler("chat:resend", async (event: IpcMainInvokeEvent, request: { sessionId: string; anchorUserMessageId: string; model?: string }) => {
    const settings = getSettings();
    const session = getSession(request.sessionId);
    if (!session) throw new Error("Session not found");

    const history = getMessages(request.sessionId);
    const anchor = history.find(m => m.id === request.anchorUserMessageId && m.role === "user");
    if (!anchor) throw new Error("Anchor user message not found");

    // Retry must rewind engine context to the anchor user message, so the
    // regenerated turn sees only history that legitimately precedes it. The
    // abandoned answer and any later tail must stay out of the request.
    const anchorIdx = history.indexOf(anchor);
    const anchorOccurrence = history
      .slice(0, anchorIdx + 1)
      .filter(m => m.role === "user" && m.content === anchor.content).length;
    await getEngine().resetToAnchor({
      sessionId: request.sessionId,
      promptText: anchor.content,
      occurrence: anchorOccurrence,
      cwd: resolveProjectDir(request.sessionId),
    });
    const target = history.slice(anchorIdx + 1).find(m => m.role === "assistant");
    // Retry = new branch: archive everything after the target under its current
    // version so the tail disappears; version arrows restore it later.
    if (target) archiveTail(target.id, target.versionIndex ?? 0);

    const chatRequest: ChatRequest = {
      sessionId: request.sessionId,
      userMessage: anchor.content,
      model: request.model,
    };
    await runTurn(event, chatRequest, settings, {
      promptText: anchor.content,
      persist: turn => {
        if (target) appendAssistantVersion(target.id, turn.finalContent, turn);
        else addMessage(request.sessionId, "assistant", turn.finalContent, turn);
      },
    });
  });

  // Compact the session context; the engine performs the summarization.
  registerApiHandler("chat:compact", async (_e, sessionId: string) => {
    const summary = await getEngine().compact(sessionId);
    return { summary };
  });

  // Context usage estimate for the composer pill. Compacted messages are
  // replaced by the summary in the model's context, so the estimate counts
  // the summary plus only the messages still in context. Tool schema weight
  // is fixed until the engine reports a real token count.
  registerApiHandler("chat:contextInfo", (_e, sessionId: string) => {
    const settings = getSettings();
    const session = getSession(sessionId);
    const est = (s: string) => Math.round(s.length / 4);
    const system = est(buildSystemPrompt(settings.globalInstructions, session?.customInstructions ?? null));
    const tools = 1800;
    const compaction = readCompactionRecord(sessionId);
    const excluded = compaction ? new Set(compaction.excludedMessageIds) : null;
    const messages = (compaction ? est(compaction.summary) : 0) +
      getMessages(sessionId)
        .filter(m => !excluded || !excluded.has(m.id))
        .reduce((a, m) => a + est(m.content), 0);
    let cacheRate: number | null = null;
    const evts = readTrace(sessionId);
    for (let i = evts.length - 1; i >= 0; i--) {
      const u = (evts[i] as { usage?: { prompt_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } }).usage;
      if (u?.prompt_tokens) { cacheRate = (u.prompt_tokens_details?.cached_tokens ?? 0) / u.prompt_tokens; break; }
    }
    return { system, tools, messages, cacheRate };
  });
}
