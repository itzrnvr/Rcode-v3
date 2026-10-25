import { test } from "node:test";
import assert from "node:assert/strict";

import {
  appendReasoning,
  appendText,
  applyCanonicalBlocks,
  lastToolResultIndex,
} from "../src/lib/liveSteps.ts";
import type { LiveStep } from "../src/types.ts";

/** The live steps of one assistant message, in the canonical shape. */
function steps(): LiveStep[] {
  return [];
}

test("a message's reasoning accumulates into one block", () => {
  let live = steps();
  live = appendReasoning(live, "first ");
  live = appendReasoning(live, "second");
  assert.equal(live.length, 1);
  assert.equal(live[0].kind, "reasoning");
  assert.equal((live[0] as { text: string }).text, "first second");
});

test("a message's text accumulates into one block", () => {
  let live = steps();
  live = appendText(live, "Hel");
  live = appendText(live, "lo");
  assert.equal(live.length, 1);
  assert.equal((live[0] as { text: string }).text, "Hello");
});

test("the reasoning of a message comes before its text", () => {
  let live = steps();
  live = appendReasoning(live, "thinking");
  live = appendText(live, "answer");
  assert.deepEqual(
    live.map(step => step.kind),
    ["reasoning", "response"],
  );
});

test("text that arrives before the reasoning is still ordered after it", () => {
  // A provider that emits text first and reasons afterwards.
  let live = steps();
  live = appendText(live, "answer");
  live = appendReasoning(live, "thinking");
  assert.deepEqual(
    live.map(step => step.kind),
    ["reasoning", "response"],
  );
  assert.equal((live[1] as { text: string }).text, "answer");
});

test("a fragmented message reads as one answer while it streams", () => {
  // The case the provider contract exists for: one provider delivered
  // `reasoning, "F", reasoning, "ORK-OK"`.
  let live = steps();
  live = appendReasoning(live, "let me check ");
  live = appendText(live, "F");
  live = appendReasoning(live, "the file");
  live = appendText(live, "ORK-OK");

  assert.equal(live.length, 2);
  const [reasoning, response] = live;
  assert.equal(reasoning.kind, "reasoning");
  assert.equal(response.kind, "response");
  assert.equal((response as { text: string }).text, "FORK-OK");
});

test("a tool result ends the message, so the next one starts fresh", () => {
  let live = steps();
  live = appendReasoning(live, "round one");
  live = appendText(live, "first answer");
  live = [
    ...live,
    { kind: "tool_call", name: "read_file", status: "running" },
    { kind: "tool_result", name: "read_file", result: "contents", status: "done" },
  ];
  live = appendReasoning(live, "round two");
  live = appendText(live, "second answer");

  assert.deepEqual(
    live.map(step => step.kind),
    ["reasoning", "response", "tool_call", "tool_result", "reasoning", "response"],
  );
  assert.equal((live[5] as { text: string }).text, "second answer");
  assert.equal((live[4] as { text: string }).text, "round two");
});

test("the canonical blocks replace the message's segment", () => {
  let live = steps();
  live = appendReasoning(live, "noise");
  live = appendText(live, "frag");
  live = applyCanonicalBlocks(live, [
    { type: "thinking", text: "the real reasoning" },
    { type: "text", text: "the real answer" },
  ]);

  assert.equal(live.length, 2);
  assert.equal((live[0] as { text: string }).text, "the real reasoning");
  assert.equal((live[1] as { text: string }).text, "the real answer");
});

test("the canonical blocks leave earlier messages alone", () => {
  let live = steps();
  live = appendReasoning(live, "round one");
  live = appendText(live, "first answer");
  live = [
    ...live,
    { kind: "tool_call", name: "read_file", status: "running" },
    { kind: "tool_result", name: "read_file", result: "contents", status: "done" },
  ];
  live = appendReasoning(live, "noise");
  live = applyCanonicalBlocks(live, [
    { type: "thinking", text: "round two reasoning" },
    { type: "text", text: "second answer" },
  ]);

  assert.deepEqual(
    live.map(step => step.kind),
    ["reasoning", "response", "tool_call", "tool_result", "reasoning", "response"],
  );
  assert.equal((live[1] as { text: string }).text, "first answer");
  assert.equal((live[5] as { text: string }).text, "second answer");
});

test("a canonical block with no content is dropped", () => {
  let live = steps();
  live = appendText(live, "answer");
  live = applyCanonicalBlocks(live, [
    { type: "thinking", text: "   " },
    { type: "text", text: "answer" },
  ]);
  assert.equal(live.length, 1);
  assert.equal(live[0].kind, "response");
});

test("the last tool result is the message boundary", () => {
  const live: LiveStep[] = [
    { kind: "reasoning", text: "one" },
    { kind: "tool_result", name: "read_file", result: "x", status: "done" },
    { kind: "reasoning", text: "two" },
  ];
  assert.equal(lastToolResultIndex(live), 1);
  assert.equal(lastToolResultIndex([]), -1);
});
