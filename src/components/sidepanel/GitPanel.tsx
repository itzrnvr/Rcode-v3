/*
 * PURPOSE: Review tab — git working tree in the One UI language.
 *
 * Structure ported from the prototype's ReviewPaneMock: a summary card
 * (branch + changes), quiet file rows with status chips, a rounded commit
 * field and two bordered pill actions — all fed by the real git IPC
 * (electron/ipc/git.ts): gitStatus / gitCommit / gitPush. Status chips keep
 * the three real states the porcelain codes carry: modified (warning), added
 * (success), deleted (danger).
 */

import { useEffect, useState, useCallback } from "react";
import { api } from "../../api/client";
import { RefreshIcon, GitForkIcon, FolderIcon } from "../common/Icons";

interface GitStatus { branch: string; added: number; deleted: number; files: Array<{ path: string; status: string }> }

const STATUS_COLOR: Record<string, string> = {
  M: "var(--color-warning)",
  A: "var(--color-success)",
  D: "var(--color-danger)",
  U: "var(--color-success)",
};

function statusColor(status: string): string {
  if (status.includes("D")) return STATUS_COLOR.D;
  if (status === "??" || status.includes("A")) return STATUS_COLOR.A;
  return STATUS_COLOR.M;
}

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

  const pill =
    "flex h-10 flex-1 items-center justify-center rounded-full border border-[var(--color-border)] text-ui-sm font-medium transition-colors duration-200 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:pointer-events-none disabled:opacity-50";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-11 shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-3">
        <span className="min-w-0 flex-1 truncate text-ui-sm font-medium text-[var(--color-fg)]">
          Review
        </span>
        <span className="shrink-0 font-mono text-ui-xs text-[var(--color-foreground-subtlest)]">
          {st?.branch ?? "…"}
        </span>
        <button className="sp-iconbtn" title="Refresh" onClick={load} aria-label="Refresh git status">
          <RefreshIcon size={14} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-2 px-3 py-3">
          <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
            <div className="flex min-h-11 items-center gap-2.5 px-3">
              <GitForkIcon size={15} className="shrink-0 text-[var(--color-foreground-subtle)]" />
              <span className="min-w-0 flex-1 truncate text-ui-sm text-[var(--color-fg)]">
                {st?.branch ?? "…"}
              </span>
            </div>
            <div className="flex min-h-11 items-center gap-2.5 border-t border-[color-mix(in_srgb,var(--color-border)_70%,transparent)] px-3">
              <FolderIcon size={15} className="shrink-0 text-[var(--color-foreground-subtle)]" />
              <span className="min-w-0 flex-1 truncate text-ui-sm text-[var(--color-fg)]">
                Changes
              </span>
              <span className="shrink-0 font-mono text-ui-xs tabular-nums text-[var(--color-success)]">
                +{st?.added ?? 0}
              </span>
              <span className="shrink-0 font-mono text-ui-xs tabular-nums text-[var(--color-danger)]">
                −{st?.deleted ?? 0}
              </span>
            </div>
          </div>

          <div className="flex flex-col">
            {(st?.files ?? []).length === 0 && (
              <div className="px-2 py-2 text-ui-xs text-[var(--color-foreground-subtlest)]">
                Working tree clean.
              </div>
            )}
            {(st?.files ?? []).map((f, i) => (
              <div
                key={i}
                className="flex min-h-10 items-center gap-2.5 rounded-[var(--radius-sm)] px-2"
                title={f.status}
              >
                <span
                  className="flex size-5 shrink-0 items-center justify-center rounded-[var(--radius-sm)] font-mono text-ui-xs font-semibold"
                  style={{
                    color: statusColor(f.status),
                    background: `color-mix(in srgb, ${statusColor(f.status)} 14%, transparent)`,
                  }}
                >
                  {f.status === "??" ? "U" : f.status.slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-ui-xs text-[var(--color-fg)]">
                  {f.path}
                </span>
              </div>
            ))}
          </div>

          <input
            value={msg}
            onChange={e => setMsg(e.target.value)}
            placeholder="Commit message"
            aria-label="Commit message"
            className="h-10 shrink-0 rounded-full border border-[var(--color-input-border)] bg-[var(--color-surface)] px-4 text-ui-sm text-[var(--color-fg)] outline-none transition-colors duration-200 placeholder:text-[var(--color-foreground-subtlest)] focus-visible:border-[var(--color-input-border-hover)]"
          />
          <div className="flex gap-2">
            <button
              type="button"
              className={`${pill} text-[var(--color-fg)] hover:border-[var(--color-border-hover)] hover:bg-[var(--color-hover)]`}
              disabled={busy != null}
              onClick={() => act("commit")}
            >
              {busy === "commit" ? "Committing…" : "Commit"}
            </button>
            <button
              type="button"
              className={`${pill} text-[var(--color-foreground-subtle)] hover:border-[var(--color-border-hover)] hover:bg-[var(--color-hover)] hover:text-[var(--color-fg)]`}
              disabled={busy != null}
              onClick={() => act("push")}
            >
              {busy === "push" ? "Pushing…" : "Push"}
            </button>
          </div>
          {note && (
            <div className="font-mono text-ui-xs text-[var(--color-foreground-subtlest)]">{note}</div>
          )}
        </div>
      </div>
    </div>
  );
}
