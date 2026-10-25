/*
 * PURPOSE: Live registry of sessions with a turn in flight
 *
 * useChat knows when a session's turn begins and ends (beginTurn, endTurn,
 * stopStream) but that state lives inside each chat view's own hook instance,
 * so the sidebar cannot see it — and it must not come from the backend: the
 * database has no "running" column and a turn is UI-level transience. Both
 * sides meet in this tiny module instead: useChat marks the session when its
 * turn begins and clears the mark when the turn ends, whatever way it ends,
 * and the sidebar reads the mark per row through useRunningTurn, so a turn
 * starting or ending re-renders only that session's row.
 *
 * CONSUMERS: state/useChat.ts (publishes), components/sessions/SessionList.tsx (subscribes)
 */

import { useSyncExternalStore } from "react";

type Listener = () => void;

const running = new Set<string>();
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Mark a session as having a turn in flight. Marking twice is a no-op. */
export function beginRunningTurn(sessionId: string): void {
  if (running.has(sessionId)) return;
  running.add(sessionId);
  emit();
}

/** Clear a session's in-flight mark. Clearing twice is a no-op. */
export function endRunningTurn(sessionId: string): void {
  if (!running.delete(sessionId)) return;
  emit();
}

export function isRunningTurn(sessionId: string): boolean {
  return running.has(sessionId);
}

export function subscribeRunningTurns(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether the session currently has a turn in flight, live. */
export function useRunningTurn(sessionId: string): boolean {
  return useSyncExternalStore(subscribeRunningTurns, () => isRunningTurn(sessionId));
}
