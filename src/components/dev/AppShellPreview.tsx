/*
 * App shell preview — the Rcode shell in the One UI design language, rendered
 * in isolation with mock data: no backend, no app state, no window.electron.
 * Anything here that needed the Electron bridge to mount would be a defect,
 * same rule as the rest of the gallery.
 *
 * Dark is the primary presentation, and each column carries its own scope
 * class — .one-ui for dark, .one-ui-light over it for light — so the light
 * shell renders beside the dark one as the comparison column and the two
 * palettes cannot interfere. The light variant has no other home in the
 * gallery.
 *
 * Real primitives from src/components/ui carry the design language; the shell
 * chrome (sidebar, composer, picker, side panel) is composed from those
 * primitives at One UI's geometry — 48px targets, the 8/12/16/24 radius ladder,
 * 15px body type on a 1.55 line height, spring entrances. The side panel
 * mirrors the real SidePanel's capabilities — pill tab rail with side chats
 * beside terminal / review / browser / trajectory tabs, new-tab picker, tab
 * manager with search + recently closed, per-tab close, collapse — in the same
 * language. The structural CSS for the oui-* classes lives in gallery.css,
 * scoped under .shell-preview.
 *
 * The contrast tables are measured from the live stylesheet the same way the
 * gallery's foundations table is (probe element, composited colour, WCAG
 * ratio), but per column: One UI's translucent foreground steps are exactly
 * the kind of token that reads fine in one theme and fails in the other.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Spinner } from "@/components/ui/spinner";
import {
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  StarIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ArrowUpIcon,
  MicIcon,
  PinIcon,
  TerminalIcon,
  FileTextIcon,
  PaletteIcon,
  KeyIcon,
  PanelRightIcon,
  PanelLeftIcon,
  BotIcon,
  GaugeIcon,
  CopyIcon,
  RefreshIcon,
  DotsIcon,
  TrashIcon,
  XIcon,
  MessageCircleIcon,
  Code2Icon,
  TerminalSquareIcon,
  GlobeIcon,
  ActivityIcon,
  GitForkIcon,
  FolderIcon,
} from "@/components/common/Icons";

/* --- measured contrast ----------------------------------------------------
 * Same method as the gallery's table: resolve the token through a detached
 * probe placed INSIDE the themed scope (so var() picks up that column's
 * values), composite translucent colours over the surface they sit on, then
 * take the WCAG ratio. Values come from the running stylesheet, never from a
 * hard-coded list.
 */

type RGB = [number, number, number];
type RGBA = [number, number, number, number];

function resolveIn(container: HTMLElement | null, token: string): RGBA | null {
  if (!container) return null;
  const probe = document.createElement("span");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.backgroundColor = `var(${token})`;
  container.appendChild(probe);
  const computed = getComputedStyle(probe).backgroundColor;
  probe.remove();

  const parts = computed.match(/[\d.]+/g);
  if (!parts || parts.length < 3) return null;
  let [r, g, b] = parts.slice(0, 3).map(Number);
  let a = parts.length > 3 ? Number(parts[3]) : 1;
  // color() results carry 0-1 components; rgb() carries 0-255. Reading both
  // as one scale is how a contrast table reports 1.16:1 instead of ~6:1.
  if (computed.startsWith("color(") || parts.length === 4 || Math.max(r, g, b) <= 1) {
    [r, g, b] = [r, g, b].map(v => v * 255);
    if (a > 1) a /= 255;
  }
  return [r, g, b, a];
}

function relativeLuminance([r, g, b]: RGB): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function over(rgba: RGBA, bg: RGB): RGB {
  const a = Math.min(1, Math.max(0, rgba[3]));
  return [
    rgba[0] * a + bg[0] * (1 - a),
    rgba[1] * a + bg[1] * (1 - a),
    rgba[2] * a + bg[2] * (1 - a),
  ];
}

/** Drop alpha: surfaces are opaque, so the ratio is taken against plain RGB. */
function asRGB(c: RGBA | null): RGB | null {
  return c ? [c[0], c[1], c[2]] : null;
}

const CONTRAST_TOKENS = [
  ["--color-fg", "Primary text"],
  ["--color-foreground-subtle", "Supporting copy, metadata"],
  ["--color-foreground-subtlest", "Placeholders, weak hints"],
  ["--color-accent", "Accent, links, active marks"],
  ["--color-success", "Success"],
  ["--color-warning", "Warning"],
  ["--color-danger", "Destructive"],
] as const;

interface ContrastRow {
  token: string;
  role: string;
  onBg: number;
  onSurface: number;
  verdict: "AA" | "AA large" | "fails" | "unresolved";
}

function useContrastRows(containerRef: RefObject<HTMLElement | null>): ContrastRow[] {
  const [rows, setRows] = useState<ContrastRow[]>([]);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const bg = asRGB(resolveIn(el, "--color-bg"));
    const surface = asRGB(resolveIn(el, "--color-surface"));
    if (!bg || !surface) return;
    setRows(
      CONTRAST_TOKENS.map(([token, role]) => {
        const colour = resolveIn(el, token);
        if (!colour) {
          return { token, role, onBg: 0, onSurface: 0, verdict: "unresolved" as const };
        }
        const onBg = contrastRatio(over(colour, bg), bg);
        const onSurface = contrastRatio(over(colour, surface), surface);
        const verdict =
          onBg >= 4.5 && onSurface >= 4.5
            ? ("AA" as const)
            : onBg >= 3
              ? ("AA large" as const)
              : ("fails" as const);
        return { token, role, onBg, onSurface, verdict };
      }),
    );
    // Runs once per mount; the page is static once painted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return rows;
}

