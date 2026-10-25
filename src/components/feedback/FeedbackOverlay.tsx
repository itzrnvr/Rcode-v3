/*
 * PURPOSE: In-app annotate/feedback mode.
 *
 * Toggle (titlebar highlighter button or Ctrl+Shift+A) freezes the UI under a
 * transparent canvas. Tools:
 *   - select: click UI elements to box+number them (multiple per screenshot);
 *     a comment popup opens RIGHT AT the box — type + Enter to attach it.
 *     The comment is drawn under the box on the saved image and listed in the
 *     saved note. Hover shows a dashed preview.
 *   - pen / arrow / box: freehand red drawing for areas.
 * Optional overall note at the bottom (minimizable so you can reach anything).
 * "Save & copy": renderer asks main for a window capture, composites the
 * annotation over it, main writes feedback-<ts>.png/.txt + latest.md into
 * <userData>/feedback and copies the annotated image to the clipboard.
 * Then tell the agent "read the feedback".
 *
 * Screen-wide capture is intentionally NOT here — the user uses ShareX for that.
 */

import { useEffect, useRef, useState, useCallback } from "react";

import { api } from "../../api/client";
import { PenIcon, ArrowUpRightIcon, SquareIcon, Undo2Icon, TrashIcon, XIcon, MousePointer2Icon } from "../common/Icons";

type Tool = "select" | "pen" | "arrow" | "box";
interface Point { x: number; y: number }
interface Rect { x: number; y: number; w: number; h: number }
interface Shape { tool: Tool; points: Point[]; rect?: Rect; label?: number; comment?: string; desc?: string }
interface Popup { label: number; x: number; y: number; value: string }
interface DrawColors { danger: string; fg: string; shadow: string }

const UI_SELECTOR = ".feedback-toolbar, .feedback-bottom, .feedback-popup, .feedback-restore";

/** Resolve a CSS colour token via a probe element — canvas cannot read var(). */
function tokenColor(el: HTMLElement, token: string, fallback: string): string {
  try {
    const probe = document.createElement("span");
    probe.style.color = `var(${token})`;
    el.appendChild(probe);
    const computed = getComputedStyle(probe).color;
    probe.remove();
    return computed || fallback;
  } catch {
    return fallback;
  }
}

function describeEl(el: Element): string {
  const aria = el.getAttribute("aria-label") || el.getAttribute("title");
  if (aria) return aria.slice(0, 48);
  const text = (el.textContent || "").trim().replace(/\s+/g, " ");
  if (text) return text.slice(0, 48);
  const cls = typeof el.className === "string" ? `.${el.className.split(" ")[0]}` : "";
  return `${el.tagName.toLowerCase()}${cls}`;
}

