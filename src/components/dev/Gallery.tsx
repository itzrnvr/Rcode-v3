/*
 * Component gallery — the instrument for verifying the design-system port.
 *
 * Renders with mock data only: no backend, no app state, no window.electron.
 * That independence is the point. Anything that cannot render here has taken a
 * dependency it should not have, so treat a component that needs the app shell
 * to mount as a defect rather than moving the gallery closer to the app.
 *
 * The page is laid out as a specification, not a showcase. Each group is a
 * bounded, labelled frame with a fixed caption rail and hairline-separated
 * rows, because a reference page that drifts into an unstructured stream of
 * samples stops communicating the system it is documenting. The same argument
 * applies to colour: the accent is the primary-action fill, so it appears on
 * one button in a row, not on every control in the block.
 *
 * Nothing here is asserted. Contrast ratios are measured from the live
 * stylesheet at render time and the verdict is shown, so a token change that
 * breaks WCAG AA fails on screen instead of in a code review weeks later.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { applyTheme } from "@/lib/applyTheme";
import { DEFAULT_THEME } from "@/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount } from "@/components/ui/avatar";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsIndicator,
  TabsContent,
} from "@/components/ui/tabs";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { ButtonGroup, ButtonGroupSeparator, ButtonGroupText } from "@/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverTrigger, PopoverContent, PopoverHeader, PopoverTitle, PopoverDescription } from "@/components/ui/popover";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectSeparator,
} from "@/components/ui/select";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";

/* --- specification layout -------------------------------------------------
 *
 * A caption rail plus hairline-separated rows. The rail is fixed so every
 * caption starts at the same x, and rows are separated by a single border
 * rather than by vertical space, which keeps a long document scannable and
 * stops the page from reading as an unstructured pile of samples.
 */

function Spec({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-6">
      <header className="mb-4">
        <h2 className="text-ui-lg font-semibold tracking-tight text-foreground">{title}</h2>
        {note ? (
          <p className="mt-1.5 max-w-[68ch] text-ui-sm leading-relaxed text-foreground-subtle">{note}</p>
        ) : null}
      </header>
      <div className="overflow-hidden rounded-xl border border-card-border bg-card">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 border-t border-border first:border-t-0 sm:grid-cols-[8rem_minmax(0,1fr)]">
      <div className="px-4 pt-3.5 sm:py-4">
        <span className="font-mono text-ui-xs uppercase tracking-wide text-foreground-subtlest">{label}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-4 pb-3.5 sm:py-4 sm:pl-0">{children}</div>
    </div>
  );
}

/* --- live token readout ---------------------------------------------------
 *
 * Values come from the running stylesheet, never from a hard-coded list, so a
 * swatch cannot claim a colour the theme does not actually paint.
 */

function tokenValue(token: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(token).trim();
}

/*
 * Resolve a token to opaque rgb by letting the browser composite it. Several
 * tokens are color-mix() recipes and semi-transparent ones would otherwise be
 * measured against nothing. A detached probe is the only way to read what the
 * user will actually see.
 *
 * Chrome serialises a color-mix() result as color(srgb r g b) with 0-1
 * components, but an authored #rrggbb as rgb(r, g, b) with 0-255. Reading both
 * as the same scale is how this table reported foreground-subtlest at 1.16:1
 * when it is really about 6:1.
 */
function resolveColor(token: string): [number, number, number] | null {
  const c = resolveRGBA(token);
  return c ? [c[0], c[1], c[2]] : null;
}

function resolveRGBA(token: string): [number, number, number, number] | null {
  const probe = document.createElement("span");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.backgroundColor = `var(${token})`;
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).backgroundColor;
  probe.remove();

  const parts = computed.match(/[\d.]+/g);
  if (!parts || parts.length < 3) return null;
  let [r, g, b] = parts.slice(0, 3).map(Number);
  let a = parts.length > 3 ? Number(parts[3]) : 1;
  // color() functions carry their alpha as a fourth number and their
  // components normalised to 0-1. rgb() is 0-255 and 3 components.
  if (computed.startsWith("color(") || parts.length === 4 || Math.max(r, g, b) <= 1) {
    [r, g, b] = [r, g, b].map(v => v * 255);
    if (a > 1) a /= 255;
  }
  return [r, g, b, a];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Composite a translucent colour over a known backdrop. */
