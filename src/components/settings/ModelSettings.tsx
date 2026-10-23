/*
 * PURPOSE: Model settings — Rcode model settings.
 *
 * Two-pane layout:
 *   Left: Providers list (built-in + Custom providers) with enabled dot,
 *         Add provider.
 *   Right: selected provider editor — name + rename pencil, Enabled/Disable,
 *         delete; Base URL; API format; API key (eye toggle); Model list rows
 *         (mono id + context badge + vision badge + edit + delete) and an
 *         "Add model" button.
 *
 * Add/Edit model opens a DIALOG (same for editing): Model ID, Context window,
 *         Max output tokens, Input types (Text locked + Image + Video),
 *         Output types (Text locked), Cancel/Save — matching the Rcode settings dialog.
 *
 * Model entries persist inside the provider row's model_list JSON as
 * { id, context?: number, maxOutput?: number, vision?: 0|1, video?: 0|1 }.
 * Legacy string contexts ("128K") are parsed to numbers on load.
 */

import { useState, useEffect, useCallback } from "react";
import { api } from "../../api/client";
import {
  EyeIcon, EyeOffIcon, TrashIcon, EditIcon, PlusIcon, LockIcon, XIcon,
} from "../common/Icons";

interface ProviderModel {
  id: string;
  context?: number | string;
  maxOutput?: number;
  vision?: number;
  video?: number;
}

interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  apiFormat: string;
  apiKey: string;
  modelList: ProviderModel[];
  enabled: number;
  isCustom: number;
  createdAt: number;
}

function contextToNumber(c: number | string | undefined): number {
  if (typeof c === "number") return c;
  if (typeof c === "string") {
    const m = /^([\d.]+)\s*([kKmM])?$/.exec(c.trim());
    if (m) {
      const n = parseFloat(m[1]);
      const mult = m[2] ? (m[2].toLowerCase() === "k" ? 1_000 : 1_000_000) : 1;
      return Math.round(n * mult);
    }
  }
  return 128_000;
}

