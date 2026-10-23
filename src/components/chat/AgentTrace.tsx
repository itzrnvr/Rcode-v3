/*
 * PURPOSE: The assistant turn's trace — what the agent did before it answered.
 *
 * The work stays quiet: it folds into one summary row above the answer
 * ("Worked for 38s · 4 steps"), and each step expands only on demand to its
 * output. While the turn is still streaming, the step that is producing
 * output opens itself and folds again when it finishes; once the answer
 * starts arriving the whole trace folds away so it never competes with the
 * answer text. A click on any row records the reader's choice and wins over
 * the automatic behaviour in both directions — the choice lives in state that
 * starts undefined and is passed as `open={choice ?? automatic}`.
 *
 * Props match AgentTurnView one for one, so the two are interchangeable at
 * the call site in AgentMessage. AgentTurnView is no longer mounted anywhere;
 * this component replaced it.
 *
 * Liveness is derived from the events themselves, not from the `streaming`
 * prop alone: ChatView marks every message as streaming while any turn runs,
 * so a persisted turn must not shimmer or auto-open just because a later turn
 * is active. Live turns carry markers on their events (the LiveStep `status`
 * and `bornAt` fields useChat sets); persisted turns do not.
 */

import { Fragment, useState } from "react";

import { MessageResponse } from "@/components/ai-elements/message";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";

import {
  FileTextIcon,
  FolderIcon,
  PenIcon,
  SearchIcon,
  TerminalIcon,
} from "../common/Icons";

import { splitFinalResponse } from "@/lib/agentTurn";
import type { AgentTurn, AgentTurnEvent, LiveStep } from "../../types";

/* One specific mark per tool, like the prototype's quiet tool line: the icon
 * names the kind of work, the title names the target. No sparkle, no robot. */
const TOOL_ICONS: Record<string, React.FC<{ size?: number; className?: string }>> = {
  read_file: FileTextIcon,
  write_file: PenIcon,
  edit_file: PenIcon,
  list_dir: FolderIcon,
  grep: SearchIcon,
  shell: TerminalIcon,
};

type ToolStep = {
  id: string;
  kind: "tool";
  name: string;
  args?: string;
  result?: string;
  isError: boolean;
  /** Live and still executing: opens itself, shimmers, has no output yet. */
  running: boolean;
  /** Dangling call in a persisted turn — the turn never finished it. */
  pending: boolean;
};

type ReasoningStep = {
  id: string;
  kind: "reasoning";
  text: string;
  running: boolean;
};

/** Interim assistant prose between tool calls; the answer itself is not a step. */
type ProseStep = {
  id: string;
  kind: "prose";
  text: string;
};

type TraceStep = ToolStep | ReasoningStep | ProseStep;

/** A live turn marks its events; a persisted turn carries none of these. */
function isLiveMarked(event: AgentTurnEvent): boolean {
  const live = event as LiveStep;
  return live.status === "running" || typeof live.bornAt === "number";
}

/**
 * Pair each tool_call with its result. Calls and results arrive in order but
 * not strictly interleaved, so a result matches the first still-open call
 * with the same name, falling back to the oldest open call. A result with no
 * open call becomes its own row rather than being dropped.
 */
function buildSteps(events: readonly AgentTurnEvent[]): TraceStep[] {
  const steps: TraceStep[] = [];
  const open: ToolStep[] = [];

  events.forEach((event, index) => {
    if (event.kind === "tool_call") {
      const running = (event as LiveStep).status === "running";
      const step: ToolStep = {
        id: `step-${index}`,
        kind: "tool",
        name: event.name,
        args: event.args,
        isError: false,
        running,
        pending: !running,
      };
      steps.push(step);
      open.push(step);
      return;
    }

    if (event.kind === "tool_result") {
      const match = open.find(step => step.name === event.name) ?? open[0];
      if (match) {
        match.result = event.result;
        match.isError = Boolean(event.isError);
        match.running = false;
        match.pending = false;
        open.splice(open.indexOf(match), 1);
      } else {
        steps.push({
          id: `step-${index}`,
          kind: "tool",
          name: event.name,
          result: event.result,
          isError: Boolean(event.isError),
          running: false,
          pending: false,
        });
      }
      return;
    }

    if (event.kind === "reasoning") {
      steps.push({ id: `step-${index}`, kind: "reasoning", text: event.text, running: false });
      return;
    }

    steps.push({ id: `step-${index}`, kind: "prose", text: event.text });
  });

  // Reasoning grows while it is the newest event of a live turn; a reasoning
  // step from a persisted turn is already finished.
  const lastStep = steps[steps.length - 1];
  const lastEvent = events[events.length - 1] as LiveStep | undefined;
  if (
    lastStep &&
    lastStep.kind === "reasoning" &&
    lastEvent?.kind === "reasoning" &&
    typeof lastEvent.bornAt === "number"
  ) {
    lastStep.running = true;
  }

  return steps;
}

