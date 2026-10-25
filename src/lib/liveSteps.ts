/*
 * PURPOSE: Build the live steps of a streaming turn.
 *
 * A turn's steps are the events the renderer shows while the model is still
 * writing: the reasoning, the tool calls, the tool results and the answer.
 * They have to mirror the canonical shape of the turn, because that is the
 * shape the transcript is persisted in.
 *
 * THE CANONICAL SHAPE
 *
 * A tool result ends an assistant message. Within one message there is at
 * most one reasoning block and at most one text block, and the reasoning
 * comes first - all of the message's reasoning, then all of its text.
 *
 * Why it matters: a provider may fragment ONE message across reasoning and
 * text deltas in any order. One delivered `reasoning, "F", reasoning,
 * "ORK-OK"`. If the renderer appends each delta to whatever came last, that
 * turn shows two reasoning rows and two answers, and the answer reads
 * "ORK-OK" instead of "FORK-OK" - the reader sees a fragment where there is
 * a sentence. The backend already repairs this for the transcript it
 * persists; this module is the same repair, applied live.
 */

import type { LiveStep } from "../types";

export interface CanonicalBlock {
  type: "thinking" | "text";
  text: string;
}

/** The index of the last tool result, which ends the previous message. */
export function lastToolResultIndex(steps: LiveStep[]): number {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    if (steps[index].kind === "tool_result") return index;
  }
  return -1;
}

/** The steps of the message currently being streamed. */
function segmentOf(steps: LiveStep[]): LiveStep[] {
  return steps.slice(lastToolResultIndex(steps) + 1);
}

/** Replace the current message's segment. */
function updateSegment(
  steps: LiveStep[],
  update: (segment: LiveStep[]) => LiveStep[]
): LiveStep[] {
  const boundary = lastToolResultIndex(steps);
  return [...steps.slice(0, boundary + 1), ...update(steps.slice(boundary + 1))];
}

/** Add reasoning to the message being streamed. */
export function appendReasoning(steps: LiveStep[], delta: string): LiveStep[] {
  return updateSegment(steps, segment => {
    const index = segment.findIndex(step => step.kind === "reasoning");
    if (index >= 0) {
      const next = [...segment];
      const step = next[index];
      if (step.kind === "reasoning") next[index] = { ...step, text: step.text + delta };
      return next;
    }
    // A message's reasoning comes before its text, so a new reasoning block
    // opens the segment rather than closing it.
    return [{ kind: "reasoning", text: delta, bornAt: Date.now() }, ...segment];
  });
}

/** Add text to the message being streamed. */
export function appendText(steps: LiveStep[], delta: string): LiveStep[] {
  return updateSegment(steps, segment => {
    const index = segment.findIndex(step => step.kind === "response");
    if (index >= 0) {
      const next = [...segment];
      const step = next[index];
      if (step.kind === "response") next[index] = { ...step, text: step.text + delta };
      return next;
    }
    return [...segment, { kind: "response", text: delta }];
  });
}

/**
 * Apply the canonical blocks of the message that just ended.
 *
 * The backend sends these at the end of every assistant message. They
 * replace the message's segment wholesale, which repairs any fragmentation
 * the provider introduced.
 */
export function applyCanonicalBlocks(
  steps: LiveStep[],
  blocks: readonly CanonicalBlock[]
): LiveStep[] {
  const boundary = lastToolResultIndex(steps);
  const head = steps.slice(0, boundary + 1);
  const tail: LiveStep[] = [];
  for (const block of blocks) {
    if (!block.text.trim()) continue;
    tail.push(
      block.type === "thinking"
        ? { kind: "reasoning", text: block.text }
        : { kind: "response", text: block.text }
    );
  }
  return [...head, ...tail];
}

/** The text of the message being streamed, for the answer and the composer. */
export function liveText(steps: LiveStep[]): string {
  return segmentOf(steps)
    .filter((step): step is Extract<LiveStep, { kind: "response" }> => step.kind === "response")
    .map(step => step.text)
    .join("");
}
