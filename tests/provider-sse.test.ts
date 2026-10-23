/*
 * Tests for electron/agent/provider.ts — the OpenAI-compatible streaming
 * client — against the StreamEvent contract in electron/agent/engine.ts.
 *
 * The provider speaks to the network through global fetch, so every test
 * swaps in a fake fetch that returns hand-built SSE responses. Chunks are
 * byte pieces the way a TCP stream would deliver them, which lets the tests
 * split one SSE event across read boundaries exactly like the real thing.
 *
 * Contract rules pinned here (from the engine module docstring):
 *   - reasoning deltas are captured BEFORE the response text they precede,
 *     including within a single chunk whose fields arrive in the wrong order;
 *   - exactly ONE assistant_end per completed assistant message, carrying the
 *     canonical blocks (all reasoning as one thinking block, then all text)
 *     regardless of how the provider fragmented the stream;
 *   - assistant_end is emitted BEFORE the round's tool_start events;
 *   - HTTP and in-stream error bodies surface as ProviderError, an aborted
 *     turn as ProviderAbortedError — nothing is swallowed into an empty
 *     stream.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ProviderAbortedError,
  ProviderError,
  runProviderTurn,
  streamAssistantRound,
  streamProviderTurn,
} from "../electron/agent/provider.ts";
import type {
  ProviderMessage,
  ProviderStreamEvent,
  RoundOptions,
  TurnStreamEvent,
} from "../electron/agent/provider.ts";
import type { EngineTool } from "../electron/agent/engine.ts";

const encoder = new TextEncoder();

// ---------------------------------------------------------------------------
// Fake transport
// ---------------------------------------------------------------------------

interface FetchCall {
  url: string;
  init: RequestInit;
}

/** Replace global fetch, run `run`, always restore the original. */
async function withFakeFetch<T>(
  handler: (call: FetchCall, callIndex: number) => Response,
  run: (calls: FetchCall[]) => Promise<T>,
): Promise<T> {
  const calls: FetchCall[] = [];
  const fake = (input: unknown, init?: RequestInit): Promise<Response> => {
    const call: FetchCall = { url: String(input), init: init ?? {} };
    calls.push(call);
    return Promise.resolve(handler(call, calls.length - 1));
  };
  const original = globalThis.fetch;
  Object.defineProperty(globalThis, "fetch", { value: fake, writable: true, configurable: true });
  try {
    return await run(calls);
  } finally {
    Object.defineProperty(globalThis, "fetch", { value: original, writable: true, configurable: true });
  }
}

/** A 200 response whose body delivers `chunks` as separate TCP-sized reads. */
function sseResponse(chunks: string[], contentType = "text/event-stream"): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": contentType } });
}

/** A response whose body stops after `firstChunk` and errors on abort. */
function abortableSseResponse(firstChunk: string): { res: Response; ac: AbortController } {
  const ac = new AbortController();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      c.enqueue(encoder.encode(firstChunk));
    },
  });
  ac.signal.addEventListener("abort", () => controller.error(new Error("stream aborted")), { once: true });
  return { res: new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }), ac };
}

/** One SSE `data:` event carrying a JSON payload. */
const evt = (payload: unknown): string => `data: ${JSON.stringify(payload)}\n\n`;

const baseMessages: ProviderMessage[] = [{ role: "user", content: "hi" }];

function baseOptions(overrides: Partial<RoundOptions> = {}): RoundOptions {
  return {
    baseUrl: "http://provider.test/v1",
    apiKey: "sk-test",
    modelId: "test-model",
    messages: baseMessages,
    ...overrides,
  };
}

async function drainRound(options: RoundOptions): Promise<ProviderStreamEvent[]> {
  const events: ProviderStreamEvent[] = [];
  for await (const event of streamAssistantRound(options)) events.push(event);
  return events;
}

const kinds = (events: { kind: string }[]): string[] => events.map((e) => e.kind);