export function FeedbackOverlay({ onExit }: { onExit: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [current, setCurrent] = useState<Shape | null>(null);
  const [hover, setHover] = useState<Rect | null>(null);
  const [popup, setPopup] = useState<Popup | null>(null);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [panelMin, setPanelMin] = useState(false);

  const dpr = window.devicePixelRatio || 1;

  const drawShape = useCallback((ctx: CanvasRenderingContext2D, s: Shape, colors: DrawColors) => {
    ctx.strokeStyle = colors.danger;
    ctx.fillStyle = colors.danger;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (s.tool === "select" && s.rect) {
      ctx.strokeRect(s.rect.x, s.rect.y, s.rect.w, s.rect.h);
      const bx = s.rect.x + 2;
      const by = s.rect.y - 12 < 2 ? s.rect.y + 2 : s.rect.y - 12;
      ctx.beginPath();
      ctx.arc(bx + 10, by + 10, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = colors.fg;
      ctx.font = "bold 12px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(s.label ?? 0), bx + 10, by + 11);
      if (s.comment?.trim()) {
        ctx.font = "600 12px system-ui, sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        const text = s.comment.trim().slice(0, 80);
        const ty = s.rect.y + s.rect.h + 4;
        ctx.lineWidth = 4;
        ctx.strokeStyle = colors.shadow;
        ctx.strokeText(text, s.rect.x + 2, ty);
        ctx.fillStyle = colors.danger;
        ctx.fillText(text, s.rect.x + 2, ty);
      }
      return;
    }
    if (s.points.length === 0) return;
    const [a] = s.points;
    const b = s.points[s.points.length - 1];
    if (s.tool === "pen") {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      for (const p of s.points) ctx.lineTo(p.x, p.y);
      ctx.stroke();
    } else if (s.tool === "box") {
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    } else {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const head = 12;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - head * Math.cos(ang - Math.PI / 6), b.y - head * Math.sin(ang - Math.PI / 6));
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - head * Math.cos(ang + Math.PI / 6), b.y - head * Math.sin(ang + Math.PI / 6));
      ctx.stroke();
    }
  }, []);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Canvas cannot resolve var() — the annotation colours are read from the
    // themed tokens through a probe element, as in TerminalPane.
    const colors: DrawColors = {
      danger: tokenColor(canvas, "--color-danger", "#ff3b30"),
      fg: tokenColor(canvas, "--color-fg", "#ffffff"),
      shadow: tokenColor(canvas, "--color-shadow", "rgba(10,10,10,0.85)"),
    };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of shapes) drawShape(ctx, s, colors);
    if (hover) {
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = colors.danger;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(hover.x, hover.y, hover.w, hover.h);
      ctx.restore();
    }
    if (current) drawShape(ctx, current, colors);
  }, [shapes, current, hover, drawShape, dpr]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    redraw();
  }, [redraw, dpr]);

  useEffect(() => { redraw(); }, [redraw]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !popup) onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit, popup]);

  const commitPopup = useCallback(() => {
    if (!popup) return;
    const value = popup.value.trim();
    setShapes(prev => prev.map(s => (s.tool === "select" && s.label === popup.label ? { ...s, comment: value || undefined } : s)));
    setPopup(null);
  }, [popup]);

  interface PointAt { element: Element; rect: { x: number; y: number; w: number; h: number } }

  // Select mode can annotate same-origin content inside the built Browser pane.
  function elementAtPoint(x: number, y: number): PointAt | null {
    const top = document.elementFromPoint(x, y);
    if (!top) return null;
    const topRect = top.getBoundingClientRect();
    return {
      element: top,
      rect: { x: topRect.x, y: topRect.y, w: topRect.width, h: topRect.height },
    };
  }

  function elementAtPointDeep(x: number, y: number): PointAt | null {
    const top = document.elementFromPoint(x, y);
    if (!top) return null;

    if (top instanceof HTMLIFrameElement) {
      try {
        const doc = top.contentDocument;
        const frameRect = top.getBoundingClientRect();
        const inner = doc?.elementFromPoint(x - frameRect.left, y - frameRect.top);
        if (inner) {
          const innerRect = inner.getBoundingClientRect();
          return {
            element: inner,
            rect: {
              x: frameRect.left + innerRect.left,
              y: frameRect.top + innerRect.top,
              w: innerRect.width,
              h: innerRect.height,
            },
          };
        }
      } catch {
        // Cross-origin frames stay selected as the frame itself.
      }
    }

    const rect = top.getBoundingClientRect();
    return { element: top, rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height } };
  }

  // Select mode: canvas is pointer-transparent; resolve elements under cursor.
  useEffect(() => {
    if (tool !== "select") {
      setHover(null);
      return;
    }
    const overUI = (e: PointerEvent) =>
      (e.target as Element).closest?.(UI_SELECTOR) != null;
    const onMove = (e: PointerEvent) => {
      if (overUI(e)) { setHover(null); return; }
      const target = elementAtPointDeep(e.clientX, e.clientY);
      if (!target || target.element.closest?.(UI_SELECTOR)) { setHover(null); return; }
      setHover(target.rect);
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || overUI(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const target = elementAtPointDeep(e.clientX, e.clientY);
      if (!target || target.element.closest?.(UI_SELECTOR)) return;
      const rect = target.rect;
      const desc = describeEl(target.element);
      let createdLabel: number | null = null;
      setShapes(prev => {
        if (prev.some(s => s.tool === "select" && s.rect && Math.abs(s.rect.x - rect.x) < 2 && Math.abs(s.rect.y - rect.y) < 2 && Math.abs(s.rect.w - rect.w) < 2 && Math.abs(s.rect.h - rect.h) < 2)) return prev;
        const label = prev.filter(s => s.tool === "select").length + 1;
        createdLabel = label;
        return [...prev, { tool: "select", points: [], rect, label, desc }];
      });
      // open the comment popup at the box (next tick so state settles)
      setTimeout(() => {
        if (createdLabel != null) {
          setPopup({ label: createdLabel, x: Math.min(rect.x, window.innerWidth - 320), y: Math.min(rect.y + rect.h + 8, window.innerHeight - 90), value: "" });
        }
      }, 0);
    };
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [tool]);

  const getPos = (e: React.PointerEvent): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    try { (e.target as Element).setPointerCapture(e.pointerId); } catch {}
    setCurrent({ tool, points: [getPos(e)] });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!current) return;
    setCurrent({ ...current, points: [...current.points, getPos(e)] });
  };
  const onPointerUp = () => {
    if (!current) return;
    if (current.points.length > 1) setShapes(prev => [...prev, current]);
    setCurrent(null);
  };

  const buildNote = () => {
    const selects = shapes.filter(s => s.tool === "select" && s.label);
    const lines = selects.map(s => `${s.label}. [${s.desc ?? "element"}]${s.comment?.trim() ? ` — ${s.comment.trim()}` : ""}`);
    const parts: string[] = [];
    if (lines.length) parts.push(lines.join("\n"));
    if (note.trim()) parts.push(note.trim());
    return parts.join("\n\n");
  };

  const save = async () => {
    setSaving(true);
    setStatus("Capturing…");
    try {
      const shot = await api.captureForFeedback();
      const off = document.createElement("canvas");
      off.width = shot.width;
      off.height = shot.height;
      const ctx = off.getContext("2d")!;
      const img = new Image();
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error("image load failed"));
        img.src = shot.dataUrl;
      });
      ctx.drawImage(img, 0, 0, shot.width, shot.height);
      if (canvasRef.current) {
        ctx.drawImage(canvasRef.current, 0, 0, shot.width, shot.height);
      }
      const dataUrl = off.toDataURL("image/png");
      setStatus("Saving…");
      const result = await api.saveFeedback({ dataUrl, note: buildNote() });
      setStatus(`Saved + copied to clipboard: ${result.pngPath}`);
    } catch (e) {
      setStatus(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="feedback-overlay">
      <canvas
        ref={canvasRef}
        className="feedback-canvas"
        style={{ pointerEvents: tool === "select" ? "none" : "auto", cursor: tool === "select" ? "default" : "crosshair" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />

      <div className="feedback-toolbar">
        <button className={`feedback-tool ${tool === "select" ? "active" : ""}`} onClick={() => setTool("select")} title="Select elements (click to box + number, comment pops up at the box)"><MousePointer2Icon size={14} /></button>
        <button className={`feedback-tool ${tool === "pen" ? "active" : ""}`} onClick={() => setTool("pen")} title="Pen"><PenIcon size={14} /></button>
        <button className={`feedback-tool ${tool === "arrow" ? "active" : ""}`} onClick={() => setTool("arrow")} title="Arrow"><ArrowUpRightIcon size={14} /></button>
        <button className={`feedback-tool ${tool === "box" ? "active" : ""}`} onClick={() => setTool("box")} title="Box"><SquareIcon size={14} /></button>
        <span className="feedback-sep" />
        <button className="feedback-tool" onClick={() => setShapes(s => s.slice(0, -1))} title="Undo"><Undo2Icon size={14} /></button>
        <button className="feedback-tool" onClick={() => { setShapes([]); setPopup(null); }} title="Clear all"><TrashIcon size={14} /></button>
        <span className="feedback-sep" />
        <button className="feedback-tool" onClick={onExit} title="Exit (Esc)"><XIcon size={14} /></button>
      </div>

      {popup && (
        <div className="feedback-popup" style={{ left: popup.x, top: popup.y }} onPointerDown={e => e.stopPropagation()}>
          <span className="feedback-comment-num">{popup.label}</span>
          <input
            autoFocus
            className="feedback-comment-input"
            placeholder="Comment on this element… (Enter to attach)"
            value={popup.value}
            onChange={e => setPopup({ ...popup, value: e.target.value })}
            onKeyDown={e => {
              if (e.key === "Enter") { e.preventDefault(); commitPopup(); }
              if (e.key === "Escape") { e.stopPropagation(); setPopup(null); }
            }}
            onBlur={commitPopup}
          />
        </div>
      )}

      {panelMin ? (
        <button className="feedback-restore" onClick={() => setPanelMin(false)} title="Show note panel">
          notes & save
        </button>
      ) : (
        <div className="feedback-bottom">
          <button className="feedback-minimize" onClick={() => setPanelMin(true)} title="Minimize so you can select anything on screen">—</button>
          <textarea
            className="feedback-note"
            placeholder="Overall note (optional) — per-box comments pop up at each box"
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={2}
          />
          <button className="feedback-save" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save & copy"}
          </button>
          {status && <div className="feedback-status">{status}</div>}
        </div>
      )}
    </div>
  );
}