function formatContext(c: number | string | undefined): string {
  const n = contextToNumber(c);
  if (n >= 1_000_000) return `${Math.round(n / 1_000_000)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

interface ModelDraft {
  id: string;
  context: number;
  maxOutput: number;
  vision: boolean;
  video: boolean;
}

export function ModelSettings() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [dialog, setDialog] = useState<{ mode: "add" } | { mode: "edit"; originalId: string } | null>(null);
  const [draft, setDraft] = useState<ModelDraft>({ id: "", context: 1_000_000, maxOutput: 128_000, vision: false, video: false });

  const load = useCallback(async () => {
    const list = await (api as unknown as { listProviders: () => Promise<Provider[]> }).listProviders();
    setProviders(list);
    if (!selectedId && list.length > 0) setSelectedId(list[0].id);
  }, [selectedId]);

  useEffect(() => { load(); }, [load]);

  const selected = providers.find(p => p.id === selectedId) || null;

  const updateSelected = async (updates: Partial<Provider>) => {
    if (!selected) return;
    await (api as unknown as { updateProvider: (id: string, u: Partial<Provider>) => Promise<void> }).updateProvider(selected.id, updates);
    await load();
  };

  const toggleEnabled = async () => {
    if (!selected) return;
    await (api as unknown as { toggleProvider: (id: string) => Promise<number> }).toggleProvider(selected.id);
    await load();
  };

  const addProvider = async () => {
    const name = `provider-${Date.now().toString(36)}`;
    await (api as unknown as { createProvider: (p: Partial<Provider> & { name: string }) => Promise<Provider> }).createProvider({
      name,
      baseUrl: "http://127.0.0.1:3478/v1",
      apiFormat: "openai-completions",
      apiKey: "",
      modelList: [],
      enabled: 1,
      isCustom: 1,
    });
    await load();
    setSelectedId(name);
  };

  const deleteProvider = async () => {
    if (!selected) return;
    await (api as unknown as { deleteProvider: (id: string) => Promise<void> }).deleteProvider(selected.id);
    setSelectedId(null);
    await load();
  };

  const openAdd = () => {
    setDraft({ id: "", context: 1_000_000, maxOutput: 128_000, vision: false, video: false });
    setDialog({ mode: "add" });
  };

  const openEdit = (m: ProviderModel) => {
    setDraft({
      id: m.id,
      context: contextToNumber(m.context),
      maxOutput: m.maxOutput ?? 128_000,
      vision: !!m.vision,
      video: !!m.video,
    });
    setDialog({ mode: "edit", originalId: m.id });
  };

  const saveDialog = async () => {
    if (!selected || !dialog) return;
    const id = draft.id.trim();
    if (!id) return;
    const entry: ProviderModel = {
      id,
      context: draft.context,
      maxOutput: draft.maxOutput,
      vision: draft.vision ? 1 : 0,
      video: draft.video ? 1 : 0,
    };
    let list: ProviderModel[];
    if (dialog.mode === "add") {
      if (selected.modelList.some(m => m.id === id)) return;
      list = [...selected.modelList, entry];
    } else {
      list = selected.modelList.map(m => (m.id === dialog.originalId ? entry : m));
    }
    await updateSelected({ modelList: list });
    setDialog(null);
  };

  const removeModel = async (mid: string) => {
    if (!selected) return;
    await updateSelected({ modelList: selected.modelList.filter(m => m.id !== mid) });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, height: "100%" }}>
      <div style={{ padding: "20px 28px 12px", color: "var(--color-foreground-subtle)", fontSize: 13 }}>
        Manage custom model providers. Once configured, they can be selected during chat.
      </div>

      <div style={{ flex: 1, display: "flex", minHeight: 0, padding: "0 28px 20px" }}>
        {/* Left: providers */}
        <div style={{ width: 240, borderRight: "1px solid var(--color-border)", paddingRight: 14, overflowY: "auto" }}>
          <div style={{ fontSize: 12, color: "var(--color-foreground-subtle)", padding: "8px 6px" }}>Providers</div>
          {providers.filter(p => !p.isCustom).map(p => (
            <button key={p.id} onClick={() => setSelectedId(p.id)} className="ms-provider-row" style={{ background: selectedId === p.id ? "var(--color-bg-tertiary)" : "transparent" }}>
              <span style={{ flex: 1, textAlign: "left" }}>{p.name}</span>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: p.enabled ? "#22c55e" : "#52525b" }} />
            </button>
          ))}
          <div style={{ fontSize: 12, color: "var(--color-foreground-subtle)", padding: "14px 6px 8px" }}>Custom providers</div>
          {providers.filter(p => p.isCustom).map(p => (
            <button key={p.id} onClick={() => setSelectedId(p.id)} className="ms-provider-row" style={{ background: selectedId === p.id ? "var(--color-bg-tertiary)" : "transparent" }}>
              <span style={{ flex: 1, textAlign: "left" }}>{p.name}</span>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: p.enabled ? "#22c55e" : "#52525b" }} />
            </button>
          ))}
          <button onClick={addProvider} className="ms-provider-row" style={{ color: "var(--color-fg)" }}>
            <PlusIcon size={14} /> <span style={{ textAlign: "left" }}>Add provider</span>
          </button>
        </div>

        {/* Right: editor */}
        <div style={{ flex: 1, paddingLeft: 20, overflowY: "auto" }}>
          {!selected ? (
            <div style={{ color: "var(--color-foreground-subtle)", marginTop: 40, textAlign: "center" }}>Select a provider</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 720 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {renaming ? (
                  <input
                    autoFocus
                    className="ms-input"
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onBlur={async () => { if (renameValue.trim()) await updateSelected({ name: renameValue.trim() }); setRenaming(false); }}
                    onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                    style={{ width: 180 }}
                  />
                ) : (
                  <>
                    <span style={{ fontSize: 16, fontWeight: 700 }}>{selected.name}</span>
                    <button className="ms-iconbtn" title="Rename provider" onClick={() => { setRenameValue(selected.name); setRenaming(true); }}><EditIcon size={13} /></button>
                  </>
                )}
                {selected.enabled ? (
                  <span style={{ padding: "4px 12px", borderRadius: 999, background: "#17B88B", color: "#052e1c", fontSize: 12, fontWeight: 700 }}>Enabled</span>
                ) : (
                  <span style={{ padding: "4px 12px", borderRadius: 999, background: "var(--color-bg-tertiary)", color: "var(--color-foreground-subtle)", fontSize: 12, fontWeight: 700 }}>Disabled</span>
                )}
                <button className="ms-btn" onClick={toggleEnabled}>{selected.enabled ? "Disable" : "Enable"}</button>
                <button className="ms-iconbtn" style={{ marginLeft: "auto", color: "var(--color-danger)" }} title="Delete provider" onClick={deleteProvider}><TrashIcon size={14} /></button>
              </div>

              <div>
                <div className="ms-label">Base URL</div>
                <input className="ms-input" value={selected.baseUrl} onChange={e => updateSelected({ baseUrl: e.target.value })} placeholder="http://127.0.0.1:3478/v1" />
              </div>

              <div>
                <div className="ms-label">API format</div>
                <select className="ms-input" value={selected.apiFormat} onChange={e => updateSelected({ apiFormat: e.target.value })}>
                  <option value="openai-completions">Chat completions (/chat/completions)</option>
                  <option value="responses">Responses (/responses)</option>
                  <option value="anthropic">Anthropic (/v1/messages)</option>
                </select>
              </div>

              <div>
                <div className="ms-label">API key</div>
                <div style={{ position: "relative" }}>
                  <input className="ms-input" style={{ paddingRight: 36, fontFamily: "monospace" }} type={showKey ? "text" : "password"} value={selected.apiKey} onChange={e => updateSelected({ apiKey: e.target.value })} placeholder="sk-..." />
                  <button className="ms-iconbtn" style={{ position: "absolute", right: 6, top: 8 }} onClick={() => setShowKey(v => !v)}>{showKey ? <EyeOffIcon size={14} /> : <EyeIcon size={14} />}</button>
                </div>
              </div>

              <div>
                <div className="ms-label">Model list</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {selected.modelList.map(m => (
                    <div key={m.id} className="ms-model-row">
                      <span style={{ flex: 1, fontFamily: "monospace", fontSize: 13 }}>{m.id}</span>
                      <span className="ms-badge">{formatContext(m.context)}</span>
                      {m.vision ? <span className="ms-badge">Vision</span> : null}
                      {m.video ? <span className="ms-badge">Video</span> : null}
                      <button className="ms-iconbtn" title="Edit model" onClick={() => openEdit(m)}><EditIcon size={13} /></button>
                      <button className="ms-iconbtn" title="Delete model" style={{ color: "var(--color-danger)" }} onClick={() => removeModel(m.id)}><TrashIcon size={13} /></button>
                    </div>
                  ))}
                  <button className="ms-btn" style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 6 }} onClick={openAdd}>
                    <PlusIcon size={14} /> Add model
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add / Edit model dialog */}
      {dialog && (
        <div className="ms-modal-backdrop" onClick={() => setDialog(null)}>
          <div className="ms-modal" onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <span style={{ fontSize: 15, fontWeight: 700 }}>{dialog.mode === "add" ? "Add model" : "Edit model"}</span>
              <button className="ms-iconbtn" onClick={() => setDialog(null)}><XIcon size={14} /></button>
            </div>

            <div className="ms-label">Model ID</div>
            <input className="ms-input" style={{ fontFamily: "monospace" }} autoFocus value={draft.id} placeholder="Model ID" onChange={e => setDraft({ ...draft, id: e.target.value })} />

            <div className="ms-label">Context window</div>
            <input className="ms-input" type="number" value={draft.context} onChange={e => setDraft({ ...draft, context: Number(e.target.value) || 0 })} />

            <div className="ms-label">Max output tokens</div>
            <input className="ms-input" type="number" value={draft.maxOutput} onChange={e => setDraft({ ...draft, maxOutput: Number(e.target.value) || 0 })} />

            <div className="ms-label">Input types</div>
            <div style={{ display: "flex", gap: 8 }}>
              <label className="ms-check locked"><input type="checkbox" checked disabled /> Text <LockIcon size={11} /></label>
              <label className="ms-check"><input type="checkbox" checked={draft.vision} onChange={e => setDraft({ ...draft, vision: e.target.checked })} /> Image</label>
              <label className="ms-check"><input type="checkbox" checked={draft.video} onChange={e => setDraft({ ...draft, video: e.target.checked })} /> Video</label>
            </div>

            <div className="ms-label">Output types</div>
            <div style={{ display: "flex", gap: 8 }}>
              <label className="ms-check locked"><input type="checkbox" checked disabled /> Text <LockIcon size={11} /></label>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
              <button className="ms-btn" onClick={() => setDialog(null)}>Cancel</button>
              <button className="ms-btn primary" onClick={saveDialog} disabled={!draft.id.trim()}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