function over(rgba: [number, number, number, number], bg: [number, number, number]) {
  const a = Math.min(1, Math.max(0, rgba[3]));
  return [
    rgba[0] * a + bg[0] * (1 - a),
    rgba[1] * a + bg[1] * (1 - a),
    rgba[2] * a + bg[2] * (1 - a),
  ] as [number, number, number];
}

/*
 * Display the colour a token actually resolves to, not its declaration.
 * Derived tokens are color-mix() recipes, and a reference that prints its own
 * source instead of its values is not telling the reader anything. The
 * declaration stays available as the tooltip for anyone who needs to edit it.
 *
 * Alpha is kept. The border ramp is a translucent-foreground scale, so dropping
 * alpha printed #ffffff for four different borders that are in fact 13%, 18%
 * and 22% white - three values rendered as one lie.
 */
function displayValue(token: string): string {
  const c = resolveRGBA(token);
  if (!c) return "undefined";
  const hex = c
    .slice(0, 3)
    .map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0"))
    .join("");
  if (c[3] >= 0.999) return "#" + hex;
  return (
    "#" +
    hex +
    Math.max(0, Math.min(255, Math.round(c[3] * 255)))
      .toString(16)
      .padStart(2, "0")
  );
}

const TEXT_TOKENS = [
  ["--color-foreground", "Primary text"],
  ["--color-foreground-subtle", "Supporting copy, metadata"],
  ["--color-foreground-subtlest", "Placeholders, weak hints"],
  ["--color-accent", "Accent, links, active marks"],
  ["--color-danger", "Destructive"],
  ["--color-success", "Success"],
  ["--color-warning", "Warning"],
] as const;

/*
 * A measured contrast table. Reading the number out of the running theme is
 * the only version of this check that stays true after a theme edit — and it
 * makes the accessibility floor visible instead of assumed.
 */