/** Verb per tool in the three tenses a row can need. */
const TOOL_VERBS: Record<string, { run: string; done: string; fail: string }> = {
  read_file: { run: "Reading", done: "Read", fail: "read" },
  write_file: { run: "Writing", done: "Wrote", fail: "write" },
  edit_file: { run: "Editing", done: "Edited", fail: "edit" },
  list_dir: { run: "Listing", done: "Listed", fail: "list" },
  grep: { run: "Searching", done: "Searched", fail: "search" },
  shell: { run: "Running", done: "Ran", fail: "run" },
};

/** The argument that names what the tool touched, worded for a title. */
function toolTarget(name: string, args?: string): string {
  if (!args || args.trim() === "") return "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(args);
  } catch {
    return cap(firstLine(args));
  }
  if (typeof parsed !== "object" || parsed === null) return cap(firstLine(args));
  const record = parsed as Record<string, unknown>;
  const pick = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.trim() !== "") return value.trim();
    }
    return undefined;
  };
  const value =
    name === "shell"
      ? pick("command")
      : name === "grep"
        ? pick("pattern")
        : pick("path", "file", "target");
  if (value === undefined) return "";
  if (name === "shell") return cap(firstLine(value), 80);
  if (name === "grep") return `for ${cap(value, 60)}`;
  return shortenPath(value);
}

/** First line of a multi-line string, whitespace collapsed. */
function firstLine(text: string): string {
  return text.split("\n")[0].replace(/\s+/g, " ").trim();
}

function cap(text: string, max = 64): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Deep or absolute paths read as their tail; short and relative ones as-is. */
function shortenPath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length > 3) return `…/${parts.slice(-2).join("/")}`;
  return path;
}

function toolTitle(step: ToolStep): string {
  const unfinished = step.running || step.pending;
  const verbs = TOOL_VERBS[step.name];
  const target = toolTarget(step.name, step.args);
  if (verbs) {
    if (!unfinished && step.isError) {
      return target ? `Failed to ${verbs.fail} ${target}` : `Failed to ${verbs.fail}`;
    }
    return target ? `${unfinished ? verbs.run : verbs.done} ${target}` : unfinished ? verbs.run : verbs.done;
  }
  const label = target ? `${step.name} ${target}` : step.name;
  if (!unfinished && step.isError) return `Failed to run ${label}`;
  return `${unfinished ? "Running" : "Ran"} ${label}`;
}

/** Small right-hand meta: output size for reads and searches, the error itself when it failed. */
function toolDescription(step: ToolStep): string | undefined {
  if (step.running || step.pending) return undefined;
  if (step.isError) return step.result ? cap(firstLine(step.result), 40) : undefined;
  if (!step.result || !["read_file", "list_dir", "grep", "shell"].includes(step.name)) return undefined;
  const lines = step.result.split("\n").length;
  return lines === 1 ? "1 line" : `${lines} lines`;
}

/*
 * Tool results are already capped at 20k characters by the tool surface; a
 * wall of that inside a collapsed-by-default row is still too much DOM, so
 * long output keeps its head and tail and says what was dropped.
 */
const OUTPUT_HEAD = 6000;
const OUTPUT_TAIL = 2000;

function clampOutput(text: string): string {
  if (text.length <= OUTPUT_HEAD + OUTPUT_TAIL) return text;
  const hidden = text.length - OUTPUT_HEAD - OUTPUT_TAIL;
  return `${text.slice(0, OUTPUT_HEAD)}\n[… ${hidden} characters hidden …]\n${text.slice(-OUTPUT_TAIL)}`;
}

/** The model's own first sentence is the honest title for interim prose. */
function proseTitle(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean === "") return "Wrote a note";
  const end = clean.search(/[.!?]/);
  const sentence = end > 0 ? clean.slice(0, end + 1) : clean;
  return cap(sentence, 120);
}

function stepStatus(step: TraceStep): "running" | "error" | "pending" | undefined {
  if (step.kind === "prose") return undefined;
  if (step.running) return "running";
  if (step.kind === "tool") {
    if (step.pending) return "pending";
    if (step.isError) return "error";
  }
  return undefined;
}

