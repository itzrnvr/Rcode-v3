/*
 * PURPOSE: Chat state hook — loads messages, streams agent turns.
 *
 * Accumulates from chat:chunk events:
 *   content    → response event
 *   reasoning  → reasoning event
 *   tool_call  → tool_call event
 *   tool_result→ tool_result event
 *   done       → turnSecs (+reload messages from DB)
 *
 * CONSUMERS: components/chat/ChatView.tsx, sidepanel/SideChatThread.tsx
 */

import { useState, useEffect, useCallback, useRef } from "react";

import { api } from "../api/client";
import { useApp } from "./AppContext";

import type { LiveStep, Message, ChatChunk } from "../types";
import { appendReasoning, appendText, applyCanonicalBlocks } from "../lib/liveSteps";
import { beginRunningTurn, endRunningTurn } from "./runningTurns";

/** A message the reader sent while a turn was still running. */
export interface QueuedMessage {
  id: string;
  text: string;
}

export interface SendMeta {
  mode?: string;
  reasoningEffort?: string;
  model?: string;
}

/** The index of the last tool result, which ends the previous message. */
function lastToolResultIndex(steps: LiveStep[]): number {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    if (steps[index].kind === "tool_result") return index;
  }
  return -1;
}

export function useChat(sessionId: string | null) {
  const { settings } = useApp();
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingReasoning, setStreamingReasoning] = useState("");
  const [liveSteps, setLiveSteps] = useState<LiveStep[]>([]);
  const [turnUsage, setTurnUsage] = useState<{ prompt_tokens?: number; completion_tokens?: number; reasoning_tokens?: number; cached_tokens?: number } | null>(null);
  const [turnSecs, setTurnSecs] = useState<number | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamingTargetId, setStreamingTargetId] = useState<string | null>(null);
  // Messages sent while a turn is still running. They are held here and
  // sent when the turn ends, rather than being dropped.
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>([]);
  const queuedRef = useRef<QueuedMessage[]>([]);
  // The drain at the end of a turn has to call send again, and send is
  // rebuilt whenever its inputs change. A ref keeps the drain from
  // rebuilding the whole hook.
  const sendRef = useRef<(text: string, meta?: SendMeta) => Promise<void>>(
    async () => {}
  );

  // Load messages when session changes
  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    api.getMessages(sessionId).then(msgs => {
      if (!cancelled) setMessages(msgs);
    });
    return () => { cancelled = true; };
  }, [sessionId]);

  const handleChunk = useCallback((chunk: ChatChunk) => {
    if (chunk.done) {
      if (chunk.secs != null) setTurnSecs(chunk.secs);
      if (chunk.usage) {
        setTurnUsage({ prompt_tokens: chunk.usage.prompt_tokens, completion_tokens: chunk.usage.completion_tokens, reasoning_tokens: chunk.usage.completion_tokens_details?.reasoning_tokens, cached_tokens: chunk.usage.prompt_tokens_details?.cached_tokens });
      }
      return;
    }
    if (chunk.kind === "tool_call") {
      setLiveSteps(p => [...p, { kind: "tool_call", name: chunk.tool?.name ?? "tool", args: chunk.tool?.args, status: "running" }]);
      return;
    }
    if (chunk.kind === "tool_result") {
      setLiveSteps(p => [...p, { kind: "tool_result", name: chunk.tool?.name ?? "tool", result: chunk.tool?.result, status: "done" }]);
      return;
    }
    if (chunk.kind === "assistant_end" && chunk.blocks) {
      // The canonical blocks of the message that just ended: all of its
      // reasoning, then all of its text. They replace the message's segment
      // wholesale, which is the repair the provider contract describes: a
      // provider may fragment one message across reasoning and text deltas
      // in any order ("reasoning, F, reasoning, ORK-OK"), and the canonical
      // blocks are what put it back together. Without this the live view
      // kept the raw wire order and only snapped into shape when the turn
      // ended, so a fragmented stream read "ORK-OK" for the whole turn.
      const blocks = chunk.blocks;
      setLiveSteps(p => applyCanonicalBlocks(p, blocks));
      return;
    }
    const reasoningDelta = chunk.reasoning;
    if (reasoningDelta) {
      setStreamingReasoning(prev => prev + reasoningDelta);
      setLiveSteps(p => appendReasoning(p, reasoningDelta));
      return;
    }
    const contentDelta = chunk.content;
    if (contentDelta) {
      setStreamingContent(prev => prev + contentDelta);
      setLiveSteps(p => appendText(p, contentDelta));
    }
  }, []);

  const beginTurn = useCallback(() => {
    setError(null);
    setIsStreaming(true);
    setStreamingContent("");
    setStreamingReasoning("");
    setLiveSteps([]);
    setTurnSecs(null);
    setTurnUsage(null);
  }, []);

  const beginTurnForTarget = useCallback((targetMessageId: string | null) => {
    setStreamingTargetId(targetMessageId);
    beginTurn();
  }, [beginTurn]);

  const endTurn = useCallback(async (sid: string, removeListener: () => void) => {
    endRunningTurn(sid);
    removeListener();
    // The persisted messages are fetched BEFORE the streaming state is
    // cleared, so the streamed turn and the persisted one swap in a single
    // commit. The other order unmounts the live message for a frame - the
    // answer and the trace vanish and come back - which reads as a flicker
    // at the end of every turn.
    const msgs = await api.getMessages(sid).catch(() => null);
    if (msgs) setMessages(msgs);
    setIsStreaming(false);
    setStreamingContent("");
    setStreamingReasoning("");
    setLiveSteps([]);
    setStreamingTargetId(null);
    // Drain the queue: a message sent while this turn was running goes
    // now. The next turn starts on the next tick, so this turn's
    // persisted messages are on screen before its placeholder appears.
    const next = queuedRef.current.shift();
    setQueuedMessages([...queuedRef.current]);
    if (next) {
      window.setTimeout(() => {
        void sendRef.current(next.text);
      }, 0);
    }
  }, []);

  const isStreamingRef = useRef(false);
  useEffect(() => { isStreamingRef.current = isStreaming; }, [isStreaming]);

  const sendMessage = useCallback(async (text: string, meta?: SendMeta) => {
    if (!sessionId || !text.trim()) return;
    const sid = sessionId;
    if (isStreamingRef.current) {
      // A turn is still running, so the message is held and sent when the
      // turn ends. This used to call an api method that does not exist: it
      // threw, and the message stayed on screen without ever being saved,
      // so it vanished on the next reload.
      const entry: QueuedMessage = { id: `queued-${Date.now()}`, text };
      queuedRef.current = [...queuedRef.current, entry];
      setQueuedMessages(queuedRef.current);
      return;
    }

    const tempUserMsg: Message = {
      id: `temp-${Date.now()}`,
      sessionId: sid,
      role: "user",
      content: text,
      createdAt: Date.now(),
    };
    setMessages(prev => [...prev, tempUserMsg]);

    const removeListener = api.onChatChunk(sid, handleChunk);
    beginRunningTurn(sid);
    beginTurnForTarget(null);
    try {
      await api.sendChat({ sessionId: sid, userMessage: text, model: meta?.model ?? settings.model, mode: meta?.mode, reasoningEffort: meta?.reasoningEffort });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      await endTurn(sid, removeListener);
    }
  }, [sessionId, settings.model, handleChunk, beginTurn, endTurn]);

  useEffect(() => {
    sendRef.current = sendMessage;
  }, [sendMessage]);

  // For welcome → new session: send to a specific id not yet in the hook's closure
  const sendTo = useCallback(async (targetId: string, text: string, meta?: SendMeta) => {
    if (!text.trim()) return;
    const tempUserMsg: Message = {
      id: `temp-${Date.now()}`,
      sessionId: targetId,
      role: "user",
      content: text,
      createdAt: Date.now(),
    };
    setMessages(prev => [...prev, tempUserMsg]);
    const removeListener = api.onChatChunk(targetId, handleChunk);
    beginRunningTurn(targetId);
    beginTurnForTarget(null);
    try {
      await api.sendChat({ sessionId: targetId, userMessage: text, model: meta?.model ?? settings.model, mode: meta?.mode, reasoningEffort: meta?.reasoningEffort });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      await endTurn(targetId, removeListener);
    }
  }, [settings.model, handleChunk, beginTurn, endTurn]);

  // Re-run a turn anchored at a user message (retry / edit-and-resend).
  const resend = useCallback(async (anchorUserMessageId: string, meta?: SendMeta) => {
    if (!sessionId) return;
    const sid = sessionId;
    // A retry must replace the response being regenerated, not append a second
    // answer after it. Find that response before the backend archives the tail.
    const anchorIndex = messages.findIndex(message => message.id === anchorUserMessageId);
    const replacedTarget = anchorIndex >= 0
      ? messages.slice(anchorIndex + 1).find(message => message.role === "assistant")
      : undefined;
    const removeListener = api.onChatChunk(sid, handleChunk);
    beginRunningTurn(sid);
    beginTurnForTarget(replacedTarget?.id ?? null);
    try {
      await api.resendChat({ sessionId: sid, anchorUserMessageId, model: meta?.model ?? settings.model });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      await endTurn(sid, removeListener);
    }
  }, [sessionId, settings.model, handleChunk, beginTurnForTarget, endTurn, messages]);

  const setVersion = useCallback(async (messageId: string, index: number) => {
    if (!sessionId) return;
    await api.setMessageVersion(messageId, index);
    const msgs = await api.getMessages(sessionId);
    setMessages(msgs);
  }, [sessionId]);

  // Stop the local streaming state. The actual main-process stream may
  // continue in the background until the upstream model finishes or times out;
  // we just hide it from the UI immediately so the user can keep typing.
  const stopStream = useCallback(() => {
    if (sessionId) endRunningTurn(sessionId);
    setIsStreaming(false);
    setStreamingContent("");
    setStreamingReasoning("");
    setLiveSteps([]);
    setStreamingTargetId(null);
  }, []);

  const editMessage = useCallback(async (id: string, newContent: string) => {
    await api.updateMessage(id, newContent);
    if (!sessionId) return;
    const msgs = await api.getMessages(sessionId);
    setMessages(msgs);
  }, [sessionId]);

  const deleteMessage = useCallback(async (id: string) => {
    await api.deleteMessage(id);
    if (!sessionId) return;
    const msgs = await api.getMessages(sessionId);
    setMessages(msgs);
  }, [sessionId]);

  const refreshMessages = useCallback(async () => {
    if (!sessionId) return;
    const msgs = await api.getMessages(sessionId);
    setMessages(msgs);
  }, [sessionId]);

  return {
    messages, streamingContent, streamingReasoning, liveSteps, turnUsage, queuedMessages,
    turnSecs, isStreaming, streamingTargetId, error,
    sendMessage, sendTo, resend, setVersion, stopStream, editMessage, deleteMessage, refreshMessages,
  };
}