function ContrastTable() {
  const rows = useMemo(() => {
    const bg = resolveColor("--color-bg");
    const surface = resolveColor("--color-surface");
    if (!bg || !surface) return [];
    return TEXT_TOKENS.map(([token, role]) => {
      const colour = resolveRGBA(token);
      if (!colour) return { token, role, onBg: 0, onSurface: 0, verdict: "unresolved" as const };
      // Measured against the composited colour, not the token's own rgb. The
      // ZCode-derived palette is alpha-based, so measuring raw rgb reported
      // every translucent token at the opacity of the pure foreground and made
      // subtlest come back identical to foreground.
      const onBg = contrastRatio(over(colour, bg), bg);
      const onSurface = contrastRatio(over(colour, surface), surface);
      // AA body text. Tertiary tokens carry placeholders and metadata, which
      // are still body text, so the floor is 4.5 rather than the 3.0 large-text
      // allowance.
      const verdict = onBg >= 4.5 && onSurface >= 4.5 ? "AA" : onBg >= 3 ? "AA large only" : "fails";
      return { token, role, onBg, onSurface, verdict };
    });
  }, []);

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-ui-sm">
        <thead>
          <tr className="border-b border-border text-left">
            {["Token", "Role", "On bg", "On surface", "AA body text"].map(h => (
              <th
                key={h}
                className="px-4 py-2.5 font-mono text-ui-xs font-medium uppercase tracking-wide text-foreground-subtlest"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.token} className="border-b border-border last:border-b-0">
              <td className="whitespace-nowrap px-4 py-2.5 font-mono text-ui-xs text-foreground">
                {r.token.replace("--color-", "")}
              </td>
              <td className="px-4 py-2.5 text-foreground-subtle">{r.role}</td>
              <td className="px-4 py-2.5 font-mono text-ui-xs tabular-nums text-foreground">
                {r.onBg.toFixed(2)}
              </td>
              <td className="px-4 py-2.5 font-mono text-ui-xs tabular-nums text-foreground">
                {r.onSurface.toFixed(2)}
              </td>
              <td className="px-4 py-2.5">
                <span
                  className={
                    "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-ui-xs font-medium " +
                    (r.verdict === "AA"
                      ? "bg-accent-soft text-accent"
                      : "bg-danger-soft text-danger")
                  }
                >
                  <span
                    className="size-1.5 rounded-full"
                    style={{ background: `var(${r.token})` }}
                    aria-hidden
                  />
                  {r.verdict}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* --- swatches ------------------------------------------------------------- */

const SWATCH_GROUPS = [
  {
    role: "Surfaces",
    note: "Four steps, dark to light. Layering uses these rather than alpha fills.",
    tokens: ["--color-bg", "--color-surface", "--color-menu", "--color-sidebar"],
  },
  {
    role: "Hover and active",
    note: "Every hover surface comes from here. One value per file was the old default.",
    tokens: ["--color-hover", "--color-menu-hover", "--color-active"],
  },
  {
    role: "Text",
    tokens: ["--color-foreground", "--color-foreground-subtle", "--color-foreground-subtlest"],
  },
  {
    role: "Accent and status",
    note: "Accent is the primary-action fill and stays sparse. Status colours are for real states.",
    tokens: ["--color-accent", "--color-success", "--color-warning", "--color-danger"],
  },
  {
    role: "Borders",
    note: "Split by what they enclose: a card edge, a popover edge and an input edge are different surfaces.",
    tokens: ["--color-border", "--color-card-border", "--color-popover-border", "--color-input-border"],
  },
] as const;

function Swatch({
  token,
  label,
  copied,
  onCopy,
}: {
  token: string;
  label?: string;
  copied?: boolean;
  onCopy: (token: string) => void;
}) {
  const value = tokenValue(token);
  const resolved = displayValue(token);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(token).then(() => onCopy(token));
      }}
      title={value ? `${token}: ${value}` : `${token} is not defined`}
      className="group -mx-1.5 -my-1 flex min-w-0 items-center gap-2.5 rounded-md px-1.5 py-1 text-left transition-colors duration-(--duration-fast) hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <span className="relative size-6 shrink-0 rounded-md">
        {/* Checkerboard so alpha colours stay legible as alpha. */}
        <span
          aria-hidden
          className="absolute inset-0 rounded-md"
          style={{
            backgroundImage:
              "conic-gradient(#3a3a3a 25%, #262626 0 50%, #3a3a3a 0 75%, #262626 0)",
            backgroundSize: "8px 8px",
          }}
        />
        <span
          className="absolute inset-0 rounded-md border border-border-hover"
          style={{ background: value ? `var(${token})` : "transparent" }}
        />
      </span>
      <span className="truncate font-mono text-ui-xs text-foreground">
        {label ?? token.replace(/^--color-/, "")}
      </span>
      <span
        key={copied ? "copied" : "value"}
        className={
          "ml-auto shrink-0 truncate font-mono text-ui-xs " +
          (copied ? "text-accent" : "text-foreground-subtlest")
        }
      >
        {copied ? "copied" : resolved}
      </span>
    </button>
  );
}

/* --- foundations ---------------------------------------------------------- */

