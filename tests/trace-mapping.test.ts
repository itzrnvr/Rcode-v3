/*
 * Tests for the trace mapping — how the renderer turns the engine's
 * StreamEvents into Trace rows (src/components/ui/trace.tsx) with the right
 * statuses and open/collapsed state.
 *
 * The real renderer consumer does not exist yet (nothing in src/ imports
 * ui/trace.tsx), so these assertions run against the reference mapping in
 * ./traceMapping.ts, which pins the contract that consumer must satisfy.
 * When the real module lands, swap the import below to it — the assertions
 * are behavioral, not structural.
 *
 * The two rules under test, from the engine contract and the design rules:
 *   - renderer events map to the right rows with the right status
 *     (reasoning → thinking rows, tool_start/tool_end → tool rows running →
 *     finished/error, usage → no row, response text → not a row);
 *   - a running row is open while streaming and folds when finished, unless
 *     the user clicked it — the click wins over the default policy.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { createTraceMapper, mapEvents } from "./traceMapping.ts";
import type { TraceRowSpec } from "./traceMapping.ts";
import type { AssistantBlock, StreamEvent } from "../electron/agent/engine.ts";

const reasoning = (delta: string): StreamEvent => ({ kind: "reasoning", delta });
const text = (delta: string): StreamEvent => ({ kind: "text", delta });
const usage = (input: number, output: number): StreamEvent => ({ kind: "usage", usage: { input, output } });
const toolStart = (name: string, args: string): StreamEvent => ({ kind: "tool_start", toolName: name, args });
const toolEnd = (name: string, result: string, isError = false): StreamEvent => ({
  kind: "tool_end",
  toolName: name,
  result,
  isError,
});
const end = (...blocks: AssistantBlock[]): StreamEvent => ({ kind: "assistant_end", blocks });

function rowOf(model: { rows: TraceRowSpec[] }, key: string): TraceRowSpec {
  const row = model.rows.find((r) => r.key === key);
  assert.ok(row, `row ${key} exists`);
  return row;
}

// ---------------------------------------------------------------------------
// Events map to the right rows with the right status
// ---------------------------------------------------------------------------

test("reasoning deltas coalesce into one running thinking row", () => {
  const mapper = createTraceMapper();
  mapper.apply(reasoning("first "));
  mapper.apply(reasoning("thought"));
  const { rows } = mapper.model();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "thinking");
  assert.equal(rows[0].status, "running");
  assert.equal(rows[0].detail, "first thought");
  assert.equal(rows[0].open, true, "a streaming row is open");
});

test("a text delta finishes the thinking row; response text is not a row", () => {
  const mapper = createTraceMapper();
  mapper.apply(reasoning("thinking"));
  mapper.apply(text("Answer begins"));
  const { rows, responseText } = mapper.model();
  assert.equal(rows.length, 1, "response text does not become a trace row");
  assert.equal(rows[0].status, undefined, "the thinking row has finished");
  assert.equal(rows[0].open, false, "a finished row folds");
  assert.equal(responseText, "Answer begins");
});

test("tool_start opens a running tool row; tool_end resolves it and swaps the detail", () => {
  const mapper = createTraceMapper();
  mapper.apply(reasoning("check"));
  mapper.apply(text("Let me look."));
  mapper.apply(end({ type: "thinking", text: "check" }, { type: "text", text: "Let me look." }));
  mapper.apply(toolStart("read_file", '{"path":"a.ts"}'));

  let { rows } = mapper.model();
  assert.deepEqual(rows.map((r) => r.kind), ["thinking", "tool"]);
  const tool = rowOf({ rows }, "tool-0");
  assert.equal(tool.title, "read_file");
  assert.equal(tool.status, "running");
  assert.equal(tool.detail, '{"path":"a.ts"}', "the complete argument string, not a fragment");
  assert.equal(tool.open, true);

  mapper.apply(toolEnd("read_file", "line 1: hello"));
  ({ rows } = mapper.model());
  assert.equal(rowOf({ rows }, "tool-0").status, undefined, "a successful tool_end leaves the row finished");
  assert.equal(rowOf({ rows }, "tool-0").detail, "line 1: hello");
  assert.equal(rowOf({ rows }, "tool-0").open, false, "the finished tool row folds");
});

test("a failed tool_end marks the row with error status", () => {
  const mapper = createTraceMapper();
  mapper.apply(toolStart("shell", '{"command":"boom"}'));
  mapper.apply(toolEnd("shell", "shell failed: exit code 1", true));
  const { rows } = mapper.model();
  assert.equal(rows[0].status, "error");
  assert.equal(rows[0].detail, "shell failed: exit code 1");
  assert.equal(rows[0].open, false, "an error row also folds; its red status is the signal");
});

test("usage events produce no rows", () => {
  const mapper = createTraceMapper();
  mapper.apply(usage(120, 30));
  assert.deepEqual(mapper.model().rows, []);
});

test("each assistant message gets its own thinking row", () => {
  const events: StreamEvent[] = [
    reasoning("round one"),
    text("probing"),
    end({ type: "thinking", text: "round one" }, { type: "text", text: "probing" }),
    toolStart("list_dir", "{}"),
    toolEnd("list_dir", "a.txt"),
    reasoning("round two"),
    text("All done."),
    end({ type: "thinking", text: "round two" }, { type: "text", text: "All done." }),
  ];
  const { rows, responseText } = mapEvents(events).model();
  assert.deepEqual(
    rows.map((r) => [r.kind, r.status]),
    [
      ["thinking", undefined],
      ["tool", undefined],
      ["thinking", undefined],
    ],
    "two assistant messages, two thinking rows, one tool row between them",
  );
  assert.equal(rowOf({ rows }, "thinking-0").detail, "round one");
  assert.equal(rowOf({ rows }, "thinking-1").detail, "round two");
  assert.equal(responseText, "All done.", "the final message's text is the response");
});

test("assistant_end repairs a fragmented stream into canonical blocks", () => {
  // The engine docstring's case: reasoning, "F", reasoning, "ORK-OK".
  const mapper = createTraceMapper();
  mapper.apply(reasoning("why "));
  mapper.apply(text("F"));
  mapper.apply(reasoning("not."));
  mapper.apply(text("ORK-OK"));
  // Before the end event, the response text is the last fragment...
  assert.equal(mapper.model().responseText, "FORK-OK", "deltas concatenate in wire order");

  mapper.apply(end({ type: "thinking", text: "why not." }, { type: "text", text: "FORK-OK" }));
  const { rows, responseText: repaired } = mapper.model();
  assert.equal(repaired, "FORK-OK", "the canonical text block wins");
  assert.equal(rows.length, 1);
  assert.equal(rowOf({ rows }, "thinking-0").detail, "why not.", "canonical thinking, not raw fragments");
  assert.equal(rowOf({ rows }, "thinking-0").status, undefined);
});

test("a new message's text starts fresh instead of appending to the previous one", () => {
  const mapper = createTraceMapper();
  mapper.apply(text("first message"));
  mapper.apply(end({ type: "text", text: "first message" }));
  mapper.apply(text("second"));
  assert.equal(mapper.model().responseText, "second");
});

test("a text-only message creates no thinking row", () => {
  const mapper = createTraceMapper();
  mapper.apply(text("plain answer"));
  mapper.apply(end({ type: "text", text: "plain answer" }));
  const { rows, responseText } = mapper.model();
  assert.deepEqual(rows, []);
  assert.equal(responseText, "plain answer");
});

// ---------------------------------------------------------------------------
// Open policy: running = open, finished = folded, user clicks win
// ---------------------------------------------------------------------------

test("a running row is open while streaming and folds when finished", () => {
  const mapper = createTraceMapper();
  mapper.apply(toolStart("grep", '{"pattern":"x"}'));
  assert.equal(mapper.model().rows[0].open, true, "open while running");
  mapper.apply(toolEnd("grep", "3 matches"));
  assert.equal(mapper.model().rows[0].open, false, "folded when finished");
});

test("a click while running pins the row open through the finish", () => {
  const mapper = createTraceMapper();
  mapper.apply(toolStart("grep", '{"pattern":"x"}'));
  const key = mapper.model().rows[0].key;
  mapper.click(key); // open → closed
  mapper.click(key); // closed → open: the user asked for it, so it is pinned
  mapper.apply(toolEnd("grep", "3 matches"));
  assert.equal(mapper.model().rows[0].open, true, "the user's choice survives the finish");
});

test("a click can close a running row and it stays closed after finishing", () => {
  const mapper = createTraceMapper();
  mapper.apply(toolStart("grep", '{"pattern":"x"}'));
  const key = mapper.model().rows[0].key;
  mapper.click(key); // open → closed
  assert.equal(mapper.model().rows[0].open, false, "user-closed while running");
  mapper.apply(toolEnd("grep", "3 matches"));
  assert.equal(mapper.model().rows[0].open, false, "still closed after finishing");
});

test("clicking a finished row reopens it", () => {
  const mapper = createTraceMapper();
  mapper.apply(toolStart("grep", '{"pattern":"x"}'));
  mapper.apply(toolEnd("grep", "3 matches"));
  const key = mapper.model().rows[0].key;
  assert.equal(mapper.model().rows[0].open, false);
  mapper.click(key);
  assert.equal(mapper.model().rows[0].open, true, "the user wins over the fold");
  mapper.click(key);
  assert.equal(mapper.model().rows[0].open, false, "and can close it again");
});

test("the thinking row follows the same open policy as tool rows", () => {
  const mapper = createTraceMapper();
  mapper.apply(reasoning("deep thought"));
  const key = mapper.model().rows[0].key;
  mapper.click(key); // close it while it streams
  assert.equal(mapper.model().rows[0].open, false);
  mapper.apply(text("answer"));
  assert.equal(mapper.model().rows[0].open, false, "stays closed after finishing");
});

// ---------------------------------------------------------------------------
// A whole turn end to end
// ---------------------------------------------------------------------------

test("a full two-round turn maps to thinking → tool → thinking with the final response", () => {
  const events: StreamEvent[] = [
    reasoning("checking the file"),
    text("Let me look."),
    end({ type: "thinking", text: "checking the file" }, { type: "text", text: "Let me look." }),
    toolStart("read_file", '{"path":"a.ts"}'),
    toolEnd("read_file", "1\thello"),
    reasoning("now I know"),
    text("All done."),
    end({ type: "thinking", text: "now I know" }, { type: "text", text: "All done." }),
    usage(150, 30),
  ];
  const { rows, responseText } = mapEvents(events).model();
  assert.deepEqual(
    rows.map((r) => [r.kind, r.title, r.status]),
    [
      ["thinking", "Thinking", undefined],
      ["tool", "read_file", undefined],
      ["thinking", "Thinking", undefined],
    ],
  );
  assert.equal(rowOf({ rows }, "tool-0").detail, "1\thello");
  assert.equal(responseText, "All done.");
  assert.ok(rows.every((r) => !r.open), "nothing runs anymore, so everything is folded");
});