const assistantEnds = (events: ProviderStreamEvent[]) =>
  events.filter((e): e is Extract<ProviderStreamEvent, { kind: "assistant_end" }> => e.kind === "assistant_end");

// ---------------------------------------------------------------------------
// SSE parsing mechanics
// ---------------------------------------------------------------------------

test("one SSE event split across TCP chunk boundaries parses as one delta", async () => {
  // Event 1 is cut mid-JSON; event 2 uses CRLF endings and its terminating
  // blank line is itself split across the boundary; [DONE] follows.
  const chunks = [
    'data: {"choices":[{"index":0,"delta":{"content":"hel',
    'lo"}}]}\n\n',
    'data: {"choices":[{"index":0,"delta":{"content":" world"}}]}\r\n',
    '\r\ndata: [DONE]\n\n',
  ];
  const events = await withFakeFetch(() => sseResponse(chunks), () => drainRound(baseOptions()));

  const deltas = events.filter((e): e is Extract<ProviderStreamEvent, { kind: "text" }> => e.kind === "text");
  assert.deepEqual(
    deltas.map((e) => e.delta),
    ["hello", " world"],
    "a line split across reads must buffer into one event, not two fragments",
  );
  assert.deepEqual(assistantEnds(events)[0].blocks, [{ type: "text", text: "hello world" }]);
  const last = events[events.length - 1];
  assert.equal(last.kind, "round_complete");
  assert.equal(last.kind === "round_complete" && last.incomplete, false);
});

test("SSE keep-alive comments are ignored", async () => {
  const chunks = [": keep-alive\n\n", evt({ choices: [{ index: 0, delta: { content: "ok" } }] }), "data: [DONE]\n\n"];
  const events = await withFakeFetch(() => sseResponse(chunks), () => drainRound(baseOptions()));
  assert.deepEqual(
    events.filter((e) => e.kind === "text").map((e) => (e.kind === "text" ? e.delta : "")),
    ["ok"],
  );
});

test("[DONE] terminates the stream and later chunks are ignored, even error ones", async () => {
  const chunks = [
    evt({ choices: [{ index: 0, delta: { content: "answer" } }] }),
    "data: [DONE]\n\n",
    evt({ error: { message: "late error must not surface" } }),
    "data: not json at all\n\n",
  ];
  const events = await withFakeFetch(() => sseResponse(chunks), () => drainRound(baseOptions()));
  assert.deepEqual(events.filter((e) => e.kind === "text").map((e) => (e.kind === "text" ? e.delta : "")), ["answer"]);
  const last = events[events.length - 1] as Extract<ProviderStreamEvent, { kind: "round_complete" }>;
  assert.equal(last.incomplete, false, "[DONE] was seen, so the round is complete");
});

test("a stream that ends without [DONE] and without finish_reason is marked incomplete", async () => {
  const events = await withFakeFetch(
    () => sseResponse([evt({ choices: [{ index: 0, delta: { content: "partial" } }] })]),
    () => drainRound(baseOptions()),
  );
  const last = events[events.length - 1] as Extract<ProviderStreamEvent, { kind: "round_complete" }>;
  assert.equal(last.incomplete, true);
});

test("finish_reason without [DONE] still counts as complete", async () => {
  const chunks = [
    evt({ choices: [{ index: 0, delta: { content: "text" }, finish_reason: "stop" }] }),
  ];
  const events = await withFakeFetch(() => sseResponse(chunks), () => drainRound(baseOptions()));
  const last = events[events.length - 1] as Extract<ProviderStreamEvent, { kind: "round_complete" }>;
  assert.equal(last.incomplete, false);
  assert.equal(last.finishReason, "stop");
});

// ---------------------------------------------------------------------------
// Reasoning / text ordering and the canonical assistant_end
// ---------------------------------------------------------------------------