function Foundations({ copied, onCopy }: { copied: string | null; onCopy: (token: string) => void }) {
  return (
    <>
      <Spec
        id="colour"
        title="Colour"
        note="Live values from the running theme, grouped by role. Click a swatch to copy its token. undefined means something references a token that does not exist."
      >
        <Row label="Tokens">
          <div className="w-full space-y-5">
            {SWATCH_GROUPS.map(group => (
              <div key={group.role}>
                <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2.5">
                  <h3 className="text-ui-sm font-medium text-foreground">{group.role}</h3>
                  {"note" in group && group.note ? (
                    <span className="text-ui-xs text-foreground-subtlest">{group.note}</span>
                  ) : null}
                </div>
                <div className="grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
                  {group.tokens.map(t => (
                    <Swatch key={t} token={t} copied={copied === t} onCopy={onCopy} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Row>
        <Row label="Aliases">
          <p className="max-w-[62ch] text-ui-sm text-foreground-subtle">
            The prebuilt components read shadcn names, which map onto the palette above through{" "}
            <code className="font-mono text-ui-xs text-foreground">@theme inline</code>. They are not
            independent values: <code className="font-mono text-ui-xs text-foreground">bg-muted</code> is
            a surface, <code className="font-mono text-ui-xs text-foreground">bg-card</code> is the
            surface token, and{" "}
            <code className="font-mono text-ui-xs text-foreground">text-muted-foreground</code> is
            foreground-subtle.
          </p>
        </Row>
      </Spec>

      <Spec
        id="contrast"
        title="Contrast"
        note="Measured from the live stylesheet at render time, not asserted in a comment. The floor is 4.5:1 because foreground-subtlest carries placeholders and metadata, which are body text. A failing token shows up here rather than in a review."
      >
        <Row label="Measured">
          <div className="w-full">
            <ContrastTable />
          </div>
        </Row>
      </Spec>

      <Spec
        id="elevation"
        title="Elevation"
        note="DESIGN.md: restrained depth. Layer with background contrast and borders first; shadow is for overlays only, and there are exactly two levels."
      >
        <Row label="Levels">
          <div className="grid w-full gap-3 sm:grid-cols-3">
            {[
              ["base", "no shadow — structure from background contrast", ""],
              ["overlay", "menus, popovers, dialogs", "shadow-md"],
              ["attention", "toasts, emphasised floating panels", "shadow-lg"],
            ].map(([name, use, cls]) => (
              <div
                key={name}
                className={
                  "rounded-lg border border-popover-border bg-popover p-3 " + cls
                }
              >
                <div className="font-mono text-ui-xs text-foreground">{name}</div>
                <div className="mt-1 text-ui-xs leading-relaxed text-foreground-subtlest">{use}</div>
              </div>
            ))}
          </div>
        </Row>
      </Spec>

      <Spec
        id="radius"
        title="Radius"
        note="Radius follows container nesting: the first rounded container starts at xl, then steps down lg, md, sm as things nest in."
      >
        <Row label="Nesting">
          <div className="w-full rounded-xl border border-card-border bg-card p-4">
            <div className="font-mono text-ui-xs text-foreground-subtlest">rounded-xl — outer container</div>
            <div className="mt-3 rounded-lg border border-card-border bg-menu p-3">
              <div className="font-mono text-ui-xs text-foreground-subtlest">rounded-lg — panel</div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <div className="rounded-md border border-input-border bg-background px-3 py-1.5 text-ui-xs text-foreground-subtle">
                  rounded-md — control
                </div>
                <span className="rounded-sm bg-hover px-2 py-0.5 font-mono text-ui-xs text-foreground-subtlest">
                  rounded-sm
                </span>
              </div>
            </div>
          </div>
        </Row>
        <Row label="Tokens">
          {["sm", "md", "lg", "xl", "pill"].map(step => (
            <span key={step} className="font-mono text-ui-xs text-foreground-subtle">
              {step} {tokenValue(`--radius-${step}`)}
            </span>
          ))}
        </Row>
      </Spec>

      <Spec
        id="motion"
        title="Motion"
        note="Three durations and one deceleration curve. Overlays enter on the standard curve; exits are faster than entrances because leaving should never hold attention."
      >
        <Row label="Durations">
          {[
            ["fast", "120ms", "hover, press, colour"],
            ["normal", "180ms", "reveal, panel, tooltip"],
            ["slow", "280ms", "large surfaces, sheets"],
          ].map(([name, ms, use]) => (
            <div key={name} className="w-40">
              <div className="font-mono text-ui-xs text-foreground">
                {name} · {ms}
              </div>
              <div className="mt-0.5 text-ui-xs text-foreground-subtlest">{use}</div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-pill bg-hover">
                <div
                  className="h-full w-1/3 rounded-pill bg-accent"
                  style={{ transitionDuration: `var(--duration-${name})` }}
                />
              </div>
            </div>
          ))}
        </Row>
        <Row label="Curve">
          <div className="w-full max-w-lg">
            <p className="text-ui-sm text-foreground-subtle">
              <code className="font-mono text-ui-xs text-foreground">cubic-bezier(0.16, 1, 0.3, 1)</code>{" "}
              — every transition in the app uses this. It starts fast and settles without overshoot,
              which is what makes a tab indicator read as sliding rather than snapping.
            </p>
          </div>
        </Row>
      </Spec>

      <Spec
        id="typography"
        title="Typography"
        note="Interface text uses the text-ui-* scale, chosen by content role. Tailwind's text-base/sm/xs on interface copy is a defect, not a preference."
      >
        <Row label="Scale">
          <div className="grid w-full gap-y-1">
            {["xl", "lg", "base", "caption", "sm", "xs"].map(size => (
              <div key={size} className="flex items-baseline gap-4">
                <span className="w-16 shrink-0 text-right font-mono text-ui-xs text-foreground-subtlest">
                  ui-{size}
                </span>
                <span className={"text-ui-" + size + " text-foreground"}>
                  The quick brown fox jumps over the lazy dog
                </span>
              </div>
            ))}
          </div>
        </Row>
        <Row label="Roles">
          <div className="grid w-full gap-y-1">
            <div className="text-ui-sm text-foreground-subtle">
              foreground-subtle — supporting copy, metadata
            </div>
            <div className="text-ui-sm text-foreground-subtlest">
              foreground-subtlest — placeholders, weak hints
            </div>
            <div className="font-mono text-ui-sm text-foreground">
              font-mono — paths, commands, identifiers, model IDs
            </div>
          </div>
        </Row>
      </Spec>
    </>
  );
}

/* --- components ----------------------------------------------------------- */

function Components() {
  const [checked, setChecked] = useState(true);
  const [model, setModel] = useState("sonnet");
  const [density, setDensity] = useState("comfortable");
  const [menuFlag, setMenuFlag] = useState(true);

  return (
    <>
      <Spec id="button" title="Button" note="Six variants, four text sizes and four icon sizes. The default variant is the primary-action fill, so it appears once per row — a block of accent buttons is not a variant matrix, it is a hierarchy mistake.">
        <Row label="Variants">
          <Button>Default</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="link">Link</Button>
        </Row>
        <Row label="Sizes">
          <Button variant="outline" size="xs">
            xs
          </Button>
          <Button variant="outline" size="sm">
            sm
          </Button>
          <Button variant="outline">
            default
          </Button>
          <Button variant="outline" size="lg">
            lg
          </Button>
        </Row>
        <Row label="Icon">
          {(["icon-xs", "icon-sm", "icon", "icon-lg"] as const).map(size => (
            <Button key={size} variant="outline" size={size} aria-label={size}>
              +
            </Button>
          ))}
        </Row>
        <Row label="States">
          <Button disabled>Disabled</Button>
          <Button aria-invalid>Invalid</Button>
          <Button disabled>
            <Spinner /> Loading
          </Button>
        </Row>
        <Row label="In context">
          <div className="w-full rounded-lg border border-card-border bg-background p-4">
            <p className="text-ui-sm text-foreground-subtle">
              One primary action per view. Everything else is secondary or ghost, which is why this row
              reads as a decision rather than a palette.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="ghost" size="sm">
                Cancel
              </Button>
              <Button size="sm">Save changes</Button>
            </div>
          </div>
        </Row>
      </Spec>

      <Spec id="badge" title="Badge" note="Compact status markers. Like the button, only the default variant carries the accent fill.">
        <Row label="Variants">
          <Badge>Active</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="destructive">Failed</Badge>
          <Badge variant="outline">Draft</Badge>
          <Badge variant="ghost">Ghost</Badge>
        </Row>
      </Spec>

      <Spec
        id="input"
        title="Input"
        note="Inputs draw the interactive border step, not the separator border. An input edge is a control boundary and has to read as one; a card edge does not."
      >
        <Row label="Text">
          <Input placeholder="Default" className="w-56" />
          <Input placeholder="Disabled" disabled className="w-56" />
          <Input placeholder="Invalid" aria-invalid className="w-56" />
        </Row>
        <Row label="Grouped">
          <InputGroup className="w-full max-w-sm">
            <InputGroupAddon align="inline-start">
              <InputGroupButton aria-label="Search">
                @
              </InputGroupButton>
            </InputGroupAddon>
            <InputGroupInput placeholder="Search sessions" />
          </InputGroup>
        </Row>
        <Row label="Textarea">
          <Textarea placeholder="Describe the change" className="w-full max-w-sm" rows={2} />
        </Row>
      </Spec>

      <Spec id="controls" title="Selection controls" note="Controls that flip a boolean. The switch carries the accent only when it is on.">
        <Row label="Switch">
          <Switch checked={checked} onCheckedChange={setChecked} aria-label="Default switch" />
          <Switch size="sm" defaultChecked aria-label="Small switch" />
          <Switch disabled aria-label="Disabled switch" />
        </Row>
        <Row label="Segmented">
          <ButtonGroup>
            {["comfortable", "compact"].map(v => (
              <Button
                key={v}
                variant="ghost"
                size="sm"
                className={density === v ? "bg-active text-foreground" : undefined}
                onClick={() => setDensity(v)}
              >
                {v}
              </Button>
            ))}
          </ButtonGroup>
          <span className="text-ui-xs text-foreground-subtlest">density: {density}</span>
        </Row>
        <Row label="Joined">
          <ButtonGroup>
            <Button variant="outline" size="sm">
              Copy
            </Button>
            <ButtonGroupSeparator />
            <Button variant="outline" size="sm">
              Edit
            </Button>
            <ButtonGroupSeparator />
            <ButtonGroupText>3 actions</ButtonGroupText>
          </ButtonGroup>
        </Row>
      </Spec>

      <Spec
        id="tabs"
        title="Tabs"
        note="The indicator slides on the shared deceleration curve and the panel cross-fades, so switching reads as movement rather than a repaint."
      >
        <Row label="Line">
          <Tabs defaultValue="one" className="w-full">
            <TabsList variant="line" className="w-fit">
              <TabsTrigger value="one">First</TabsTrigger>
              <TabsTrigger value="two">Second</TabsTrigger>
              <TabsTrigger value="three">Third</TabsTrigger>
              <TabsIndicator />
            </TabsList>
            <TabsContent value="one" className="pt-4 text-ui-sm text-foreground-subtle">
              First panel content.
            </TabsContent>
            <TabsContent value="two" className="pt-4 text-ui-sm text-foreground-subtle">
              Second panel content.
            </TabsContent>
            <TabsContent value="three" className="pt-4 text-ui-sm text-foreground-subtle">
              Third panel content.
            </TabsContent>
          </Tabs>
        </Row>
      </Spec>

      <Spec id="card" title="Card" note="Cards start at rounded-xl and step down when nested. The card border is a step brighter than a separator.">
        <Row label="Default">
          <Card className="w-full max-w-sm">
            <CardHeader>
              <CardTitle>Session summary</CardTitle>
              <CardDescription>Tokens used, cost and wall time for the last turn.</CardDescription>
            </CardHeader>
            <CardContent className="text-ui-sm text-foreground-subtle">
              Cards carry content, not chrome. A card that needs a border to separate itself from the
              page has picked the wrong surface.
            </CardContent>
            <CardFooter className="gap-2">
              <Button size="sm">Open</Button>
              <Button size="sm" variant="ghost">
                Dismiss
              </Button>
            </CardFooter>
          </Card>
        </Row>
      </Spec>

      <Spec id="disclosure" title="Accordion and collapsible" note="Disclosure patterns. Both use the fast duration on open so the answer is available before the motion finishes.">
        <Row label="Accordion">
          <Accordion defaultValue={["item-1"]} className="w-full max-w-md">
            <AccordionItem value="item-1">
              <AccordionTrigger>Why is the accent sparse?</AccordionTrigger>
              <AccordionContent className="text-ui-sm text-foreground-subtle">
                Because accent marks the primary action. Filling every control with it removes the
                signal and leaves the page looking like a demo.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="item-2">
              <AccordionTrigger>When is shadow allowed?</AccordionTrigger>
              <AccordionContent className="text-ui-sm text-foreground-subtle">
                Only for overlays. Layout separation comes from background contrast and borders.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </Row>
        <Row label="Collapsible">
          <Collapsible className="w-full max-w-md">
            <CollapsibleTrigger
              render={<Button variant="outline" size="sm" />}
              className="w-full justify-between"
            >
              Show trace
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3 text-ui-sm text-foreground-subtle">
              A single independent region, as opposed to the accordion&apos;s exclusive set.
            </CollapsibleContent>
          </Collapsible>
        </Row>
      </Spec>

      <Spec
        id="overlays"
        title="Overlays"
        note="Menus, popovers, hover cards, tooltips and dialogs. All five share bg-menu, the popover border step and shadow-md — a single elevation level for everything that floats."
      >
        <Row label="Menu">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
              Actions
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              {/* GroupLabel is Base UI's, and it throws when opened outside a
                  Group - which unmounts the entire gallery, not just the menu.
                  Any label in a menu needs the wrapper. */}
              <DropdownMenuGroup>
                <DropdownMenuLabel>Session</DropdownMenuLabel>
                <DropdownMenuItem>Rename</DropdownMenuItem>
                <DropdownMenuItem>Duplicate</DropdownMenuItem>
                <DropdownMenuCheckboxItem
                  checked={menuFlag}
                  onCheckedChange={setMenuFlag}
                >
                  Pin to sidebar
                </DropdownMenuCheckboxItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Row>
        <Row label="Popover">
          <Popover>
            <PopoverTrigger render={<Button variant="outline" size="sm" />}>
              Filters
            </PopoverTrigger>
            <PopoverContent className="w-64">
              <PopoverHeader>
                <PopoverTitle>Filter turns</PopoverTitle>
                <PopoverDescription>Narrow the trajectory to specific steps.</PopoverDescription>
              </PopoverHeader>
              <div className="mt-3 flex gap-2">
                <Button size="sm">Apply</Button>
                <Button size="sm" variant="ghost">
                  Reset
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </Row>
        <Row label="Tooltip">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger render={<Button variant="outline" size="sm" />}>
                Hover me
              </TooltipTrigger>
              <TooltipContent>Transient, non-interactive, no close affordance.</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </Row>
        <Row label="Dialog">
          <Dialog>
            <DialogTrigger render={<Button variant="outline" size="sm" />}>
              Open dialog
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete session</DialogTitle>
                <DialogDescription>
                  This removes the session and its trace. It cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button size="sm" variant="ghost">
                  Cancel
                </Button>
                <Button size="sm" variant="destructive">
                  Delete
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </Row>
      </Spec>

      <Spec id="select" title="Select" note="For choosing one option from a known set. Where the options are a searchable list, use Command instead.">
        <Row label="Default">
          <Select value={model} onValueChange={v => setModel(v ?? "sonnet")}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectLabel>Models</SelectLabel>
              <SelectItem value="sonnet">Sonnet</SelectItem>
              <SelectItem value="opus">Opus</SelectItem>
              <SelectSeparator />
              <SelectItem value="local">Local checkpoint</SelectItem>
            </SelectContent>
          </Select>
        </Row>
      </Spec>

      <Spec id="command" title="Command" note="Search-first selection. The input is part of the component, so the search field and its results share one surface.">
        <Row label="Default">
          <Command className="w-full max-w-sm rounded-lg border border-popover-border bg-popover">
            <CommandInput placeholder="Type a command or search…" />
            <CommandList>
              <CommandEmpty>No results.</CommandEmpty>
              <CommandGroup heading="Actions">
                <CommandItem value="new-session">New session</CommandItem>
                <CommandItem value="fork-session">Fork session</CommandItem>
                <CommandItem value="clear-history">Clear history</CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </Row>
      </Spec>

      <Spec id="scroll" title="Scroll area" note="Custom scrollbars replace the browser default so they follow the theme. Unstyled overflow is the one surface no design system controls.">
        <Row label="Clipped">
          <ScrollArea className="h-40 w-full max-w-xs rounded-lg border border-card-border">
            <div className="p-4 text-ui-sm text-foreground-subtle">
              {Array.from({ length: 12 }).map((_, i) => (
                <p key={i} className="py-1">
                  Trace event {i + 1}
                </p>
              ))}
            </div>
            <ScrollBar orientation="vertical" />
          </ScrollArea>
        </Row>
      </Spec>

      <Spec id="identity" title="Avatar" note="Identity markers. Fallback initials must stay legible when no image has loaded.">
        <Row label="Sizes">
          <Avatar className="size-6">
            <AvatarFallback className="text-ui-2xs">RC</AvatarFallback>
          </Avatar>
          <Avatar>
            <AvatarFallback>RC</AvatarFallback>
          </Avatar>
          <Avatar className="size-12">
            <AvatarFallback>RC</AvatarFallback>
          </Avatar>
        </Row>
        <Row label="Group">
          <AvatarGroup>
            {["A", "B", "C"].map(c => (
              <Avatar key={c}>
                <AvatarFallback>{c}</AvatarFallback>
              </Avatar>
            ))}
            <AvatarGroupCount>+4</AvatarGroupCount>
          </AvatarGroup>
        </Row>
      </Spec>

      <Spec id="feedback" title="Feedback" note="Progress and alerts report a state; spinners report that work is happening. None of them interrupt.">
        <Row label="Progress">
          <div className="w-full max-w-xs space-y-3">
            <Progress value={60} />
            <Progress value={18} />
            <Progress value={100} />
          </div>
        </Row>
        <Row label="Spinner">
          <Spinner />
        </Row>
        <Row label="Alert">
          <div className="w-full max-w-2xl space-y-2">
            <Alert>
              <AlertTitle>Checkpoint saved</AlertTitle>
              <AlertDescription>Neutral surface for non-blocking information.</AlertDescription>
            </Alert>
            <Alert variant="destructive">
              <AlertTitle>Engine not wired</AlertTitle>
              <AlertDescription>Reserved for genuine failure states.</AlertDescription>
            </Alert>
          </div>
        </Row>
      </Spec>

      <Spec id="separator" title="Separator" note="A one-pixel rule. Preferred over adding a border to everything around it.">
        <Row label="Horizontal">
          <div className="w-full max-w-sm space-y-4">
            <p className="text-ui-sm text-foreground-subtle">Content above.</p>
            <Separator />
            <p className="text-ui-sm text-foreground-subtle">Content below.</p>
          </div>
        </Row>
        <Row label="Vertical">
          <div className="flex h-6 items-center gap-3">
            <span className="text-ui-sm text-foreground-subtle">Left</span>
            <Separator orientation="vertical" className="h-4" />
            <span className="text-ui-sm text-foreground-subtle">Right</span>
          </div>
        </Row>
      </Spec>
    </>
  );
}

/* --- page ----------------------------------------------------------------- */

const NAV = [
  ["foundations", "Foundations"],
  ["colour", "Colour"],
  ["contrast", "Contrast"],
  ["elevation", "Elevation"],
  ["radius", "Radius"],
  ["motion", "Motion"],
  ["typography", "Typography"],
  ["button", "Button"],
  ["badge", "Badge"],
  ["input", "Input"],
  ["controls", "Controls"],
  ["tabs", "Tabs"],
  ["card", "Card"],
  ["disclosure", "Disclosure"],
  ["overlays", "Overlays"],
  ["select", "Select"],
  ["command", "Command"],
  ["scroll", "Scroll area"],
  ["identity", "Avatar"],
  ["feedback", "Feedback"],
  ["separator", "Separator"],
] as const;

export default function Gallery() {
  const [copied, setCopied] = useState<string | null>(null);
  const resetRef = useRef<number | undefined>(undefined);

  // One acknowledgement at a time, self-clearing so the feedback never sticks.
  const copyToken = (token: string) => {
    setCopied(token);
    window.clearTimeout(resetRef.current);
    resetRef.current = window.setTimeout(() => setCopied(null), 1200);
  };
  useEffect(() => () => window.clearTimeout(resetRef.current), []);

  // Same palette the app renders by default, applied as CSS variables only —
  // no React state, no Electron bridge, so this page stays isolated.
  applyTheme(DEFAULT_THEME);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex max-w-6xl gap-12 px-8 py-14">
        <nav className="sticky top-14 hidden h-fit w-44 shrink-0 self-start lg:block">
          <p className="px-2 font-mono text-ui-xs uppercase tracking-wide text-foreground-subtlest">
            Foundations
          </p>
          <ul className="mt-1.5 space-y-px">
            {NAV.slice(1, 7).map(([id, label]) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  className="block rounded-md px-2 py-1 text-ui-sm text-foreground-subtle transition-colors duration-(--duration-fast) hover:bg-hover hover:text-foreground"
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-5 px-2 font-mono text-ui-xs uppercase tracking-wide text-foreground-subtlest">
            Components
          </p>
          <ul className="mt-1.5 space-y-px">
            {NAV.slice(7).map(([id, label]) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  className="block rounded-md px-2 py-1 text-ui-sm text-foreground-subtle transition-colors duration-(--duration-fast) hover:bg-hover hover:text-foreground"
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <main className="min-w-0 flex-1">
          <header className="mb-12">
            <h1 className="text-ui-xl font-semibold tracking-tight text-foreground">
              Rcode component gallery
            </h1>
            <p className="mt-2 max-w-[68ch] text-ui-sm leading-relaxed text-foreground-subtle">
              Every surface in the system, rendered in isolation with mock data — no backend, no app
              state, no Electron bridge. Contrast is measured from the running stylesheet rather than
              asserted here, so this page fails loudly when a token does.
            </p>
          </header>

          <div className="space-y-14">
            <Foundations copied={copied} onCopy={copyToken} />
            <Components />
          </div>

          <footer className="mt-16 border-t border-border pt-4 text-ui-xs text-foreground-subtlest">
            Design authority: <span className="font-mono">DESIGN.md</span> (copied from
            zai-org/ZCode, Apache-2.0).
          </footer>
        </main>
      </div>
    </div>
  );
}
