/*
 * REFERENCE trace mapping: StreamEvent[] → Trace rows.
 *
 * As of this writing NOTHING in src/ imports src/components/ui/trace.tsx yet —
 * the renderer consumer of the new engine events does not exist. These tests
 * pin the contract that consumer must satisfy, using this pure, dependency-free
 * reference implementation as the executable spec. When the real module lands,
 * point trace-mapping.test.ts at it; the assertions are written against
 * behavior (rows, statuses, open state), not against these internals.
 *
 * The policy encoded here comes from the engine contract
 * (electron/agent/engine.ts) and the design rules:
 *
 *   - reasoning deltas coalesce into ONE thinking row per assistant message.
 *     The row runs while reasoning is the live activity and finishes (folds)
 *     as soon as the message moves on — a text delta arrives, a tool starts,
 *     or the message completes.
 *   - assistant_end repairs the message's rows against the canonical blocks:
 *     fragmented reasoning that produced several thinking rows is merged into
 *     one row with the canonical text, a message that streamed no reasoning
 *     but carries a thinking block gets its row, and whitespace-only
 *     reasoning rows (which the canonical blocks drop) are removed.
 *   - tool_start opens a tool row with status "running" carrying the complete
 *     argument string; tool_end resolves it to finished (no status) or
 *     "error" and swaps the detail to the result.
 *   - a row is open while it is running, and folds when finished — UNLESS the
 *     user clicked it. The user's click wins over the default policy, in both
 *     directions, and survives subsequent events.
 *   - text deltas accumulate the response text; assistant_end replaces it
 *     with that message's canonical text block (which repairs fragmented
 *     streams — the reasoning/F/ORK-OK case) and marks the message boundary so
 *     the next message's text starts fresh.
 *   - response text is NOT a trace row; it renders as the message body.
 *     usage events produce no rows.
 */
import type { StreamEvent } from "../electron/agent/engine.ts";

export interface TraceRowSpec {
  /** Stable identity across events, so clicks survive re-renders. */
  key: string;
  kind: "thinking" | "tool";
  /** Full sentence — it is the accessible name of the Trace line. */
  title: string;
  /** Collapsible body: reasoning text, or args while running / result after. */
  detail: string;
  /** Absent = finished. The Trace line treats absent as "done". */
  status?: "running" | "error";
  /** Collapsible open state: default policy with user clicks winning. */
  open: boolean;
}

export interface TraceModel {
  rows: TraceRowSpec[];
  responseText: string;
}

export interface TraceMapper {
  apply(event: StreamEvent): void;
  /** The user clicked a row's trigger: toggle it and remember the choice. */
  click(key: string): void;
  model(): TraceModel;
}

export function createTraceMapper(): TraceMapper {
  const userOpen = new Map<string, boolean>();
  const rows: TraceRowSpec[] = [];
  let responseText = "";
  // Set by assistant_end: the next text delta starts a new assistant message
  // and must replace, not append to, the previous message's text.
  let atMessageBoundary = true;
  // Index into rows where the current assistant message's own rows begin;
  // assistant_end repairs exactly that slice against the canonical blocks.
  let messageStart = 0;
  let thinkingCount = 0;
  let toolCount = 0;
  // The thinking row still receiving deltas for the current message.
  let liveThinking: TraceRowSpec | null = null;

  const finishThinking = (): void => {
    if (liveThinking) {
      liveThinking.status = undefined;
      liveThinking = null;
    }
  };

  return {
    apply(event: StreamEvent): void {
      switch (event.kind) {
        case "reasoning": {
          if (!liveThinking) {
            liveThinking = {
              key: `thinking-${thinkingCount++}`,
              kind: "thinking",
              title: "Thinking",
              detail: event.delta,
              status: "running",
              open: true,
            };
            rows.push(liveThinking);
          } else {
            liveThinking.detail += event.delta;
          }
          break;
        }
        case "text": {
          finishThinking();
          responseText = atMessageBoundary ? event.delta : responseText + event.delta;
          atMessageBoundary = false;
          break;
        }
        case "tool_start": {
          finishThinking();
          rows.push({
            key: `tool-${toolCount++}`,
            kind: "tool",
            title: event.toolName,
            detail: event.args,
            status: "running",
            open: true,
          });
          break;
        }
        case "tool_end": {
          // tool_start always precedes tool_end for the same call; match the
          // most recent still-running row with the same tool name.
          const row = [...rows]
            .reverse()
            .find((r) => r.kind === "tool" && r.title === event.toolName && r.status === "running");
          if (row) {
            row.status = event.isError ? "error" : undefined;
            row.detail = event.result;
          }
          break;
        }
        case "assistant_end": {
          finishThinking();
          // The canonical blocks are the truth for this message. Rows created
          // during the stream can disagree with them (a provider interleaving
          // reasoning and text fragments produces several thinking rows), so
          // assistant_end repairs them: merge this message's thinking rows
          // into one row carrying the canonical text, create one if none
          // streamed, and drop them if the canonical message has no thinking.
          const inMessage = rows.slice(messageStart);
          const thinkingRows = inMessage.filter((r) => r.kind === "thinking");
          const canonicalThinking = event.blocks.find((block) => block.type === "thinking")?.text ?? "";
          if (canonicalThinking !== "") {
            const keep = thinkingRows[0];
            if (keep) {
              keep.detail = canonicalThinking;
              keep.status = undefined;
              for (const extra of thinkingRows.slice(1)) {
                const index = rows.indexOf(extra);
                if (index >= 0) rows.splice(index, 1);
              }
            } else {
              rows.push({
                key: `thinking-${thinkingCount++}`,
                kind: "thinking",
                title: "Thinking",
                detail: canonicalThinking,
                status: undefined,
                open: false,
              });
            }
          } else {
            for (const stale of thinkingRows) {
              const index = rows.indexOf(stale);
              if (index >= 0) rows.splice(index, 1);
            }
          }
          responseText = event.blocks
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("\n\n");
          atMessageBoundary = true;
          messageStart = rows.length;
          break;
        }
        case "usage":
          break;
      }
    },

    click(key: string): void {
      const row = rows.find((r) => r.key === key);
      if (!row) return;
      userOpen.set(key, !(userOpen.get(key) ?? row.status === "running"));
    },

    model(): TraceModel {
      return {
        responseText,
        rows: rows.map((row) => ({
          ...row,
          open: userOpen.get(row.key) ?? row.status === "running",
        })),
      };
    },
  };
}

/** Feed a whole event list; useful for building finished turns in tests. */
export function mapEvents(events: StreamEvent[]): TraceMapper {
  const mapper = createTraceMapper();
  for (const event of events) mapper.apply(event);
  return mapper;
}