function ContrastTable({ rows }: { rows: ContrastRow[] }) {
  return (
    <table className="w-full border-collapse text-ui-sm">
      <thead>
        <tr className="border-b border-[var(--color-border)] text-left">
          {["Token", "On bg", "On surface", "AA body"].map(h => (
            <th
              key={h}
              className="px-3 py-2 font-mono text-ui-2xs font-medium uppercase tracking-wide text-[var(--color-foreground-subtlest)]"
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.token} className="border-b border-[var(--color-border)] last:border-b-0">
            <td className="whitespace-nowrap px-3 py-2 font-mono text-ui-xs text-[var(--color-fg)]">
              {r.token.replace("--color-", "")}
            </td>
            <td className="px-3 py-2 font-mono text-ui-xs tabular-nums text-[var(--color-foreground-subtle)]">
              {r.verdict === "unresolved" ? "—" : `${r.onBg.toFixed(2)}`}
            </td>
            <td className="px-3 py-2 font-mono text-ui-xs tabular-nums text-[var(--color-foreground-subtle)]">
              {r.verdict === "unresolved" ? "—" : `${r.onSurface.toFixed(2)}`}
            </td>
            <td className="px-3 py-2">
              <span
                className={cn(
                  "text-ui-xs font-medium",
                  r.verdict === "AA" && "text-[var(--color-success)]",
                  r.verdict === "AA large" && "text-[var(--color-warning)]",
                  (r.verdict === "fails" || r.verdict === "unresolved") &&
                    "text-[var(--color-danger)]",
                )}
              >
                {r.verdict}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* --- mock data ------------------------------------------------------------ */

const SESSIONS_PINNED = [
  { title: "One UI theme tokens", time: "2h ago" },
  { title: "Fix login redirect loop", time: "yesterday" },
];

interface SessionData {
  title: string;
  time: string;
  pinned?: boolean;
  running?: boolean;
  children?: Array<{ title: string; time: string }>;
  /** Demo affordance: one parent ships expanded so the nesting is visible. */
  open?: boolean;
}

const SESSIONS_RECENTS: SessionData[] = [
  { title: "Refactor applyTheme writes", time: "3h ago" },
  {
    title: "Gallery contrast table",
    time: "5h ago",
    open: true,
    children: [
      { title: "Probe element helper", time: "4h ago" },
      { title: "Composite + ratio math", time: "4h ago" },
      { title: "Light column comparison", time: "2h ago" },
    ],
  },
  { title: "Side chat tab ordering", time: "Monday" },
  { title: "Electron tray menu", time: "Monday", running: true },
  { title: "Migrate to Tailwind v4", time: "last week" },
];

interface ModelRow {
  id: string;
  label: string;
  meta: string;
}
const MODEL_GROUPS: Array<{ provider: string; models: ModelRow[] }> = [
  {
    provider: "z.ai",
    models: [
      { id: "glm-5.2", label: "GLM-5.2", meta: "flagship · 200k ctx" },
      { id: "glm-4.7-air", label: "GLM-4.7 Air", meta: "fast · 128k ctx" },
    ],
  },
  {
    provider: "Moonshot",
    models: [
      { id: "kimi-k3", label: "Kimi K3", meta: "agentic · 256k ctx" },
      { id: "kimi-k2", label: "Kimi K2", meta: "128k ctx" },
    ],
  },
  {
    provider: "Anthropic",
    models: [{ id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", meta: "coding" }],
  },
];

/* --- shared bits ---------------------------------------------------------- */

/** 44px round icon button — the One UI touch-target floor for chrome. */
function IconButton({
  label,
  children,
  className,
  ...props
}: React.ComponentProps<"button"> & { label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-full text-[var(--color-foreground-subtle)] transition-colors duration-200 hover:bg-[var(--color-hover)] hover:text-[var(--color-fg)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "px-3 pb-2 pt-5 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--color-foreground-subtlest)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

function DemoDivider({ children }: { children: ReactNode }) {
  return (
    <div className="my-8 flex items-center gap-3 first:mt-2">
      <span className="h-px flex-1 bg-[var(--color-border)]" />
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-foreground-subtlest)]">
        {children}
      </span>
      <span className="h-px flex-1 bg-[var(--color-border)]" />
    </div>
  );
}

/* --- sidebar --------------------------------------------------------------- */

function SessionRow({
  title,
  time,
  pinned,
  active,
  running,
  onOpen,
}: {
  title: string;
  time: string;
  pinned?: boolean;
  active?: boolean;
  running?: boolean;
  onOpen?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open session: ${title}`}
      className={cn(
        "flex min-h-12 w-full items-center gap-2.5 rounded-[var(--radius-md)] px-3 py-1.5 text-left transition-colors duration-200 hover:bg-[var(--color-hover)]",
        active && "bg-[var(--color-selected)] hover:bg-[var(--color-selected)]",
      )}
    >
      {/* Leading slot, reserved at the spinner's width whether or not the
          session is running, so every title starts at the same x. The old
          static dot is gone: it repeated what the row's own selection state
          already says. A running session marks itself with a pulsing loader
          instead — opacity, not rotation, on purpose: the global
          reduced-motion guard freezes every animation to a single instant,
          which would leave a frozen half-arc that no longer reads as
          activity, while the pulse settles into the plain loader glyph at
          full opacity and still says "working" statically. */}
      {running ? (
        <Spinner
          className="size-3.5 shrink-0 animate-pulse"
          aria-label="Session running"
        />
      ) : (
        <span aria-hidden className="size-3.5 shrink-0" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ui-sm font-medium text-[var(--color-fg)]">
          {title}
        </span>
        <span className="block text-ui-xs text-[var(--color-foreground-subtlest)]">{time}</span>
      </span>
      {pinned && (
        <PinIcon size={14} className="shrink-0 text-[var(--color-foreground-subtlest)]" />
      )}
    </button>
  );
}

/*
 * A session with side chats keeps two intents apart: the title is its own
 * button that OPENS the session, and the chevron is a sibling button that
 * toggles the branch. The two cannot nest — a <button> inside a <button> is
 * invalid HTML and breaks keyboard interaction — so the row is a plain
 * wrapper div that carries the shared hover/selected/focus treatment (so the
 * whole row still reads and lights up as one row), while each button carries
 * exactly one action. The chevron keeps the leading slot so children align
 * under the parent title; its hit area is padded out with negative margins so
 * the layout geometry is unchanged. Children sit behind a vertical guide line
 * that hangs from the chevron column, read smaller and muted, and are plain
 * buttons that open their own session — not collapsible triggers. Their old
 * status dots are gone too; an empty placeholder keeps their titles at the
 * aligned x.
 */
function SessionItem({
  session,
  activeSession,
  onOpen,
}: {
  session: SessionData;
  activeSession: string;
  onOpen: (title: string) => void;
}) {
  const [open, setOpen] = useState(session.open ?? false);
  const contentId = useId();

  if (!session.children?.length) {
    return (
      <SessionRow
        title={session.title}
        time={session.time}
        pinned={session.pinned}
        active={session.title === activeSession}
        running={session.running}
        onOpen={() => onOpen(session.title)}
      />
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="oui-branch">
      <div
        className={cn(
          "flex min-h-12 w-full items-center gap-2.5 rounded-[var(--radius-md)] px-3 py-1.5 transition-colors duration-200 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--color-accent)]",
          session.title === activeSession
            ? "bg-[var(--color-selected)] hover:bg-[var(--color-selected)]"
            : "hover:bg-[var(--color-hover)]",
        )}
      >
        {/* Branch toggle: the ONLY thing that expands/collapses the side
            chats. Sibling of the title button, never nested inside it. */}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          aria-label={
            open
              ? `Collapse side chats for ${session.title}`
              : `Expand side chats for ${session.title}`
          }
          onClick={event => {
            event.stopPropagation();
            setOpen(o => !o);
          }}
          className="-mx-2 flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--color-foreground-subtlest)] transition-colors duration-200 hover:bg-[var(--color-hover)] focus-visible:outline-none"
        >
          <ChevronRightIcon
            size={14}
            className={cn("oui-branch-chevron", open && "rotate-90")}
          />
        </button>
        {/* Opens the session itself — the primary action of the row. */}
        <button
          type="button"
          aria-label={`Open session: ${session.title}`}
          onClick={() => onOpen(session.title)}
          className="min-w-0 flex-1 text-left focus-visible:outline-none"
        >
          <span className="block truncate text-ui-sm font-medium text-[var(--color-fg)]">
            {session.title}
          </span>
          <span className="block text-ui-xs text-[var(--color-foreground-subtlest)]">
            {session.time}
          </span>
        </button>
      </div>
      <CollapsibleContent id={contentId}>
        <div className="mb-1 ml-[19px] flex flex-col gap-0.5 border-l border-[var(--color-border)] py-0.5">
          {session.children.map(child => (
            <button
              key={child.title}
              type="button"
              onClick={() => onOpen(child.title)}
              className={cn(
                "flex min-h-9 w-full items-center gap-2 rounded-[var(--radius-sm)] py-1 pl-4 pr-2 text-left transition-colors duration-200 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-accent)]",
                child.title === activeSession
                  ? "bg-[var(--color-selected)] hover:bg-[var(--color-selected)]"
                  : "hover:bg-[var(--color-hover)]",
              )}
            >
              <span aria-hidden className="size-1.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-ui-xs text-[var(--color-foreground-subtle)]">
                {child.title}
              </span>
              <span className="shrink-0 text-ui-2xs text-[var(--color-foreground-subtlest)]">
                {child.time}
              </span>
            </button>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function Sidebar({
  collapsed,
  id,
  activeSession,
  onOpenSession,
  onOpenSettings,
}: {
  collapsed: boolean;
  id: string;
  activeSession: string;
  onOpenSession: (title: string) => void;
  onOpenSettings: () => void;
}) {
  return (
    <aside id={id} className="oui-sidebar" data-collapsed={collapsed || undefined}>
      <div className="oui-sidebar-inner">
        <div className="flex items-center gap-2 px-4 pb-2 pt-4">
          {/* Starting a chat is not a frequent action, so the button recedes:
              a neutral bordered pill on the sidebar ground — muted label and
              hairline border that both strengthen on hover. No accent: the
              blue stays reserved for selection and the composer send button,
              and the session list remains the subject of the panel. */}
          <button
            type="button"
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3.5 text-ui-sm font-medium text-[var(--color-foreground-subtle)] transition-colors duration-200 hover:border-[var(--color-border-hover)] hover:bg-[var(--color-hover)] hover:text-[var(--color-fg)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-accent)]"
          >
            <PlusIcon size={16} />
            New chat
          </button>
          <IconButton label="Search sessions" className="ml-auto">
            <SearchIcon size={18} />
          </IconButton>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          <SectionLabel>Pinned</SectionLabel>
          <div className="flex flex-col gap-0.5">
            {SESSIONS_PINNED.map(s => (
              <SessionRow
                key={s.title}
                title={s.title}
                time={s.time}
                pinned
                active={s.title === activeSession}
                onOpen={() => onOpenSession(s.title)}
              />
            ))}
          </div>
          <SectionLabel>Recents</SectionLabel>
          <div className="flex flex-col gap-0.5">
            {SESSIONS_RECENTS.map(s => (
              <SessionItem
                key={s.title}
                session={s}
                activeSession={activeSession}
                onOpen={onOpenSession}
              />
            ))}
          </div>
        </div>

        {/* There is no account in the prototype, so the footer is not a
            profile: a Settings entry and the local server state, on one row.
            Settings takes the room it needs; the server status rides on the
            right and truncates first, because the status is reference
            information and the entry is an action. */}
        <div className="flex items-center gap-2 border-t border-[var(--color-border)] p-3">
          <button
            type="button"
            onClick={onOpenSettings}
            className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-[var(--radius-md)] px-3 text-left transition-colors duration-200 hover:bg-[var(--color-hover)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-accent)]"
          >
            <SettingsIcon size={18} className="shrink-0 text-[var(--color-foreground-subtle)]" />
            <span className="min-w-0 flex-1 truncate text-ui-sm font-medium text-[var(--color-fg)]">
              Settings
            </span>
          </button>
          <div
            title="Local proxy server · connected"
            className="flex min-w-0 shrink items-center gap-1.5 text-ui-xs text-[var(--color-foreground-subtlest)]"
          >
            <span
              aria-hidden
              className="size-1.5 shrink-0 rounded-full bg-[var(--color-success)]"
            />
            <span className="min-w-0 truncate">local-proxy</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

/* --- chat header ----------------------------------------------------------- */

function ChatHeader({
  sessionTitle,
  sidebarOpen,
  onToggleSidebar,
  sidebarId,
  panelOpen,
  onTogglePanel,
  panelId,
}: {
  sessionTitle: string;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  sidebarId: string;
  panelOpen: boolean;
  onTogglePanel: () => void;
  panelId: string;
}) {
  return (
    <header className="flex h-16 shrink-0 items-center gap-1.5 border-b border-[var(--color-border)] px-2.5">
      {/* Left drawer toggle — the only control that opens/closes the session
          panel; aria-expanded tracks the drawer, aria-controls points at it. */}
      <IconButton
        label="Toggle sessions panel"
        aria-expanded={sidebarOpen}
        aria-controls={sidebarId}
        onClick={onToggleSidebar}
      >
        <PanelLeftIcon size={20} />
      </IconButton>
      {/* Shows the session the mock "open" action picked, so clicking a
          session title in the sidebar has a visible effect in the chat pane. */}
      <div className="ml-1 min-w-0 flex-1">
        <div className="truncate text-ui-base font-semibold text-[var(--color-fg)]">
          {sessionTitle}
        </div>
        <div className="truncate text-ui-xs text-[var(--color-foreground-subtlest)]">
          main · depth 0 · GLM-5.2
        </div>
      </div>
      {/* Right panel toggle — same contract as the left one: tracks the
          drawer's state and points at it. */}
      <IconButton
        label="Toggle side panel"
        aria-expanded={panelOpen}
        aria-controls={panelId}
        onClick={onTogglePanel}
      >
        <PanelRightIcon size={20} />
      </IconButton>
      <IconButton label="More">
        <DotsIcon size={20} />
      </IconButton>
    </header>
  );
}

/* --- empty state ------------------------------------------------------------ */

function EmptyState() {
  const prompts = [
    "Explain the theme pipeline",
    "Add a session search",
    "Why is this build slow?",
  ];
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-14 text-center">
      {/* No hero icon. A boxed glyph above the headline is the empty-state
          template every cheap AI app ships - a robot head or a sparkle in a
          rounded tile - and it makes the screen announce itself as a product
          landing rather than a place to type. The headline is enough. */}
      <div className="text-ui-xl font-semibold tracking-tight text-[var(--color-fg)]">
        What are we building?
      </div>
      <p className="max-w-[400px] text-ui-sm text-[var(--color-foreground-subtle)]">
        Pick up a session on the left, or start something new. Rcode runs locally
        against your workspace.
      </p>
      <div className="mt-1 flex flex-wrap justify-center gap-2">
        {prompts.map(p => (
          <button
            key={p}
            type="button"
            className="flex h-10 items-center rounded-full border border-[var(--color-border)] px-4 text-ui-sm text-[var(--color-foreground-subtle)] transition-colors duration-200 hover:border-[var(--color-border-hover)] hover:bg-[var(--color-hover)] hover:text-[var(--color-fg)]"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

/* --- tool runs ---------------------------------------------------------------
 *
 * Tool mechanics are the least interesting thing in a message, so the tool
 * block is the deliberate exception to the One UI language around it: while
 * everything else is generous, rounded and filled, this is one quiet line —
 * small muted icon, a plain-language summary, and the outcome that tells the
 * user whether the tool actually did anything. No card, no border, no
 * elevation, radius-sm; muted colour at every step. The mechanics (tool name,
 * input, raw output) hide behind the line in a low-contrast inset that grows
 * in place via the Base UI collapsible states styled in gallery.css.
 *
 * Anything the user should actually *read* — a diff, a file list, output that
 * matters — is not trapped here at all: it renders as normal assistant content
 * below the line. The line summarises; the result is content.
 */

interface ToolRunData {
  icon: ReactNode;
  /** What happened, in the user's words, not the tool's. */
  summary: string;
  /** The part worth glancing at: exit code, match count, size. */
  outcome?: string;
  /** Mechanics below the fold. */
  tool: string;
  input: string;
  output: string;
}

function ToolRun({ run }: { run: ToolRunData }) {
  return (
    <Collapsible className="oui-tool group min-w-0">
      <CollapsibleTrigger className="-mx-2 flex min-h-7 w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 text-left transition-colors duration-200 hover:bg-[var(--color-hover)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-accent)]">
        <span aria-hidden className="shrink-0 text-[var(--color-foreground-subtlest)]">
          {run.icon}
        </span>
        <span className="min-w-0 flex-1 truncate text-ui-sm text-[var(--color-foreground-subtle)]">
          {run.summary}
          {run.outcome && (
            <span className="text-ui-xs tabular-nums text-[var(--color-foreground-subtlest)]">
              {" · "}
              {run.outcome}
            </span>
          )}
        </span>
        <ChevronDownIcon
          aria-hidden
          size={14}
          className="oui-tool-chevron shrink-0 text-[var(--color-foreground-subtlest)]"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 rounded-[var(--radius-sm)] bg-[var(--color-surface)] px-3 py-2.5">
          <div className="font-mono text-ui-xs text-[var(--color-foreground-subtlest)]">
            {run.tool}
          </div>
          <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap font-mono text-ui-xs leading-relaxed text-[var(--color-foreground-subtle)]">
            {run.input}
          </pre>
          <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap border-t border-[var(--color-border)] pt-2 font-mono text-ui-xs leading-relaxed text-[var(--color-foreground-subtlest)]">
            {run.output}
          </pre>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

const TOOL_RUNS: ToolRunData[] = [
  {
    icon: <FileTextIcon size={14} />,
    summary: "Read AppShell.tsx",
    outcome: "128 lines",
    tool: "read_file",
    input: "src/components/layout/AppShell.tsx",
    output: `export function AppShell() {
  const [sidebarOpen, setSidebarOpen] = usePanelState("sidebar", true);
  // panel width transitions on .panel-sessions; children swap in
  // a single frame and carry their own fade to cover the seam
  return ( ... );`,
  },
  {
    icon: <SearchIcon size={14} />,
    summary: "Searched the codebase",
    outcome: "3 matches",
    tool: "grep",
    input: `pattern: "transition: width"   glob: src/components/**`,
    output: `src/components/layout/AppShell.tsx
  112:  transition: width var(--duration-panel) var(--ease-out);
  138:  transition: width var(--duration-panel) var(--ease-out);
src/components/layout/SidePanel.tsx
  64:  transition: width var(--duration-panel) var(--ease-out);`,
  },
  {
    icon: <TerminalIcon size={14} />,
    summary: "Ran a command",
    outcome: "exit 0",
    tool: "bash",
    input: "pnpm vitest run src/components/layout",
    output: `PASS  src/components/layout/AppShell.test.tsx
  Tests  4 passed (4)
Duration  1.24s`,
  },
];

/* --- message exchange -------------------------------------------------------- */

function MessageExchange() {
  return (
    <div className="flex flex-col gap-3 px-5 pb-2">
      {/* user turn */}
      <div className="flex justify-end">
        <div className="oui-bubble-user max-w-[80%] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-ui-base text-[var(--color-fg)]">
          Why does the sidebar flicker when I toggle it while a session is
          streaming?
        </div>
      </div>

      {/* assistant turn: quiet tool lines stack tight above the answer; the
          answer is the loudest thing in the message, and the result worth
          reading renders as normal content below it, outside the tool block */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          {TOOL_RUNS.map(run => (
            <ToolRun key={run.tool} run={run} />
          ))}
        </div>
        <div className="text-ui-base leading-[1.55] text-[var(--color-fg)]">
          The flicker is the width transition racing the content swap. The panel
          animates <code className="rounded-md bg-[var(--color-hover)] px-1 py-0.5 font-mono text-[0.9em]">width</code>{" "}
          over 300ms, but the children remount in one frame — so for the first
          ~100ms the new content is laid out at the old width.
        </div>
        {/* Result as content: the lines that matter, rendered like any other
            assistant code block instead of living inside a tool card. */}
        <pre className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 font-mono text-ui-xs leading-relaxed text-[var(--color-foreground-subtle)]">
{`.panel-sessions {
  transition: width var(--duration-panel) var(--ease-out);
}
/* children remount in one frame — new content lays out at the old width */`}
        </pre>
        <div className="flex items-center gap-2">
          <span className="text-ui-xs text-[var(--color-foreground-subtlest)]">
            GLM-5.2 · 4.2s · 1,204 tokens
          </span>
          <IconButton label="Retry" className="size-8">
            <RefreshIcon size={14} />
          </IconButton>
          <IconButton label="Copy" className="size-8">
            <CopyIcon size={14} />
          </IconButton>
        </div>
      </div>
    </div>
  );
}

/* --- model picker ----------------------------------------------------------- */

function ModelRowOneUI({
  model,
  selected,
  pinned,
  onSelect,
  onPin,
}: {
  model: ModelRow;
  selected: boolean;
  pinned: boolean;
  onSelect: () => void;
  onPin: () => void;
}) {
  return (
    <div
      className={cn(
        "flex min-h-12 items-center gap-3 px-4 transition-colors duration-200 hover:bg-[var(--color-menu-hover)]",
        selected && "bg-[var(--color-selected)]",
      )}
    >
      <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
        <span className="block truncate text-ui-sm font-medium text-[var(--color-fg)]">
          {model.label}
        </span>
        <span className="block truncate text-ui-xs text-[var(--color-foreground-subtlest)]">
          {model.meta}
        </span>
      </button>
      {/* Fixed right-hand column: a reserved slot for the checkmark, then the
          pin. Selection renders into the empty slot instead of inserting an
          element after the star, so nothing ever moves — the name truncates. */}
      <span className="flex w-5 shrink-0 items-center justify-center">
        {selected && <CheckIcon size={16} className="text-[var(--color-fg)]" />}
      </span>
      <button
        type="button"
        aria-label={pinned ? `Unpin ${model.label}` : `Pin ${model.label}`}
        aria-pressed={pinned}
        onClick={onPin}
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full transition-colors duration-200 hover:bg-[var(--color-hover)]",
          pinned ? "text-[var(--color-fg)]" : "text-[var(--color-foreground-subtlest)]",
        )}
      >
        <StarIcon size={16} className={cn(pinned && "fill-current")} />
      </button>
    </div>
  );
}

function ProviderCard({
  provider,
  models,
  open,
  onToggle,
  selected,
  pinned,
  onSelect,
  onPin,
}: {
  provider: string;
  models: ModelRow[];
  open: boolean;
  onToggle: () => void;
  selected: string;
  pinned: Set<string>;
  onSelect: (id: string) => void;
  onPin: (id: string) => void;
}) {
  return (
    <Collapsible open={open} onOpenChange={onToggle}>
      <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)]">
        <CollapsibleTrigger
          className={cn(
            "flex min-h-12 w-full items-center gap-2 px-4 text-left transition-colors duration-200 hover:bg-[var(--color-hover)]",
          )}
        >
          <ChevronRightIcon
            size={16}
            className={cn(
              "shrink-0 text-[var(--color-foreground-subtlest)] transition-transform duration-300",
              open && "rotate-90",
            )}
          />
          <span className="flex-1 truncate text-ui-sm font-semibold text-[var(--color-fg)]">
            {provider}
          </span>
          <span className="shrink-0 font-mono text-ui-xs tabular-nums text-[var(--color-foreground-subtlest)]">
            {models.length}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <Separator className="bg-[var(--color-border)]" />
          <div className="flex flex-col py-1">
            {models.map(m => (
              <ModelRowOneUI
                key={m.id}
                model={m}
                selected={selected === m.id}
                pinned={pinned.has(m.id)}
                onSelect={() => onSelect(m.id)}
                onPin={() => onPin(m.id)}
              />
            ))}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function ModelPickerPanel() {
  const [selected, setSelected] = useState("glm-5.2");
  const [pinned, setPinned] = useState<Set<string>>(() => new Set(["glm-5.2"]));
  const [openProviders, setOpenProviders] = useState<Set<string>>(
    () => new Set(["z.ai"]),
  );

  const toggleSet = (current: Set<string>, apply: (next: Set<string>) => void, id: string) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    apply(next);
  };

  const pinnedModels = MODEL_GROUPS.flatMap(g => g.models).filter(m => pinned.has(m.id));

  return (
    <div className="flex flex-col gap-3 px-5">
      {/* the picker panel as it opens from the composer trigger */}
      <div className="w-full max-w-[340px] rounded-[var(--radius-xl)] border border-[var(--color-popover-border)] bg-[var(--color-menu)] p-2 shadow-[var(--shadow-lg)]">
        <div className="p-1 pb-2">
          <Input
            placeholder="Search models"
            className="h-11 rounded-full border-[var(--color-input-border)] bg-[var(--color-surface)] px-4 text-ui-sm shadow-none"
          />
        </div>

        {pinnedModels.length > 0 && (
          <div className="mb-2">
            <div className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--color-foreground-subtlest)]">
              Pinned
            </div>
            <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)]">
              {pinnedModels.map(m => (
                <ModelRowOneUI
                  key={m.id}
                  model={m}
                  selected={selected === m.id}
                  pinned
                  onSelect={() => setSelected(m.id)}
                  onPin={() => toggleSet(pinned, setPinned, m.id)}
                />
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {MODEL_GROUPS.map(g => (
            <ProviderCard
              key={g.provider}
              provider={g.provider}
              models={g.models}
              open={openProviders.has(g.provider)}
              onToggle={() => toggleSet(openProviders, setOpenProviders, g.provider)}
              selected={selected}
              pinned={pinned}
              onSelect={setSelected}
              onPin={id => toggleSet(pinned, setPinned, id)}
            />
          ))}
        </div>
      </div>
      <p className="text-ui-xs text-[var(--color-foreground-subtlest)]">
        Provider groups are expandable rounded cards; the star pins a model into
        the Pinned section above.
      </p>
    </div>
  );
}

/* --- composer --------------------------------------------------------------- */

function Composer() {
  return (
    <div className="shrink-0 bg-[var(--color-bg)] px-4 pb-4 pt-2">
      <div className="group/composer rounded-[var(--radius-xl)] border border-[var(--color-input-border)] bg-[var(--color-surface)] shadow-[var(--shadow-md)] transition-colors duration-200 focus-within:border-[var(--color-input-border-hover)]">
        <Textarea
          placeholder="Do anything"
          className="min-h-[76px] resize-none border-0 bg-transparent px-5 pt-4 text-ui-base shadow-none focus-visible:border-transparent focus-visible:ring-0"
        />
        <div className="flex items-center gap-1.5 px-3 pb-3">
          <IconButton label="Add" className="size-10">
            <PlusIcon size={18} />
          </IconButton>
          <button
            type="button"
            className="hidden h-10 shrink-0 items-center gap-2 rounded-full px-3 text-ui-sm text-[var(--color-foreground-subtle)] transition-colors duration-200 hover:bg-[var(--color-hover)] hover:text-[var(--color-fg)] sm:flex"
          >
            <GaugeIcon size={15} />
            High
          </button>
          <button
            type="button"
            className="ml-auto flex h-10 min-w-0 shrink-0 items-center gap-2 rounded-full px-3 text-ui-sm transition-colors duration-200 hover:bg-[var(--color-hover)]"
          >
            <span className="min-w-0 text-left">
              <span className="block truncate font-medium text-[var(--color-fg)]">GLM-5.2</span>
            </span>
            <ChevronDownIcon size={14} className="shrink-0 text-[var(--color-foreground-subtlest)]" />
          </button>
          <IconButton label="Voice input" className="size-10">
            <MicIcon size={18} />
          </IconButton>
          <Button
            aria-label="Send"
            className="size-11 shrink-0 rounded-full bg-primary p-0 text-primary-foreground shadow-none hover:bg-primary/90"
          >
            <ArrowUpIcon size={20} />
          </Button>
        </div>
      </div>
    </div>
  );
}

/* --- side panel ----------------------------------------------------------------
 *
 * The right panel in the One UI language, mirroring the real side panel's
 * capabilities (src/components/sidepanel/SidePanel.tsx): a pill tab rail where
 * side chats sync in beside terminal / review / browser / trajectory tabs, a
 * picker for new tab types, a tab manager with search + recently closed, and
 * one pane per tab type.
 *
 * Pills, not a segmented control: the tab set is open-ended (every side chat
 * becomes a tab, terminals multiply), widths vary with their titles, each tab
 * carries its own close action, and the rail scrolls when it overflows. A
 * segmented control assumes fixed equal slots and has no per-segment close —
 * it would fight all four of those facts.
 *
 * Accent discipline: the active pill is the neutral selected fill, like
 * selected session rows — the blue stays with the pane's one primary action
 * (the side-chat send), focus outlines and nothing else.
 */

type SideTabType = "side-conversation" | "review" | "terminal" | "browser" | "trajectory";

interface SideTab {
  id: string;
  type: SideTabType;
  title: string;
  closedAt?: number;
}

const SIDE_TAB_DEFS: Record<
  SideTabType,
  { label: string; Icon: React.FC<{ size?: number; className?: string }>; hint: string }
> = {
  "side-conversation": {
    label: "Side conversation",
    Icon: MessageCircleIcon,
    hint: "Ask without touching the main thread",
  },
  review: { label: "Review", Icon: Code2Icon, hint: "Changed files, commit and push" },
  terminal: { label: "Terminal", Icon: TerminalSquareIcon, hint: "Shell in the workspace" },
  browser: { label: "Browser", Icon: GlobeIcon, hint: "Live preview of a page" },
  trajectory: { label: "Trajectory", Icon: ActivityIcon, hint: "Turn and tool timeline" },
};

const SIDE_TAB_TYPES = Object.keys(SIDE_TAB_DEFS) as SideTabType[];

function fmtAgo(ts?: number): string {
  if (!ts) return "";
  const m = Math.max(1, Math.round((Date.now() - ts) / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

/** Close a menu on outside pointerdown or Escape; triggers are exempt so the
 *  toggle click never fights the dismissal. Shared by all three menus. */
function useMenuDismiss(open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement;
      if (!el.closest("[data-oui-menu]") && !el.closest("[data-oui-menu-trigger]")) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
}

function SideMenuHeading({ children }: { children: ReactNode }) {
  return (
    <div className="px-2.5 pb-1 pt-2.5 text-ui-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-foreground-subtlest)] first:pt-1.5">
      {children}
    </div>
  );
}

/* --- terminal pane --------------------------------------------------------- */

const TERMINAL_LINES: Array<{ kind: "cmd" | "out" | "ok" | "dim"; text: string }> = [
  { kind: "cmd", text: "npm run build" },
  { kind: "dim", text: "> rcode@0.1.0 build" },
  { kind: "dim", text: "> tsc -p tsconfig.node.json && vite build" },
  { kind: "out", text: "" },
  { kind: "out", text: "vite v6.4.1 building for production..." },
  { kind: "ok", text: "✓ 1,204 modules transformed." },
  { kind: "out", text: "dist/index.html          0.62 kB" },
  { kind: "out", text: "dist/assets/index.js   512.44 kB" },
  { kind: "ok", text: "✓ built in 3.18s" },
];

function TerminalPaneMock({
  onNewTerminal,
  onClose,
}: {
  onNewTerminal: () => void;
  onClose: () => void;
}) {
  const [lines, setLines] = useState(TERMINAL_LINES);
  const [menuOpen, setMenuOpen] = useState(false);
  useMenuDismiss(menuOpen, useCallback(() => setMenuOpen(false), []));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative flex min-h-11 shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-3">
        <span className="min-w-0 flex-1 truncate text-ui-sm font-medium text-[var(--color-fg)]">
          Terminal
        </span>
        <span className="shrink-0 font-mono text-ui-xs text-[var(--color-foreground-subtlest)]">
          pwsh · D:\Rcode
        </span>
        <IconButton
          label="Terminal actions"
          data-oui-menu-trigger="1"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          onClick={() => setMenuOpen(v => !v)}
          className="size-8"
        >
          <ChevronDownIcon size={14} />
        </IconButton>
        {menuOpen && (
          <div className="oui-sp-menu oui-sp-menu-right" data-oui-menu="1" role="menu">
            <button
              type="button"
              role="menuitem"
              className="oui-sp-menu-item"
              onClick={() => {
                setMenuOpen(false);
                onNewTerminal();
              }}
            >
              <TerminalSquareIcon size={16} />
              New terminal
            </button>
            <button
              type="button"
              role="menuitem"
              className="oui-sp-menu-item"
              onClick={() => {
                setLines([]);
                setMenuOpen(false);
              }}
            >
              <TrashIcon size={16} />
              Clear
            </button>
            <button
              type="button"
              role="menuitem"
              className="oui-sp-menu-item"
              onClick={() => {
                setMenuOpen(false);
                onClose();
              }}
            >
              <XIcon size={16} />
              Kill terminal
            </button>
          </div>
        )}
      </div>
      {/* The xterm block of the real pane, in One UI clothing: a rounded
          surface card, mono at the caption step. The prompt is the only live
          element — a static block cursor, because the reduced-motion guard
          freezes blinking animations into a misleading half-state. */}
      <div className="mx-3 mb-3 mt-2.5 min-h-0 flex-1 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 font-mono text-ui-xs leading-relaxed">
        {lines.map((line, i) => (
          <div
            key={i}
            className={
              line.kind === "ok"
                ? "whitespace-pre-wrap text-[var(--color-success)]"
                : line.kind === "cmd"
                  ? "whitespace-pre-wrap text-[var(--color-fg)]"
                  : line.kind === "dim"
                    ? "whitespace-pre-wrap text-[var(--color-foreground-subtlest)]"
                    : "whitespace-pre-wrap text-[var(--color-foreground-subtle)]"
            }
          >
            {line.kind === "cmd" && (
              <span className="text-[var(--color-foreground-subtlest)]">PS D:\Rcode{'>'}&nbsp;</span>
            )}
            {line.text}
          </div>
        ))}
        <div className="whitespace-pre-wrap text-[var(--color-fg)]">
          <span className="text-[var(--color-foreground-subtlest)]">PS D:\Rcode{'>'}&nbsp;</span>
          <span className="text-[var(--color-foreground-subtle)]">▊</span>
        </div>
      </div>
    </div>
  );
}

/* --- side conversation pane -------------------------------------------------- */

const SIDE_CHAT_RUN: ToolRunData = {
  icon: <SearchIcon size={14} />,
  summary: "Searched the codebase",
  outcome: "2 matches",
  tool: "grep",
  input: 'pattern: "panel-side"   glob: src/**/*.css',
  output: `src/index.css
  395: .panel-side {
  401:   border-left: 1px solid var(--color-border);`,
};

function SideChatPaneMock({ title }: { title: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-11 shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-3">
        <MessageCircleIcon size={14} className="shrink-0 text-[var(--color-foreground-subtlest)]" />
        <span className="min-w-0 flex-1 truncate text-ui-sm font-medium text-[var(--color-fg)]">
          {title}
        </span>
        <span className="shrink-0 text-ui-xs text-[var(--color-foreground-subtlest)]">
          side chat
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-3 px-3 py-3">
          <div className="flex justify-end">
            <div className="oui-bubble-user max-w-[85%] border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2.5 text-ui-sm text-[var(--color-fg)]">
              Does the panel width transition need will-change?
            </div>
          </div>
          <div className="flex flex-col gap-0.5">
            <ToolRun run={SIDE_CHAT_RUN} />
          </div>
          <div className="text-ui-sm leading-[1.55] text-[var(--color-fg)]">
            No — it's a flex sibling, so the browser lifts it to its own layer
            for the 300ms the transition runs and drops it after. A permanent{" "}
            <code className="rounded-md bg-[var(--color-hover)] px-1 py-0.5 font-mono text-[0.9em]">
              will-change
            </code>{" "}
            would cost memory on every panel for nothing.
          </div>
          <div className="flex items-center gap-2">
            <span className="text-ui-xs text-[var(--color-foreground-subtlest)]">
              GLM-5.2 · 2.1s · 384 tokens
            </span>
          </div>
        </div>
      </div>
      <div className="shrink-0 border-t border-[var(--color-border)] p-2.5">
        <div className="flex items-center gap-1.5 rounded-[var(--radius-lg)] border border-[var(--color-input-border)] bg-[var(--color-surface)] py-1.5 pl-4 pr-1.5 transition-colors duration-200 focus-within:border-[var(--color-input-border-hover)]">
          <input
            placeholder="Ask about this…"
            aria-label="Message the side chat"
            className="h-9 min-w-0 flex-1 bg-transparent text-ui-sm text-[var(--color-fg)] outline-none placeholder:text-[var(--color-foreground-subtlest)]"
          />
          <Button
            aria-label="Send"
            className="size-9 shrink-0 rounded-full bg-primary p-0 text-primary-foreground shadow-none hover:bg-primary/90"
          >
            <ArrowUpIcon size={16} />
          </Button>
        </div>
      </div>
    </div>
  );
}

/* --- review pane -------------------------------------------------------------- */

const REVIEW_SUMMARY = { branch: "main", ahead: 2, plus: 302, minus: 15 };

const REVIEW_FILES: Array<{ status: "M" | "A" | "U"; path: string; plus: number; minus: number }> = [
  { status: "M", path: "src/components/layout/AppShell.tsx", plus: 18, minus: 4 },
  { status: "M", path: "src/index.css", plus: 64, minus: 11 },
  { status: "A", path: "src/components/dev/AppShellPreview.tsx", plus: 194, minus: 0 },
  { status: "U", path: "src/gallery.css", plus: 26, minus: 0 },
];

const REVIEW_STATUS_COLOR: Record<(typeof REVIEW_FILES)[number]["status"], string> = {
  M: "var(--color-warning)",
  A: "var(--color-success)",
  U: "var(--color-success)",
};

const REVIEW_DIFF: Array<{ kind: "ctx" | "add" | "del"; text: string }> = [
  { kind: "ctx", text: '   const [sidebarOpen, setSidebarOpen] = usePanelState("sidebar", true);' },
  { kind: "del", text: "−  const [sideOpen, setSideOpen] = useState(false);" },
  { kind: "add", text: '+  const [sideOpen, setSideOpen] = usePanelState("sidepanel", true);' },
  { kind: "ctx", text: "   return (" },
];

function ReviewPaneMock() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-11 shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-3">
        <span className="min-w-0 flex-1 truncate text-ui-sm font-medium text-[var(--color-fg)]">
          Review
        </span>
        <span className="shrink-0 font-mono text-ui-xs text-[var(--color-foreground-subtlest)]">
          {REVIEW_SUMMARY.branch}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-2 px-3 py-3">
          <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
            <div className="flex min-h-11 items-center gap-2.5 px-3">
              <GitForkIcon size={15} className="shrink-0 text-[var(--color-foreground-subtle)]" />
              <span className="min-w-0 flex-1 truncate text-ui-sm text-[var(--color-fg)]">
                {REVIEW_SUMMARY.branch}
              </span>
              <span className="shrink-0 font-mono text-ui-xs text-[var(--color-foreground-subtlest)]">
                ↑{REVIEW_SUMMARY.ahead}
              </span>
            </div>
            <div className="oui-row-sep flex min-h-11 items-center gap-2.5 px-3">
              <FolderIcon size={15} className="shrink-0 text-[var(--color-foreground-subtle)]" />
              <span className="min-w-0 flex-1 truncate text-ui-sm text-[var(--color-fg)]">
                Changes
              </span>
              <span className="shrink-0 font-mono text-ui-xs tabular-nums text-[var(--color-success)]">
                +{REVIEW_SUMMARY.plus}
              </span>
              <span className="shrink-0 font-mono text-ui-xs tabular-nums text-[var(--color-danger)]">
                −{REVIEW_SUMMARY.minus}
              </span>
            </div>
          </div>

          <div className="flex flex-col">
            {REVIEW_FILES.map(f => (
              <button
                key={f.path}
                type="button"
                className="flex min-h-10 items-center gap-2.5 rounded-[var(--radius-sm)] px-2 text-left transition-colors duration-200 hover:bg-[var(--color-hover)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-accent)]"
              >
                <span
                  className="flex size-5 shrink-0 items-center justify-center rounded-[var(--radius-sm)] font-mono text-ui-xs font-semibold"
                  style={{
                    color: REVIEW_STATUS_COLOR[f.status],
                    background: `color-mix(in srgb, ${REVIEW_STATUS_COLOR[f.status]} 14%, transparent)`,
                  }}
                >
                  {f.status}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-ui-xs text-[var(--color-fg)]">
                  {f.path}
                </span>
                <span className="shrink-0 font-mono text-ui-xs tabular-nums text-[var(--color-foreground-subtlest)]">
                  +{f.plus}
                  {f.minus > 0 && (
                    <span className="text-[var(--color-foreground-subtlest)]"> −{f.minus}</span>
                  )}
                </span>
              </button>
            ))}
          </div>

          <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
            <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
              <span className="min-w-0 flex-1 truncate font-mono text-ui-xs text-[var(--color-foreground-subtle)]">
                src/components/layout/AppShell.tsx
              </span>
              <span className="shrink-0 font-mono text-ui-xs text-[var(--color-success)]">+18</span>
              <span className="shrink-0 font-mono text-ui-xs text-[var(--color-danger)]">−4</span>
            </div>
            <div className="px-2 py-2 font-mono text-ui-xs leading-relaxed">
              {REVIEW_DIFF.map(l => (
                <div
                  key={l.text}
                  className="rounded-[var(--radius-sm)] px-1.5"
                  style={{
                    background:
                      l.kind === "add"
                        ? "color-mix(in srgb, var(--color-success) 10%, transparent)"
                        : l.kind === "del"
                          ? "color-mix(in srgb, var(--color-danger) 10%, transparent)"
                          : undefined,
                    color:
                      l.kind === "ctx"
                        ? "var(--color-foreground-subtlest)"
                        : "var(--color-fg)",
                  }}
                >
                  {l.text}
                </div>
              ))}
            </div>
          </div>

          <Input
            placeholder="Commit message"
            aria-label="Commit message"
            className="h-10 shrink-0 rounded-full border-[var(--color-input-border)] bg-[var(--color-surface)] px-4 text-ui-sm shadow-none"
          />
          <div className="flex gap-2">
            <button
              type="button"
              className="flex h-10 flex-1 items-center justify-center rounded-full border border-[var(--color-border)] text-ui-sm font-medium text-[var(--color-fg)] transition-colors duration-200 hover:border-[var(--color-border-hover)] hover:bg-[var(--color-hover)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-accent)]"
            >
              Commit
            </button>
            <button
              type="button"
              className="flex h-10 flex-1 items-center justify-center rounded-full border border-[var(--color-border)] text-ui-sm font-medium text-[var(--color-foreground-subtle)] transition-colors duration-200 hover:border-[var(--color-border-hover)] hover:bg-[var(--color-hover)] hover:text-[var(--color-fg)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-accent)]"
            >
              Push
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* --- trajectory pane ------------------------------------------------------------ */

const TRAJECTORY_TURNS: Array<{
  turn: number;
  secs: string;
  events: Array<{ badge: string; text: string; mono: boolean }>;
}> = [
  {
    turn: 1,
    secs: "4.2s",
    events: [
      {
        badge: "USER",
        text: "Why does the sidebar flicker when I toggle it while a session is streaming?",
        mono: false,
      },
      { badge: "TOOL", text: "read_file src/components/layout/AppShell.tsx → 128 lines", mono: true },
      { badge: "TOOL", text: 'grep "transition: width" → 3 matches', mono: true },
      { badge: "MODEL", text: "r0 · 1.8s · 212 tok/s", mono: true },
      {
        badge: "ASSISTANT",
        text: "The flicker is the width transition racing the content swap…",
        mono: false,
      },
    ],
  },
  {
    turn: 2,
    secs: "2.6s",
    events: [
      { badge: "USER", text: "Apply the fix", mono: false },
      { badge: "TOOL", text: "edit_file src/components/layout/AppShell.tsx → applied", mono: true },
      { badge: "MODEL", text: "r1 · 0.9s · 168 tok/s", mono: true },
    ],
  },
];

function TrajectoryPaneMock() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-11 shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-3">
        <span className="min-w-0 flex-1 truncate text-ui-sm font-medium text-[var(--color-fg)]">
          Trajectory
        </span>
        <span className="shrink-0 font-mono text-ui-xs text-[var(--color-foreground-subtlest)]">
          2 turns · 8 steps · 6.8s
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {TRAJECTORY_TURNS.map(t => (
          <div key={t.turn} className="pb-1 pt-2 first:pt-1">
            <div className="flex items-center gap-2 py-1">
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--color-foreground-subtle)]" />
              <span className="text-ui-xs font-semibold text-[var(--color-fg)]">Turn {t.turn}</span>
              <span className="font-mono text-ui-xs text-[var(--color-foreground-subtlest)]">
                {t.secs}
              </span>
            </div>
            {t.events.map((e, i) => (
              <div key={i} className="flex items-baseline gap-2 rounded-[var(--radius-sm)] py-1 pr-1">
                <span className="w-16 shrink-0 font-mono text-ui-xs text-[var(--color-foreground-subtlest)]">
                  {e.badge}
                </span>
                <span
                  className={
                    e.mono
                      ? "min-w-0 flex-1 truncate font-mono text-ui-xs text-[var(--color-foreground-subtle)]"
                      : "min-w-0 flex-1 truncate text-ui-xs text-[var(--color-foreground-subtle)]"
                  }
                  title={e.text}
                >
                  {e.text}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* --- browser pane ---------------------------------------------------------------- */

function BrowserPaneMock() {
  const [reloadKey, setReloadKey] = useState(0);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-11 shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-3">
        <GlobeIcon size={14} className="shrink-0 text-[var(--color-foreground-subtlest)]" />
        <span className="min-w-0 flex-1 truncate font-mono text-ui-xs text-[var(--color-foreground-subtle)]">
          127.0.0.1:5173/gallery.html
        </span>
        <IconButton label="Reload preview" onClick={() => setReloadKey(k => k + 1)} className="size-8">
          <RefreshIcon size={14} />
        </IconButton>
      </div>
      {/* A real iframe, not a drawn page: the gallery is same-origin static
          output, so the preview pane previews something true. */}
      <div className="min-h-0 flex-1 p-3">
        <iframe
          key={reloadKey}
          src="/gallery.html"
          title="Component gallery preview"
          className="h-full w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]"
        />
      </div>
    </div>
  );
}

/* --- empty state ----------------------------------------------------------------- */

function SidePanelEmpty({ onOpen }: { onOpen: (type: SideTabType) => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
      <div className="text-ui-sm font-medium text-[var(--color-fg)]">No tabs open</div>
      <p className="mt-1 text-ui-xs text-[var(--color-foreground-subtlest)]">
        Open a tool, or pick up a side conversation.
      </p>
      <div className="mt-4 flex w-full flex-col gap-0.5">
        {SIDE_TAB_TYPES.map(type => {
          const Def = SIDE_TAB_DEFS[type];
          return (
            <button
              key={type}
              type="button"
              onClick={() => onOpen(type)}
              className="flex min-h-11 w-full items-center gap-3 rounded-[var(--radius-md)] px-3 text-left text-ui-sm text-[var(--color-foreground-subtle)] transition-colors duration-200 hover:bg-[var(--color-hover)] hover:text-[var(--color-fg)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-accent)]"
            >
              <Def.Icon size={16} className="shrink-0" />
              {Def.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* --- the panel -------------------------------------------------------------------- */

function SidePanel({
  id,
  collapsed,
  sessionTitle,
}: {
  id: string;
  collapsed: boolean;
  sessionTitle: string;
}) {
  const [tabs, setTabs] = useState<SideTab[]>([
    { id: "side-1", type: "side-conversation", title: "Width transition" },
    { id: "terminal-1", type: "terminal", title: "Terminal" },
    { id: "review", type: "review", title: "Review" },
  ]);
  const [activeId, setActiveId] = useState("side-1");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [tabSearch, setTabSearch] = useState("");
  const [recentlyClosed, setRecentlyClosed] = useState<SideTab[]>([]);
  const [overflow, setOverflow] = useState({ start: false, end: false });

  const railRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());

  const activeTab = tabs.find(t => t.id === activeId) ?? tabs[0];

  const closeMenus = useCallback(() => {
    setPickerOpen(false);
    setManagerOpen(false);
  }, []);
  useMenuDismiss(pickerOpen || managerOpen, closeMenus);

  const openNewTab = (type: SideTabType) => {
    setPickerOpen(false);
    // Singleton like the real panel: reopening trajectory focuses the one
    // that exists instead of stacking a second timeline.
    if (type === "trajectory") {
      const existing = tabs.find(t => t.type === type);
      if (existing) {
        setActiveId(existing.id);
        return;
      }
    }
    const base = type === "side-conversation" ? `Side: ${sessionTitle}` : SIDE_TAB_DEFS[type].label;
    const count = tabs.filter(t => t.type === type).length;
    const tab: SideTab = { id: `${type}-${Date.now()}`, type, title: count > 0 ? `${base} ${count + 1}` : base };
    setTabs(prev => [tab, ...prev]);
    setActiveId(tab.id);
  };

  const closeTab = (closeId: string) => {
    const closing = tabs.find(t => t.id === closeId);
    if (closing) {
      setRecentlyClosed(prev =>
        [{ ...closing, closedAt: Date.now() }, ...prev].slice(0, 8),
      );
    }
    const idx = tabs.findIndex(t => t.id === closeId);
    const next = tabs.filter(t => t.id !== closeId);
    setTabs(next);
    if (activeId === closeId) {
      setActiveId(next[Math.min(idx, next.length - 1)]?.id ?? "");
    }
  };

  const reopenTab = (tab: SideTab) => {
    setTabs(prev => [...prev, tab]);
    setActiveId(tab.id);
    setRecentlyClosed(prev => prev.filter(t => t.id !== tab.id));
  };

  // Roving tabindex on the rail: arrows move and activate, Home/End jump.
  const onRailKeyDown = (e: React.KeyboardEvent) => {
    const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (dir === 0 && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    if (tabs.length === 0) return;
    const idx = Math.max(0, tabs.findIndex(t => t.id === activeId));
    const next =
      e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (idx + dir + tabs.length) % tabs.length;
    const tab = tabs[next];
    if (!tab) return;
    setActiveId(tab.id);
    tabRefs.current.get(tab.id)?.focus();
  };

  // Edge fades only when the rail actually overflows, so a short tab list
  // never wears a fake cut-off.
  const updateOverflow = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    const start = el.scrollLeft > 2;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setOverflow(prev => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, []);
  useEffect(() => {
    updateOverflow();
    const el = railRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateOverflow, { passive: true });
    const ro = new ResizeObserver(updateOverflow);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", updateOverflow);
      ro.disconnect();
    };
  }, [updateOverflow, tabs]);

  // Keep the active pill in view when activation comes from the keyboard or
  // from closing a neighbour.
  useEffect(() => {
    tabRefs.current.get(activeId)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId]);

  const q = tabSearch.trim().toLowerCase();
  const managerOpenTabs = tabs.filter(t => !q || t.title.toLowerCase().includes(q));
  const managerClosed = recentlyClosed.filter(t => !q || t.title.toLowerCase().includes(q));

  return (
    <aside
      id={id}
      aria-label="Side panel"
      className="oui-sidepanel"
      data-collapsed={collapsed || undefined}
    >
      <div className="oui-sidepanel-inner">
        <div className="oui-sp-toolbar">
          <IconButton
            label="Tab list"
            data-oui-menu-trigger="1"
            aria-expanded={managerOpen}
            aria-haspopup="menu"
            onClick={() => {
              setManagerOpen(v => !v);
              setPickerOpen(false);
            }}
            className="size-10"
          >
            <ChevronDownIcon size={16} />
          </IconButton>

          <div
            ref={railRef}
            role="tablist"
            aria-label="Side panel tabs"
            className="oui-sp-rail"
            data-fade-left={overflow.start || undefined}
            data-fade-right={overflow.end || undefined}
            onKeyDown={onRailKeyDown}
          >
            {tabs.map(tab => {
              const Def = SIDE_TAB_DEFS[tab.type];
              const active = tab.id === activeTab?.id;
              return (
                <div key={tab.id} className="oui-sp-pill" data-active={active || undefined}>
                  <button
                    ref={el => {
                      if (el) tabRefs.current.set(tab.id, el);
                      else tabRefs.current.delete(tab.id);
                    }}
                    type="button"
                    role="tab"
                    id={`oui-sp-tab-${id}-${tab.id}`}
                    aria-selected={active}
                    aria-controls={`oui-sp-pane-${id}-${tab.id}`}
                    tabIndex={active ? 0 : -1}
                    title={tab.title}
                    onClick={() => setActiveId(tab.id)}
                    className="oui-sp-pill-open focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-accent)]"
                  >
                    <Def.Icon size={14} className="shrink-0" />
                    <span className="text-ui-sm">{tab.title}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Close ${tab.title}`}
                    title={`Close ${tab.title}`}
                    onClick={() => closeTab(tab.id)}
                    className="oui-sp-pill-close focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-accent)]"
                  >
                    <XIcon size={12} />
                  </button>
                </div>
              );
            })}
          </div>

          <IconButton
            label="New tab"
            data-oui-menu-trigger="1"
            aria-expanded={pickerOpen}
            aria-haspopup="menu"
            onClick={() => {
              setPickerOpen(v => !v);
              setManagerOpen(false);
            }}
            className="size-10"
          >
            <PlusIcon size={16} />
          </IconButton>

          {pickerOpen && (
            <div className="oui-sp-menu oui-sp-menu-right" data-oui-menu="1" role="menu">
              {SIDE_TAB_TYPES.map(type => {
                const Def = SIDE_TAB_DEFS[type];
                const exists = type === "trajectory" && tabs.some(t => t.type === type);
                return (
                  <button
                    key={type}
                    type="button"
                    role="menuitem"
                    onClick={() => openNewTab(type)}
                    className="oui-sp-menu-item"
                  >
                    <Def.Icon size={16} />
                    <span className="min-w-0 flex-1 truncate">{Def.label}</span>
                    {exists && (
                      <span className="shrink-0 text-ui-xs text-[var(--color-foreground-subtlest)]">
                        open
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {managerOpen && (
            <div className="oui-sp-menu oui-sp-menu-fill" data-oui-menu="1">
              <div className="p-1 pb-2">
                <Input
                  value={tabSearch}
                  onChange={e => setTabSearch(e.target.value)}
                  placeholder="Search tabs"
                  aria-label="Search tabs"
                  autoFocus
                  className="h-10 rounded-full border-[var(--color-input-border)] bg-[var(--color-surface)] px-4 text-ui-sm shadow-none"
                />
              </div>
              <SideMenuHeading>Open tabs</SideMenuHeading>
              {managerOpenTabs.length === 0 && (
                <div className="px-2.5 pb-1.5 text-ui-xs text-[var(--color-foreground-subtlest)]">
                  None
                </div>
              )}
              {managerOpenTabs.map(tab => {
                const Def = SIDE_TAB_DEFS[tab.type];
                const active = tab.id === activeTab?.id;
                return (
                  <div key={tab.id} className="flex items-center gap-0.5 pr-1">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveId(tab.id);
                        setManagerOpen(false);
                      }}
                      className={cn(
                        "oui-sp-menu-item min-w-0 flex-1",
                        active && "bg-[var(--color-menu-hover)]",
                      )}
                    >
                      <Def.Icon size={15} />
                      <span className="min-w-0 flex-1 truncate">{tab.title}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Close ${tab.title}`}
                      onClick={() => closeTab(tab.id)}
                      className="oui-sp-pill-close shrink-0"
                    >
                      <XIcon size={12} />
                    </button>
                  </div>
                );
              })}
              <SideMenuHeading>Recently closed</SideMenuHeading>
              {managerClosed.length === 0 && (
                <div className="px-2.5 pb-1.5 text-ui-xs text-[var(--color-foreground-subtlest)]">
                  None
                </div>
              )}
              {managerClosed.map(tab => {
                const Def = SIDE_TAB_DEFS[tab.type];
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      reopenTab(tab);
                      setManagerOpen(false);
                    }}
                    className="oui-sp-menu-item text-[var(--color-foreground-subtle)] hover:text-[var(--color-fg)]"
                  >
                    <Def.Icon size={15} />
                    <span className="min-w-0 flex-1 truncate">{tab.title}</span>
                    <span className="shrink-0 text-ui-xs tabular-nums text-[var(--color-foreground-subtlest)]">
                      {fmtAgo(tab.closedAt)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          {!activeTab ? (
            <SidePanelEmpty onOpen={openNewTab} />
          ) : (
            <div
              key={activeTab.id}
              role="tabpanel"
              id={`oui-sp-pane-${id}-${activeTab.id}`}
              aria-labelledby={`oui-sp-tab-${id}-${activeTab.id}`}
              className="oui-sp-pane flex min-h-0 flex-1 flex-col"
            >
              {activeTab.type === "terminal" && (
                <TerminalPaneMock
                  onNewTerminal={() => openNewTab("terminal")}
                  onClose={() => closeTab(activeTab.id)}
                />
              )}
              {activeTab.type === "side-conversation" && <SideChatPaneMock title={activeTab.title} />}
              {activeTab.type === "review" && <ReviewPaneMock />}
              {activeTab.type === "trajectory" && <TrajectoryPaneMock />}
              {activeTab.type === "browser" && <BrowserPaneMock />}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

/* --- settings sample --------------------------------------------------------- */

function SettingsRow({
  icon,
  label,
  description,
  control,
  danger,
}: {
  icon?: ReactNode;
  label: string;
  description?: string;
  control?: ReactNode;
  danger?: boolean;
}) {
  return (
    <div className="oui-row-sep flex min-h-14 items-center gap-4 px-5 py-3">
      {icon && (
        <span
          className={cn(
            "shrink-0",
            danger ? "text-[var(--color-danger)]" : "text-[var(--color-foreground-subtle)]",
          )}
        >
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "text-ui-sm font-medium",
            danger ? "text-[var(--color-danger)]" : "text-[var(--color-fg)]",
          )}
        >
          {label}
        </div>
        {description && (
          <div className="mt-0.5 text-ui-xs text-[var(--color-foreground-subtlest)]">
            {description}
          </div>
        )}
      </div>
      {control}
    </div>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-7 min-w-7 items-center justify-center rounded-[8px] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 font-mono text-[11px] text-[var(--color-foreground-subtle)]">
      {children}
    </kbd>
  );
}

/*
 * The settings sample doubles as the target of the sidebar footer's Settings
 * entry: `flash` marks the card for a moment after the entry scrolls it into
 * view, so the mock button has a visible effect. The accent border is the
 * focus-style accent, not a decorative fill.
 */
function SettingsSample({ flash = false }: { flash?: boolean }) {
  return (
    <div className="px-5">
      <div
        className={cn(
          "overflow-hidden rounded-[var(--radius-xl)] border bg-[var(--color-surface)] transition-[border-color,box-shadow] duration-300",
          flash
            ? "border-[var(--color-accent)] shadow-[var(--shadow-md)]"
            : "border-[var(--color-border)]",
        )}
      >
        <div className="border-b border-[var(--color-border)] px-5 py-4">
          <div className="text-ui-lg font-semibold text-[var(--color-fg)]">Settings</div>
          <div className="mt-0.5 text-ui-xs text-[var(--color-foreground-subtlest)]">
            Appearance, connection and behaviour
          </div>
        </div>

        <SettingsRow
          icon={<PaletteIcon size={18} />}
          label="Theme"
          description="Preset drives palette, radius, type and motion"
          control={
            <div className="flex items-center gap-2">
              <span className="text-ui-sm text-[var(--color-foreground-subtle)]">
                One UI (Samsung)
              </span>
              <ChevronRightIcon size={16} className="text-[var(--color-foreground-subtlest)]" />
            </div>
          }
        />
        <SettingsRow
          icon={<KeyIcon size={18} />}
          label="API base"
          control={<Input defaultValue="http://127.0.0.1:3459/v1" className="h-11 w-56 rounded-[var(--radius-md)] px-4 text-ui-sm" />}
        />
        <SettingsRow
          label="Translucent sidebar"
          description="Blur the panels behind glass"
          control={<Switch defaultChecked />}
        />
        <SettingsRow
          label="Send usage feedback"
          description="Anonymous; never includes message content"
          control={<Switch />}
        />
        <SettingsRow
          label="Command palette"
          control={
            <span className="flex items-center gap-1.5">
              <Kbd>Ctrl</Kbd>
              <Kbd>K</Kbd>
            </span>
          }
        />
        <SettingsRow
          icon={<RefreshIcon size={18} />}
          label="Reset all settings"
          description="Restores the default zai-dark theme"
          danger
          control={
            <Button
              variant="destructive"
              className="h-10 shrink-0 rounded-full px-5 text-ui-sm font-semibold"
            >
              Reset
            </Button>
          }
        />
      </div>
    </div>
  );
}

/* --- shell frame ------------------------------------------------------------- */

function ShellFrame({ mode }: { mode: "light" | "dark" }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // The side panel starts open so the three-pane shell is what the page
  // presents; the header toggle collapses it with the same panel motion the
  // left drawer uses. Tab state lives inside the panel, so collapsing never
  // loses the open tabs.
  const [panelOpen, setPanelOpen] = useState(true);
  // Mock "open session" state: clicking any session title/child marks it
  // active in the list and shows it as the chat header title. Each column
  // (dark/light) keeps its own, so the two shells demo independently.
  const [activeSession, setActiveSession] = useState(SESSIONS_RECENTS[0].title);
  const scrollRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const [settingsFlash, setSettingsFlash] = useState(false);
  const flashTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(flashTimer.current), []);

  // Mock "open settings": bring the settings sample into view inside the chat
  // pane and mark the card for a moment. The scroll stays inside .oui-scroll
  // so the page document itself never moves; the smooth behaviour is skipped
  // under prefers-reduced-motion, matching the CSS motion guard.
  const openSettings = () => {
    const scroll = scrollRef.current;
    const target = settingsRef.current;
    if (!scroll || !target) return;
    const delta = target.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scroll.scrollTo({
      top: Math.max(0, scroll.scrollTop + delta - 12),
      behavior: reduced ? "auto" : "smooth",
    });
    setSettingsFlash(true);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setSettingsFlash(false), 1600);
  };

  const sidebarId = `oui-sidebar-${mode}`;
  const panelId = `oui-sidepanel-${mode}`;
  return (
    <section
      className={cn("oui-rise", mode === "light" ? "one-ui one-ui-light" : "one-ui")}
      aria-label={`Rcode shell in One UI, ${mode} theme`}
    >
      <div className="oui-shell-frame">
        <Sidebar
          collapsed={!sidebarOpen}
          id={sidebarId}
          activeSession={activeSession}
          onOpenSession={setActiveSession}
          onOpenSettings={openSettings}
        />
        <div className="oui-main">
          <ChatHeader
            sessionTitle={activeSession}
            sidebarOpen={sidebarOpen}
            onToggleSidebar={() => setSidebarOpen(open => !open)}
            sidebarId={sidebarId}
            panelOpen={panelOpen}
            onTogglePanel={() => setPanelOpen(open => !open)}
            panelId={panelId}
          />
          <div ref={scrollRef} className="oui-scroll">
            <DemoDivider>Empty state</DemoDivider>
            <EmptyState />
            <DemoDivider>Message exchange</DemoDivider>
            <MessageExchange />
            <DemoDivider>Model picker</DemoDivider>
            <ModelPickerPanel />
            <div ref={settingsRef}>
              <DemoDivider>Settings</DemoDivider>
              <SettingsSample flash={settingsFlash} />
            </div>
            <div className="h-8" />
          </div>
          <Composer />
        </div>
        <SidePanel id={panelId} collapsed={!panelOpen} sessionTitle={activeSession} />
      </div>
    </section>
  );
}

/* --- section ------------------------------------------------------------------
 *
 * The gallery section content. The prototype page's header — title, the
 * "prototype · not shipped" badge, the hard-coded token chips — is retired
 * with the page: the shell is the real app now, and the numbers the chips
 * printed are the foundations sections' job, measured live from the
 * stylesheet rather than listed here where they would rot. What remains is
 * the shell in both themes, then the per-column contrast tables.
 */

function ContrastPanel({
  scopeClass,
  title,
}: {
  scopeClass: string;
  title: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const rows = useContrastRows(ref);
  return (
    <div ref={ref} className={cn("rounded-[var(--radius-xl)] border p-4", scopeClass)}
      style={{
        background: "var(--color-surface)",
        borderColor: "var(--color-border)",
      }}
    >
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-ui-sm font-semibold text-[var(--color-fg)]">{title}</h3>
        <span className="text-ui-2xs text-[var(--color-foreground-subtlest)]">
          measured live, WCAG ratio
        </span>
      </div>
      <ContrastTable rows={rows} />
    </div>
  );
}

export default function AppShellPreview() {
  return (
    <div className="shell-preview p-4">
      <div className="oui-grid">
        <ShellFrame mode="dark" />
        <ShellFrame mode="light" />
      </div>

      <section className="mt-8">
        <h3 className="text-ui-lg font-semibold text-[var(--color-fg)]">Measured contrast</h3>
        <p className="mb-4 mt-1 max-w-[720px] text-ui-sm text-[var(--color-foreground-subtle)]">
          Every text step resolved through the running stylesheet inside each
          column and composited over the surfaces it actually sits on. The
          floor is WCAG AA body text, 4.5:1 against both bg and surface —
          translucent foreground steps are the classic failure here.
        </p>
        <div className="oui-grid">
          <ContrastPanel scopeClass="one-ui" title="One UI dark" />
          <ContrastPanel scopeClass="one-ui one-ui-light" title="One UI light" />
        </div>
      </section>
    </div>
  );
}
