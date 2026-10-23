/*
 * PURPOSE: Full terminal pane via xterm.js + node-pty — VS Code style
 *
 * No separate input widget — the xterm itself handles all key handling,
 * cursor, selection, copy/paste, and renders ANSI. The shell is a real PTY
 * (conpty on Windows) via main process, so vim, htop, etc. work.
 *
 * The block wears the One UI clothing: a rounded surface card inset from the
 * pane edges (.terminal-pane-wrap / .terminal-pane in index.css). xterm needs
 * concrete colours, so the theme colours are resolved from the running
 * stylesheet tokens through a probe element and converted to hex — the
 * terminal follows every theme preset instead of carrying its own hardcoded
 * palette. The 16 ANSI colours stay fixed: they are terminal data (ls, git
 * and prompt themes emit them), not theme decoration.
 */

import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

import { api } from "../../api/client";

interface TerminalPaneProps {
  terminalId: string;
}

/** Resolve a CSS colour token to hex via a probe inside the themed scope. */
function tokenToHex(el: HTMLElement, token: string, fallback: string): string {
  try {
    const probe = document.createElement("span");
    probe.style.color = `var(${token})`;
    el.appendChild(probe);
    const computed = getComputedStyle(probe).color;
    probe.remove();
    const parts = computed.match(/[\d.]+/g);
    if (!parts || parts.length < 3) return fallback;
    const [r, g, b] = parts.slice(0, 3).map(v => Math.max(0, Math.min(255, Math.round(parseFloat(v)))));
    const to2 = (n: number) => n.toString(16).padStart(2, "0");
    return `#${to2(r)}${to2(g)}${to2(b)}`;
  } catch {
    return fallback;
  }
}

export function TerminalPane({ terminalId }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Theme colours read from the live tokens (probe is mounted inside the
    // themed tree, so var() resolves the active preset). Selection is the
    // accent at low alpha, matching the app's selection treatment.
    const accent = tokenToHex(el, "--color-accent", "#4d8dff");
    const fg = tokenToHex(el, "--color-fg", "#e8e8e8");
    const bg = tokenToHex(el, "--color-surface", "#202020");
    const term = new Terminal({
      fontFamily: "var(--font-mono, ui-monospace), SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 12,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: "block",
      theme: {
        background: bg,
        foreground: fg,
        cursor: fg,
        cursorAccent: bg,
        selectionBackground: `${accent}44`,
        black: "#000000",
        red: "#cd3131",
        green: "#0dbc79",
        yellow: "#e5e510",
        blue: "#2472c8",
        magenta: "#bc3fbc",
        cyan: "#11a8cd",
        white: "#e5e5e5",
        brightBlack: "#666666",
        brightRed: "#f14c4c",
        brightGreen: "#23d18b",
        brightYellow: "#f5f543",
        brightBlue: "#3b8eea",
        brightMagenta: "#d670d6",
        brightCyan: "#29b8db",
        brightWhite: "#ffffff",
      },
      allowTransparency: false,
      convertEol: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    // Defer fit to next frame so container has size
    requestAnimationFrame(() => {
      try { fit.fit(); } catch {}
      const dims = fit.proposeDimensions();
      if (dims) (api as unknown as { createTerminal: (id: string) => Promise<void> }).createTerminal(terminalId);
    });

    termRef.current = term;
    fitRef.current = fit;

    // Handle user input -> send to PTY
    const dataDisp = term.onData((data) => {
      (api as unknown as { sendTerminalInput: (id: string, d: string) => Promise<void> }).sendTerminalInput(terminalId, data);
    });

    // Handle data from PTY -> write to xterm
    const off = (api as unknown as { onTerminalData: (id: string, cb: (d: string) => void) => () => void }).onTerminalData(terminalId, (data) => {
      term.write(data);
    });

    // Ensure shell exists (no-op if already)
    (api as unknown as { createTerminal: (id: string) => Promise<void> }).createTerminal(terminalId);

    const onResize = () => {
      try {
        fit.fit();
        const d = fit.proposeDimensions();
        if (d) {
          (api as unknown as { sendTerminalResize?: (id: string, cols: number, rows: number) => Promise<void> }).sendTerminalResize?.(terminalId, d.cols, d.rows);
          (window as unknown as { electron: { sendTerminalResize?: (id: string, c: number, r: number) => Promise<void> } }).electron?.sendTerminalResize?.(terminalId, d.cols, d.rows);
        }
      } catch {}
    };

    const ro = new ResizeObserver(() => onResize());
    ro.observe(el);
    window.addEventListener("resize", onResize);

    // Focus on mount
    term.focus();

    return () => {
      dataDisp.dispose();
      off();
      ro.disconnect();
      window.removeEventListener("resize", onResize);
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [terminalId]);

  // Also handle explicit resize via IPC if available
  useEffect(() => {
    const fit = fitRef.current;
    if (!fit) return;
    const t = setTimeout(() => {
      try {
        fit.fit();
        const d = fit.proposeDimensions();
        if (d) (api as unknown as { sendTerminalResize?: (id: string, cols: number, rows: number) => Promise<void> }).sendTerminalResize?.(terminalId, d.cols, d.rows);
      } catch {}
    }, 100);
    return () => clearTimeout(t);
  }, [terminalId]);

  return (
    <div className="terminal-pane-wrap">
      <div
        ref={containerRef}
        className="terminal-pane"
        onClick={() => termRef.current?.focus()}
      />
    </div>
  );
}
