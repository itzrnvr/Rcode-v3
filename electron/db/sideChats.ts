/*
 * PURPOSE: Side chat + tabs repository — all SQL for side_chat_tabs table and
 *          side chat session creation/promotion operations
 *
 * KEY DECISIONS:
 * - createSideChat: atomically creates the side chat session + a tab linking it to parent
 * - promoteSideChat: converts side_chat → main session, removes the linking tab
 * - Closed tabs stay in DB (is_closed=1) so they can be reopened
 * - Tab order managed explicitly via reorderSideChatTabs
 *
 * CONSUMERS: ipc/sideChats.ts
 */

import { randomUUID } from "crypto";
import { getDb } from "./index";
import { createSession, getSession } from "./sessions";

import type { SideChatTab, CreateSideChatInput } from "../../src/types";
import type { Session } from "../../src/types";

interface TabRow {
  id: string;
  parent_session_id: string;
  side_chat_id: string;
  tab_order: number;
  is_closed: number;
  created_at: number;
  side_chat_title: string;
  side_chat_status: string;
}

function tabRowToSideChatTab(row: TabRow): SideChatTab {
  return {
    id: row.id,
    parentSessionId: row.parent_session_id,
    sideChatId: row.side_chat_id,
    tabOrder: row.tab_order,
    isClosed: row.is_closed === 1,
    createdAt: row.created_at,
    sideChatTitle: row.side_chat_title,
    sideChatStatus: row.side_chat_status as SideChatTab["sideChatStatus"],
    sideChatDepth: 0,
  };
}

export function createSideChat(input: CreateSideChatInput): { session: Session; tab: SideChatTab } {
  const db = getDb();
  const parent = getSession(input.parentSessionId);
  if (!parent) throw new Error("Parent session not found");

  const session = createSession({
    parentId: input.parentSessionId,
    title: input.title ?? "Side chat",
    taskType: "side_chat",
    model: input.model ?? parent.model,
    provider: input.provider ?? parent.provider,
  });

  // Fork semantics: copy the parent's history so the side chat is a true branch,
  // not a fresh empty chat.
  const rows = db.prepare("SELECT role, content, versions, version_index FROM messages WHERE session_id = ? ORDER BY created_at, id").all(input.parentSessionId) as Array<{ role: string; content: string; versions: string | null; version_index: number | null }>;
  const insMsg = db.prepare("INSERT INTO messages (session_id, role, content, versions, version_index, created_at) VALUES (?, ?, ?, ?, ?, ?)");
  for (const r of rows) insMsg.run(session.id, r.role, r.content, r.versions ?? "[]", r.version_index ?? 0, Date.now());

  const tabId = randomUUID();
  const now = Date.now();
  const countRow = db.prepare("SELECT COUNT(*) as c FROM side_chat_tabs WHERE parent_session_id = ?").get(input.parentSessionId) as { c: number };
  const tabOrder = countRow.c;

  db.prepare("INSERT INTO side_chat_tabs (id, parent_session_id, side_chat_id, tab_order, is_closed, created_at) VALUES (?, ?, ?, ?, 0, ?)")
    .run(tabId, input.parentSessionId, session.id, tabOrder, now);

  const tab: SideChatTab = {
    id: tabId,
    parentSessionId: input.parentSessionId,
    sideChatId: session.id,
    tabOrder,
    isClosed: false,
    createdAt: now,
    sideChatTitle: session.title,
    sideChatStatus: session.status,
    sideChatDepth: session.depth,
  };

  return { session, tab };
}

export function getSideChatTabs(parentSessionId: string, includeClosed = false): SideChatTab[] {
  const db = getDb();
  const query = includeClosed
    ? `SELECT t.*, s.title as side_chat_title, s.status as side_chat_status
       FROM side_chat_tabs t JOIN sessions s ON t.side_chat_id = s.id
       WHERE t.parent_session_id = ? ORDER BY t.tab_order ASC`
    : `SELECT t.*, s.title as side_chat_title, s.status as side_chat_status
       FROM side_chat_tabs t JOIN sessions s ON t.side_chat_id = s.id
       WHERE t.parent_session_id = ? AND t.is_closed = 0 AND s.status = 'active'
       ORDER BY t.tab_order ASC`;

  const rows = db.prepare(query).all(parentSessionId) as TabRow[];
  return rows.map(tabRowToSideChatTab);
}

export function getClosedSideChats(parentSessionId: string): SideChatTab[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT t.*, s.title as side_chat_title, s.status as side_chat_status
    FROM side_chat_tabs t JOIN sessions s ON t.side_chat_id = s.id
    WHERE t.parent_session_id = ? AND t.is_closed = 1 AND s.status = 'active'
    ORDER BY t.created_at DESC
  `).all(parentSessionId) as TabRow[];
  return rows.map(tabRowToSideChatTab);
}

/**
 * Close and reopen a side chat.
 *
 * The id these take is the SIDE CHAT's session id, not the side_chat_tabs row
 * id - every caller passes the side chat id (the panel's tab id is the
 * sideChatId, and promoteSideChat below already matches on side_chat_id).
 * The updates used to match on the row id instead, so they silently matched
 * nothing: closing a side chat from the panel removed its pill for the rest
 * of the session and the pill came straight back on the next refresh.
 */
export function closeSideChatTab(sideChatId: string): void {
  getDb().prepare("UPDATE side_chat_tabs SET is_closed = 1 WHERE side_chat_id = ?").run(sideChatId);
}

export function reopenSideChatTab(sideChatId: string): void {
  getDb().prepare("UPDATE side_chat_tabs SET is_closed = 0 WHERE side_chat_id = ?").run(sideChatId);
}

export function promoteSideChat(sideChatId: string): void {
  const db = getDb();
  db.prepare("UPDATE sessions SET task_type = 'main', parent_id = NULL, status = 'active', updated_at = ? WHERE id = ?")
    .run(Date.now(), sideChatId);
  db.prepare("DELETE FROM side_chat_tabs WHERE side_chat_id = ?").run(sideChatId);
}

export function reorderSideChatTabs(parentSessionId: string, tabIds: string[]): void {
  const db = getDb();
  const stmt = db.prepare("UPDATE side_chat_tabs SET tab_order = ? WHERE id = ? AND parent_session_id = ?");
  for (let i = 0; i < tabIds.length; i++) {
    stmt.run(i, tabIds[i], parentSessionId);
  }
}