test("reasoning and text in the SAME chunk are reordered: reasoning first", async () => {
  // The wire order has content before reasoning_content; the contract requires
  // reasoning to be captured before the text it precedes.
  const chunks = [
    evt({ choices: [{ index: 0, delta: { content: "the answer", reasoning_content: "the thinking" } }] }),
    "data: [DONE]\n\n",
  ];
  const events = await withFakeFetch(() => sseResponse(chunks), () => drainRound(baseOptions()));
  assert.deepEqual(kinds(events.slice(0, 2)), ["reasoning", "text"], "reasoning delta must precede text delta");
  assert.deepEqual(
    events.slice(0, 2).map((e) => (e.kind === "reasoning" || e.kind === "text" ? e.delta : "")),
    ["the thinking", "the answer"],
  );
  assert.deepEqual(assistantEnds(events)[0].blocks, [
    { type: "thinking", text: "the thinking" },
    { type: "text", text: "the answer" },
  ]);
});

test("interleaved cross-chunk fragments repair into canonical blocks (the F/ORK-OK case)", async () => {
  // The engine docstring's motivating bug: a provider delivered
  // reasoning, "F", reasoning, "ORK-OK" — the answer is FORK-OK, not ORK-OK.
  const chunks = [
    evt({ choices: [{ index: 0, delta: { reasoning_content: "why " } }] }),
    evt({ choices: [{ index: 0, delta: { content: "F" } }] }),
    evt({ choices: [{ index: 0, delta: { reasoning_content: "not." } }] }),
    evt({ choices: [{ index: 0, delta: { content: "ORK-OK" } }] }),
    "data: [DONE]\n\n",
  ];
  const events = await withFakeFetch(() => sseResponse(chunks), () => drainRound(baseOptions()));

  // Deltas keep the wire order (cross-chunk interleaving is not reordered).
  assert.deepEqual(kinds(events.slice(0, 4)), ["reasoning", "text", "reasoning", "text"]);

  const ends = assistantEnds(events);
  assert.equal(ends.length, 1, "exactly one assistant_end per completed assistant message");
  assert.deepEqual(ends[0].blocks, [
    { type: "thinking", text: "why not." },
    { type: "text", text: "FORK-OK" },
  ]);
});

test("whitespace-only reasoning produces no thinking block", async () => {
  const chunks = [
    evt({ choices: [{ index: 0, delta: { reasoning_content: "   " } }] }),
    evt({ choices: [{ index: 0, delta: { content: "answer" } }] }),
    "data: [DONE]\n\n",
  ];
  const events = await withFakeFetch(() => sseResponse(chunks), () => drainRound(baseOptions()));
  assert.deepEqual(assistantEnds(events)[0].blocks, [{ type: "text", text: "answer" }]);
});

