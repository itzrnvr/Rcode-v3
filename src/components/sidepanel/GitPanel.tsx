/*
 * PURPOSE: Rcode Git tools widget for the Review tab.
 * Shows branch, color-coded +added/−deleted, changed files, and
 * Refresh / Commit / Push actions backed by electron/ipc/git.ts.
 */

import { useEffect, useState, useCallback } from "react";
import { api } from "../../api/client";
import { RefreshIcon, GitForkIcon, FolderIcon } from "../common/Icons";

interface GitStatus { branch: string; added: number; deleted: number; files: Array<{ path: string; status: string }> }

export function GitPanel() {
  const [st, setSt] = useState<GitStatus | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try { setSt(await (api as unknown as { gitStatus: () => Promise<GitStatus> }).gitStatus()); } catch { setSt(null); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (kind: "commit" | "push") => {
    setBusy(kind);
    setNote("");
    try {
      const a = api as unknown as { gitCommit: (m: string) => Promise<{ ok: boolean; out: string }>; gitPush: () => Promise<{ ok: boolean; out: string }> };
      const r = kind === "commit" ? await a.gitCommit(msg) : await a.gitPush();
      setNote(r.out.split("\n")[0] || "done");
      await load();
    } catch (e) {
      setNote(String((e as Error)?.message ?? e).slice(0, 120));
    }
    setBusy(null);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: "1px solid var(--color-border)" }}>
        <GitForkIcon size={14} />
        <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>Git tools</span>
        <button className="ms-iconbtn" title="Refresh" onClick={load}><RefreshIcon size={13} /></button>
      </div>

      <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", background: "var(--color-surface, #161616)", border: "1px solid var(--color-border)", borderRadius: 10 }}>
          <FolderIcon size={13} />
          <span style={{ fontSize: 12, flex: 1 }}>Changes</span>
          <span style={{ fontSize: 12, color: "#3fb950", fontFamily: "monospace" }}>+{st?.added ?? 0}</span>
          <span style={{ fontSize: 12, color: "#f85149", fontFamily: "monospace" }}>−{st?.deleted ?? 0}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", background: "var(--color-surface, #161616)", border: "1px solid var(--color-border)", borderRadius: 10 }}>
          <GitForkIcon size={13} />
          <span style={{ fontSize: 12, flex: 1 }}>{st?.branch ?? "…"}</span>
        </div>

        <input
          value={msg}
          onChange={e => setMsg(e.target.value)}
          placeholder="Commit message (optional)"
          style={{ background: "#111", border: "1px solid var(--color-border)", borderRadius: 8, color: "var(--color-text, #e8e8e8)", fontSize: 12, padding: "7px 10px", outline: "none" }}
        />
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" style={{ flex: 1 }} disabled={busy != null} onClick={() => act("commit")}>{busy === "commit" ? "Committing…" : "Commit"}</button>
          <button className="btn" style={{ flex: 1 }} disabled={busy != null} onClick={() => act("push")}>{busy === "push" ? "Pushing…" : "Push"}</button>
        </div>
        {note && <div style={{ fontSize: 11, color: "var(--color-foreground-subtle, #8a8a8a)", fontFamily: "monospace" }}>{note}</div>}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "0 12px 12px" }}>
        {(st?.files ?? []).length === 0 && <div style={{ fontSize: 12, color: "var(--color-foreground-subtle, #8a8a8a)", padding: 8 }}>Working tree clean.</div>}
        {(st?.files ?? []).map((f, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 2px", fontSize: 11.5 }}>
            <span style={{
              flex: "none", width: 20, textAlign: "center", borderRadius: 4, fontSize: 9.5, fontWeight: 700,
              color: f.status.includes("D") ? "#f85149" : f.status === "??" || f.status.includes("A") ? "#3fb950" : "#d89a3f",
              background: "#1d1d1d", border: "1px solid #2a2a2a",
            }}>{f.status === "??" ? "U" : f.status.slice(0, 1)}</span>
            <span style={{ fontFamily: "monospace", color: "#c8c8c8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.path}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