function stepTitle(step: TraceStep): string {
  if (step.kind === "tool") return toolTitle(step);
  if (step.kind === "reasoning") return step.running ? "Thinking" : "Thought it through";
  return proseTitle(step.text);
}

function stepMeta(step: TraceStep): string | undefined {
  return step.kind === "tool" ? toolDescription(step) : undefined;
}

function isRunning(step: TraceStep): boolean {
  return step.kind !== "prose" && step.running;
}

/**
 * A row expands only when there is something inside: a tool that is still
 * executing has no output yet and stays a plain line rather than a trigger
 * that opens empty.
 */
function hasDetail(step: TraceStep): boolean {
  if (step.kind === "tool") return step.result !== undefined;
  return step.text.trim() !== "";
}

function StepDetail({ step }: { step: TraceStep }) {
  if (step.kind === "tool") {
    return (
      <pre className="max-h-48 overflow-auto font-mono text-ui-xs leading-relaxed whitespace-pre-wrap wrap-break-word">
        {clampOutput(step.result ?? "")}
      </pre>
    );
  }
  return <p className="text-ui-sm leading-relaxed whitespace-pre-wrap">{step.text}</p>;
}

export function AgentTrace({
  streaming = false,
  turn,
}: {
  streaming?: boolean;
  turn: AgentTurn;
}) {
  const { traceEvents, finalResponse } = splitFinalResponse(turn);
  const steps = buildSteps(traceEvents);

  // One entry per row, starting empty: an absent entry means "no opinion",
  // so `open ?? automatic` keeps the automatic behaviour until the reader
  // clicks, and their click then wins in either direction.
  const [openSteps, setOpenSteps] = useState<Partial<Record<string, boolean>>>({});
  const [summaryOpen, setSummaryOpen] = useState<boolean | undefined>(undefined);

  const liveTurn = turn.events.some(isLiveMarked);
  const hasAnswer = Boolean(finalResponse && finalResponse.text.trim() !== "");
  const active = streaming && liveTurn;
  // The trace stays open while the work is the main event and folds once the
  // answer starts arriving.
  const autoOpen = active && !hasAnswer;

  const answerText = finalResponse ? finalResponse.text : turn.finalContent;
  if (steps.length === 0 && !answerText) return null;

  return (
    <div className="flex w-full min-w-0 flex-col gap-3">
      {steps.length > 0 && (
        <Trace>
          <TraceCollapsible open={summaryOpen ?? autoOpen} onOpenChange={setSummaryOpen}>
            <TraceCollapsibleTrigger>
              <TraceLine status={active ? "running" : undefined}>
                <TraceTitle>{active ? "Working…" : `Worked for ${turn.secs}s`}</TraceTitle>
                <TraceDescription>
                  {steps.length === 1 ? "1 step" : `${steps.length} steps`}
                </TraceDescription>
              </TraceLine>
            </TraceCollapsibleTrigger>
            <TraceCollapsibleContent keepMounted>
              <Trace>
                {steps.map(step => {
                  const detail = hasDetail(step);
                  const ToolIcon = step.kind === "tool" ? TOOL_ICONS[step.name] : undefined;
                  const line = (
                    <TraceLine status={stepStatus(step)}>
                      {ToolIcon && (
                        <TraceIcon>
                          <ToolIcon size={14} className="size-3.5" />
                        </TraceIcon>
                      )}
                      <TraceTitle>{stepTitle(step)}</TraceTitle>
                      {stepMeta(step) ? (
                        <TraceDescription className="min-w-0 max-w-48 truncate">
                          {stepMeta(step)}
                        </TraceDescription>
                      ) : null}
                    </TraceLine>
                  );

                  if (!detail) return <Fragment key={step.id}>{line}</Fragment>;

                  return (
                    <TraceCollapsible
                      key={step.id}
                      open={openSteps[step.id] ?? isRunning(step)}
                      onOpenChange={open =>
                        setOpenSteps(previous => ({ ...previous, [step.id]: open }))
                      }
                    >
                      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
                      <TraceCollapsibleContent>
                        <StepDetail step={step} />
                      </TraceCollapsibleContent>
                    </TraceCollapsible>
                  );
                })}
              </Trace>
            </TraceCollapsibleContent>
          </TraceCollapsible>
        </Trace>
      )}
      {answerText ? (
        <MessageResponse className="rcode-answer">{answerText}</MessageResponse>
      ) : null}
    </div>
  );
}