test("usage is emitted once per round, after assistant_end, with the last value seen", async () => {
  const chunks = [
    evt({ choices: [{ index: 0, delta: { content: "a" } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
    evt({ choices: [{ index: 0, delta: { content: "b" } }], usage: { prompt_tokens: 20, completion_tokens: 7 } }),
    "data: [DONE]\n\n",
  ];
  const events = await withFakeFetch(() => sseResponse(chunks), () => drainRound(baseOptions()));
  const usages = events.filter((e): e is Extract<ProviderStreamEvent, { kind: "usage" }> => e.kind === "usage");
  assert.equal(usages.length, 1);
  assert.deepEqual(usages[0].usage, { input: 20, output: 7 });
  // Terminal order is part of the shape consumers rely on.
  assert.deepEqual(kinds(events).slice(-3), ["assistant_end", "usage", "round_complete"]);
});

// ---------------------------------------------------------------------------
// Tool-call fragment accumulation
// ---------------------------------------------------------------------------

test("tool-call arguments fragmented across chunks merge into one complete call", async () => {
  const chunks = [
    evt({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_a", type: "function", function: { name: "read_file", arguments: "" } }] } }] }),
    evt({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"path":' } }] } }] }),
    evt({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"a.ts"}' } }] } }] }),
    evt({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }),
    "data: [DONE]\n\n",
  ];
  const events = await withFakeFetch(() => sseResponse(chunks), () => drainRound(baseOptions()));

  // The round itself never emits tool events — tool_start/tool_end belong to
  // the turn loop, after the assistant message has completed.
  assert.equal(events.some((e) => e.kind === "tool_start" || e.kind === "tool_end"), false);

  const last = events[events.length - 1] as Extract<ProviderStreamEvent, { kind: "round_complete" }>;
  assert.deepEqual(last.toolCalls, [{ id: "call_a", name: "read_file", args: '{"path":"a.ts"}' }]);
  assert.equal(last.finishReason, "tool_calls");
  assert.equal(last.incomplete, false);
});

test("calls are keyed by index and completed in index order even when fragmented out of order", async () => {
  const chunks = [
    evt({ choices: [{ index: 0, delta: { tool_calls: [{ index: 1, id: "call_b", function: { name: "grep", arguments: '{"x"' } }] } }] }),
    evt({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_a", function: { name: "list_dir", arguments: '{"y":1}' } }] } }] }),
    evt({ choices: [{ index: 0, delta: { tool_calls: [{ index: 1, function: { arguments: ":2}" } }] } }] }),
    "data: [DONE]\n\n",
  ];
  const events = await withFakeFetch(() => sseResponse(chunks), () => drainRound(baseOptions()));
  const last = events[events.length - 1] as Extract<ProviderStreamEvent, { kind: "round_complete" }>;
  assert.deepEqual(last.toolCalls, [
    { id: "call_a", name: "list_dir", args: '{"y":1}' },
    { id: "call_b", name: "grep", args: '{"x":2}' },
  ]);
});

test("providers that omit index are keyed by tool-call id", async () => {
  const chunks = [
    evt({ choices: [{ index: 0, delta: { tool_calls: [{ id: "call_1", function: { name: "f", arguments: "1" } }] } }] }),
    evt({ choices: [{ index: 0, delta: { tool_calls: [{ id: "call_2", function: { name: "g", arguments: "2" } }] } }] }),
    evt({ choices: [{ index: 0, delta: { tool_calls: [{ id: "call_1", function: { arguments: ".5" } }] } }] }),
    "data: [DONE]\n\n",
  ];
  const events = await withFakeFetch(() => sseResponse(chunks), () => drainRound(baseOptions()));
  const last = events[events.length - 1] as Extract<ProviderStreamEvent, { kind: "round_complete" }>;
  assert.deepEqual(last.toolCalls, [
    { id: "call_1", name: "f", args: "1.5" },
    { id: "call_2", name: "g", args: "2" },
  ]);
});

// ---------------------------------------------------------------------------
// Errors surface instead of empty streams
// ---------------------------------------------------------------------------

test("an HTTP error body becomes a ProviderError with status and body", async () => {
  await withFakeFetch(
    () => new Response(JSON.stringify({ error: { message: "Model not found" } }), { status: 500 }),
    async () => {
      await assert.rejects(
        () => drainRound(baseOptions()),
        (err: unknown) => {
          assert.ok(err instanceof ProviderError, `expected ProviderError, got ${String(err)}`);
          assert.equal(err.status, 500);
          assert.ok((err.body ?? "").includes("Model not found"));
          assert.match(err.message, /HTTP 500/);
          assert.match(err.message, /Model not found/);
          return true;
        },
      );
      return true;
    },
  );
});

test("a non-JSON HTTP error body still surfaces its content", async () => {
  await withFakeFetch(
    () => new Response("<html>502 bad gateway</html>", { status: 502 }),
    async () => {
      await assert.rejects(
        () => drainRound(baseOptions()),
        (err: unknown) => {
          assert.ok(err instanceof ProviderError);
          assert.equal(err.status, 502);
          assert.match(err.message, /bad gateway/);
          return true;
        },
      );
      return true;
    },
  );
});

test("an in-stream error chunk aborts the round mid-stream", async () => {
  const chunks = [
    evt({ choices: [{ index: 0, delta: { content: "partial" } }] }),
    evt({ error: { message: "overloaded" } }),
  ];
  await withFakeFetch(() => sseResponse(chunks), async () => {
    const gen = streamAssistantRound(baseOptions());
    const first = await gen.next();
    assert.equal(first.value?.kind, "text");
    assert.equal(first.value && first.value.kind === "text" ? first.value.delta : "", "partial");
    await assert.rejects(
      () => gen.next(),
      (err: unknown) => {
        assert.ok(err instanceof ProviderError);
        assert.match(err.message, /overloaded/);
        return true;
      },
    );
  });
});

test("an empty response body is an error, not a silent round", async () => {
  await withFakeFetch(
    () => sseResponse([]),
    async () => {
      await assert.rejects(() => drainRound(baseOptions()), /empty response body/);
      return true;
    },
  );
});

test("a provider that ignores stream:true gets its JSON body ingested", async () => {
  const body = {
    choices: [
      {
        message: {
          role: "assistant",
          content: "full answer",
          tool_calls: [{ id: "call_z", type: "function", function: { name: "list_dir", arguments: "{}" } }],
        },
      },
    ],
    usage: { prompt_tokens: 5, completion_tokens: 2 },
  };
  const events = await withFakeFetch(
    () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }),
    () => drainRound(baseOptions()),
  );
  assert.deepEqual(events.filter((e) => e.kind === "text").map((e) => (e.kind === "text" ? e.delta : "")), ["full answer"]);
  const last = events[events.length - 1] as Extract<ProviderStreamEvent, { kind: "round_complete" }>;
  assert.deepEqual(last.toolCalls, [{ id: "call_z", name: "list_dir", args: "{}" }]);
  // Non-streaming bodies carry no finish_reason, so incomplete reads true —
  // pinned as current behaviour.
  assert.equal(last.incomplete, true);
});

// ---------------------------------------------------------------------------
// Abort
// ---------------------------------------------------------------------------

test("aborting mid-stream rejects with ProviderAbortedError", async () => {
  const first = evt({ choices: [{ index: 0, delta: { content: "part one" } }] });
  const { res, ac } = abortableSseResponse(first);
  await withFakeFetch(() => res, async () => {
    const gen = streamAssistantRound({ ...baseOptions(), signal: ac.signal });
    const delta = await gen.next();
    assert.equal(delta.value && delta.value.kind === "text" ? delta.value.delta : "", "part one");
    ac.abort();
    await assert.rejects(
      () => gen.next(),
      (err: unknown) => {
        assert.ok(err instanceof ProviderAbortedError, `expected ProviderAbortedError, got ${String(err)}`);
        assert.ok(err instanceof ProviderError, "abort is a ProviderError subclass");
        return true;
      },
    );
    return true;
  });
});

test("an already-aborted signal fails before any stream is read", async () => {
  const ac = new AbortController();
  ac.abort();
  await withFakeFetch(
    () => {
      throw new Error("fetch must not even be reached meaningfully");
    },
    async () => {
      await assert.rejects(() => drainRound({ ...baseOptions(), signal: ac.signal }), ProviderAbortedError);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// Request shape
// ---------------------------------------------------------------------------

test("the request is a streaming chat completion with tools and auth", async () => {
  const tools: EngineTool[] = [
    { name: "echo_tool", description: "echoes", parameters: { type: "object", properties: {} }, execute: async () => "ok" },
  ];
  await withFakeFetch(() => sseResponse([evt({ choices: [{ index: 0, delta: {} }] }), "data: [DONE]\n\n"]), async (calls) => {
    await drainRound(baseOptions({ baseUrl: "http://provider.test/v1/", tools, effort: "high" }));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://provider.test/v1/chat/completions", "trailing slashes collapse");
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer sk-test");
    const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
    assert.equal(body.model, "test-model");
    assert.equal(body.stream, true);
    assert.deepEqual(body.stream_options, { include_usage: true });
    assert.deepEqual(body.tools, [
      { type: "function", function: { name: "echo_tool", description: "echoes", parameters: { type: "object", properties: {} } } },
    ]);
    assert.equal(body.tool_choice, "auto");
    assert.equal(body.reasoning_effort, "high");
    return true;
  });
});

test("an empty tool list omits the tools key entirely", async () => {
  await withFakeFetch(() => sseResponse([evt({ choices: [{ index: 0, delta: {} }] }), "data: [DONE]\n\n"]), async (calls) => {
    await drainRound(baseOptions());
    const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
    assert.equal("tools" in body, false, "some proxies 400 on tools: []");
    assert.equal("tool_choice" in body, false);
    return true;
  });
});

test("a 400 rejecting stream_options is retried once without it", async () => {
  await withFakeFetch(
    (call, i) =>
      i === 0
        ? new Response(JSON.stringify({ error: { message: "Unknown parameter: 'stream_options'." } }), { status: 400 })
        : sseResponse([evt({ choices: [{ index: 0, delta: { content: "ok" } }] }), "data: [DONE]\n\n"]),
    async (calls) => {
      const events = await drainRound(baseOptions());
      assert.equal(calls.length, 2, "exactly one retry");
      const first = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
      const second = JSON.parse(String(calls[1].init.body)) as Record<string, unknown>;
      assert.ok("stream_options" in first);
      assert.equal("stream_options" in second, false);
      assert.deepEqual(events.filter((e) => e.kind === "text").map((e) => (e.kind === "text" ? e.delta : "")), ["ok"]);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// The turn loop: one assistant_end per assistant message, in canonical order
// ---------------------------------------------------------------------------

const echoTool: EngineTool = {
  name: "echo_tool",
  description: "echoes its args",
  parameters: { type: "object", properties: { shout: { type: "boolean" } } },
  execute: async () => "tool ran fine",
};

const ROUND1: string[] = [
  evt({ choices: [{ index: 0, delta: { reasoning_content: "checking the file" } }] }),
  evt({ choices: [{ index: 0, delta: { content: "Let me look." } }] }),
  evt({
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            { index: 0, id: "call_1", type: "function", function: { name: "echo_tool", arguments: '{"shout":true}' } },
          ],
        },
      },
    ],
  }),
  evt({
    choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
    usage: { prompt_tokens: 100, completion_tokens: 20 },
  }),
  "data: [DONE]\n\n",
];

const ROUND2: string[] = [
  evt({ choices: [{ index: 0, delta: { content: "All done." } }] }),
  evt({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 50, completion_tokens: 10 } }),
  "data: [DONE]\n\n",
];

test("the turn loop emits exactly one assistant_end per assistant message, tool events between rounds", async () => {
  await withFakeFetch((_call, i) => sseResponse(i === 0 ? ROUND1 : ROUND2), async (calls) => {
    const events: TurnStreamEvent[] = [];
    for await (const event of streamProviderTurn({
      ...baseOptions(),
      cwd: ".",
      tools: [echoTool],
    })) {
      events.push(event);
    }

    assert.deepEqual(
      kinds(events),
      [
        "reasoning", "text", "assistant_end", "usage",
        "tool_start", "tool_end",
        "text", "assistant_end", "usage",
        "turn_complete",
      ],
      "assistant_end precedes the round's tool_start; one per assistant message",
    );
    assert.equal(assistantEnds(events as ProviderStreamEvent[]).length, 2);

    const firstEnd = events[2] as Extract<TurnStreamEvent, { kind: "assistant_end" }>;
    assert.deepEqual(firstEnd.blocks, [
      { type: "thinking", text: "checking the file" },
      { type: "text", text: "Let me look." },
    ]);

    const toolStart = events[4] as Extract<TurnStreamEvent, { kind: "tool_start" }>;
    assert.equal(toolStart.toolName, "echo_tool");
    assert.equal(toolStart.args, '{"shout":true}', "tool_start carries the complete argument string");

    const toolEnd = events[5] as Extract<TurnStreamEvent, { kind: "tool_end" }>;
    assert.equal(toolEnd.toolName, "echo_tool");
    assert.equal(toolEnd.result, "tool ran fine");
    assert.equal(toolEnd.isError, false);

    const complete = events[events.length - 1] as Extract<TurnStreamEvent, { kind: "turn_complete" }>;
    assert.deepEqual(complete.result.newMessages, [
      {
        role: "assistant",
        content: "Let me look.",
        tool_calls: [{ id: "call_1", type: "function", function: { name: "echo_tool", arguments: '{"shout":true}' } }],
      },
      { role: "tool", tool_call_id: "call_1", content: "tool ran fine" },
      { role: "assistant", content: "All done." },
    ]);
    assert.deepEqual(complete.result.usage, { input: 150, output: 30 }, "usage accumulates across rounds");
    assert.equal(complete.result.rounds, 2);
    assert.equal(complete.result.finishReason, "stop");

    // The follow-up round must carry the assistant tool call and its result,
    // and must NOT replay reasoning_content (DeepSeek rejects it).
    assert.equal(calls.length, 2);
    const second = JSON.parse(String(calls[1].init.body)) as { messages: Array<Record<string, unknown>> };
    assert.equal(second.messages.length, 3);
    assert.deepEqual(second.messages[1].tool_calls, [
      { id: "call_1", type: "function", function: { name: "echo_tool", arguments: '{"shout":true}' } },
    ]);
    assert.equal(second.messages[1].content, "Let me look.");
    assert.equal("reasoning_content" in second.messages[1], false);
    assert.deepEqual(second.messages[2], { role: "tool", tool_call_id: "call_1", content: "tool ran fine" });
    return true;
  });
});

test("a call for an unknown tool resolves as an error tool_end and the turn continues", async () => {
  await withFakeFetch((_call, i) => sseResponse(i === 0 ? ROUND1 : ROUND2), async () => {
    const events: TurnStreamEvent[] = [];
    for await (const event of streamProviderTurn({ ...baseOptions(), cwd: ".", tools: [] })) {
      events.push(event);
    }
    const toolEnd = events.find((e): e is Extract<TurnStreamEvent, { kind: "tool_end" }> => e.kind === "tool_end");
    assert.ok(toolEnd);
    assert.equal(toolEnd.isError, true);
    assert.match(toolEnd.result, /Unknown tool: echo_tool/);
    const complete = events[events.length - 1] as Extract<TurnStreamEvent, { kind: "turn_complete" }>;
    assert.deepEqual(complete.result.newMessages[1], {
      role: "tool",
      tool_call_id: "call_1",
      content: "Unknown tool: echo_tool",
    });
    return true;
  });
});

test("runProviderTurn forwards every StreamEvent through onEvent and returns the result", async () => {
  await withFakeFetch((_call, i) => sseResponse(i === 0 ? ROUND1 : ROUND2), async () => {
    const seen: { kind: string }[] = [];
    const result = await runProviderTurn({
      ...baseOptions(),
      cwd: ".",
      tools: [echoTool],
      onEvent: (event) => seen.push(event),
    });
    assert.equal(result.rounds, 2);
    assert.deepEqual(result.usage, { input: 150, output: 30 });
    assert.equal(seen.some((e) => e.kind === "turn_complete"), false, "turn_complete is not an onEvent event");
    assert.equal(seen.filter((e) => e.kind === "assistant_end").length, 2);
    return true;
  });
});
