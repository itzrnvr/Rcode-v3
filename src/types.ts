// Core domain types for Rcode

export type TaskType = "main" | "side_chat";
export type SessionStatus = "active" | "closed" | "promoted";
export type MessageRole = "user" | "assistant" | "system";

export interface Session {
  id: string;
  parentId: string | null;
  title: string;
  taskType: TaskType;
  status: SessionStatus;
  model: string;
  provider: string;
  customInstructions: string | null;
  createdAt: number;
  updatedAt: number;
  depth: number;
  sortOrder?: number;
  isPinned?: number;
  pinnedAt?: number;
}

export interface Message {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  createdAt: number;
  versions?: string[];
  versionIndex?: number;
  turn?: AgentTurn;
  turnVersions?: AgentTurn[];
}

export interface TurnUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  reasoning_tokens?: number;
  cached_tokens?: number;
}

export type AgentTurnEvent =
  | { kind: "reasoning"; text: string }
  | { kind: "response"; text: string }
  | { kind: "tool_call"; name: string; args?: string; status?: "running" | "done" }
  | { kind: "tool_result"; name: string; result?: string; isError?: boolean; status?: "running" | "done" };

export interface AgentTurn {
  secs: number;
  usage?: TurnUsage;
  events: AgentTurnEvent[];
  finalContent: string;
}

export type LiveStep = AgentTurnEvent & {
  status?: "running" | "done";
  bornAt?: number;
};

export interface SideChatTab {
  id: string;
  parentSessionId: string;
  sideChatId: string;
  tabOrder: number;
  isClosed: boolean;
  createdAt: number;
  sideChatTitle?: string;
  sideChatStatus?: SessionStatus;
  sideChatDepth?: number;
}

export interface Theme {
  preset: ThemePreset;
  accent: string;
  background: string;
  foreground: string;
  surface: string;
  sidebar: string;
  border: string;
  /**
   * The muted text colour, as a CSS colour value - usually a mix rather than
   * a hex, because the text ladder is derived from the foreground so that it
   * reads correctly on every surface it lands on. It is shown in the preset
   * preview card but it is not editable: a colour picker for it would let
   * somebody break the measured contrast ladder, which is exactly what the
   * gallery's contrast table exists to police.
   */
  muted: string;
  success: string;
  warning: string;
  danger: string;
  /**
   * The palette in light mode, for the presets that have one. One UI does;
   * the monochrome family does not, because its light member is a preset of
   * its own.
   */
  light?: Partial<Theme>;
  uiFont: string;
  codeFont: string;
  fontSizeScale: number;
  radius: number;
  translucentSidebar: boolean;
  contrast: "low" | "medium" | "high";
  darkMode: boolean;
}

// "one-ui" is the Samsung One UI prototype preset (oneui.html). Its palette,
// radius ladder, type scale and motion live in the [data-theme="one-ui"] block
// at the end of index.css; the THEME_PRESETS entry below only feeds the
// settings preview card and applyTheme's inline writes, which the class block
// overrides.
export type ThemePreset = "unsloth-mint" | "rcode-blue" | "classic-dark" | "light-classic" | "one-ui";

export interface Settings {
  reasoningEffort?: string;
  apiBase: string;
  apiKey: string;
  model: string;
  providerName: string;
  globalInstructions: string;
  theme: Theme;
  enableFeedback?: boolean;
}

export interface CreateSessionInput {
  parentId?: string | null;
  title?: string;
  taskType?: TaskType;
  model?: string;
  provider?: string;
  customInstructions?: string;
}

export interface CreateSideChatInput {
  parentSessionId: string;
  title?: string;
  model?: string;
  provider?: string;
  selectedText?: string;
}

export interface ChatChunk {
  content: string;
  done: boolean;
  reasoning?: string;
  kind?: "tool_call" | "tool_result";
  tool?: { name: string; args?: string; result?: string };
  secs?: number;
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; completion_tokens_details?: { reasoning_tokens?: number } };
}

export interface ChatRequest {
  sessionId: string;
  userMessage: string;
  model?: string;
  mode?: string;
  reasoningEffort?: string;
}

export const THEME_PRESETS: Record<ThemePreset, Theme> = {
  "unsloth-mint": {
    preset: "unsloth-mint",
    accent: "#17B88B",
    background: "#181818",
    foreground: "#ECECEC",
    surface: "#212121",
    sidebar: "#1F1F1F",
    border: "#303030",
    muted: "color-mix(in srgb, #ECECEC 70%, transparent)",
    success: "#17B88B",
    warning: "#FFD60A",
    danger: "#FF5C5C",
    uiFont: "Inter, system-ui, sans-serif",
    codeFont: "'JetBrains Mono', monospace",
    fontSizeScale: 1,
    radius: 10,
    translucentSidebar: true,
    contrast: "medium",
    darkMode: true,
  },
  "rcode-blue": {
    preset: "rcode-blue",
    accent: "#5DD1FF",
    background: "#161616",
    foreground: "#e5e5e5",
    surface: "#202020",
    sidebar: "#161616",
    border: "rgba(255, 255, 255, 0.1)",
    muted: "color-mix(in srgb, #e5e5e5 70%, transparent)",
    success: "#17B88B",
    warning: "#FACC15",
    danger: "#dc2626",
    uiFont: "Inter, system-ui, sans-serif",
    codeFont: "'JetBrains Mono', monospace",
    fontSizeScale: 1,
    radius: 10,
    translucentSidebar: true,
    contrast: "medium",
    darkMode: true,
  },
  "classic-dark": {
    preset: "classic-dark",
    accent: "#3B82F6",
    background: "#0F0F0F",
    foreground: "#E5E5E5",
    surface: "#1E1E1E",
    sidebar: "#141414",
    border: "#2A2A2A",
    muted: "color-mix(in srgb, #E5E5E5 70%, transparent)",
    success: "#10B981",
    warning: "#F59E0B",
    danger: "#EF4444",
    uiFont: "Inter, system-ui, sans-serif",
    codeFont: "'JetBrains Mono', monospace",
    fontSizeScale: 1,
    radius: 8,
    translucentSidebar: false,
    contrast: "medium",
    darkMode: true,
  },
  "light-classic": {
    preset: "light-classic",
    accent: "#2563EB",
    background: "#FFFFFF",
    foreground: "#111111",
    surface: "#F8F8F8",
    sidebar: "#F0F0F0",
    border: "#E5E5E5",
    muted: "color-mix(in srgb, #111111 70%, transparent)",
    success: "#059669",
    warning: "#D97706",
    danger: "#DC2626",
    uiFont: "Inter, system-ui, sans-serif",
    codeFont: "'JetBrains Mono', monospace",
    fontSizeScale: 1,
    radius: 8,
    translucentSidebar: false,
    contrast: "medium",
    darkMode: false,
  },
  "one-ui": {
    preset: "one-ui",
    // One UI dark. These values are the SAME as the [data-theme="one-ui"]
    // block in index.css, and they have to stay the same: applyTheme writes
    // them inline and the stylesheet writes them as the first-paint fallback,
    // so if the two drift the app changes colour when it hydrates.
    accent: "#4d8dff",
    background: "#111318",
    foreground: "#e8eaf0",
    surface: "#1a1d23",
    sidebar: "#15181e",
    border: "rgba(232, 234, 240, 0.12)",
    muted: "color-mix(in srgb, #e8eaf0 65%, transparent)",
    success: "#3ddc84",
    warning: "#ffb300",
    danger: "#ff6b6b",
    // The light variant of the same language. applyTheme writes these when
    // darkMode is false, so the two stay in step with the class block.
    light: {
      accent: "#0064ff",
      background: "#f2f3f5",
      foreground: "#1b1f2a",
      surface: "#ffffff",
      sidebar: "#f7f8fa",
      border: "rgba(27, 31, 42, 0.1)",
      muted: "color-mix(in srgb, #1b1f2a 70%, transparent)",
      success: "#1e8e3e",
      warning: "#b26a00",
      danger: "#d93025",
    },
    uiFont: "Geist Variable, system-ui, -apple-system, 'Segoe UI', sans-serif",
    codeFont: "'Geist Mono Variable', 'JetBrains Mono', 'Cascadia Code', Menlo, Consolas, monospace",
    fontSizeScale: 1,
    // One UI's radius ladder is 8/12/16/24 — much rounder than Tailwind's
    // 4/6/8/12 baseline. The ladder itself is derived from this number in
    // the stylesheet, so the radius slider moves all four steps together.
    radius: 16,
    translucentSidebar: false,
    contrast: "medium",
    darkMode: true,
  },
};

/**
 * The app's default theme.
 *
 * One UI is the product's design language, not a gallery experiment: the app,
 * the gallery and the prototype all render it, so the default has to be it.
 * Every other preset stays selectable in Settings -> Theme, so the earlier
 * looks remain one click away.
 *
 * It is a copy, not a reference to the preset entry. applyTheme writes the
 * theme onto documentElement and the settings editor mutates it in place, so
 * a shared object would leak those edits back into the preset table.
 */
export const DEFAULT_THEME: Theme = { ...THEME_PRESETS["one-ui"] };

export const DEFAULT_SETTINGS: Settings = {
  apiBase: "http://127.0.0.1:3459/v1",
  apiKey: "",
  model: "glm-5.2",
  providerName: "local-proxy",
  globalInstructions: "",
  theme: DEFAULT_THEME,
  enableFeedback: false,
};

export function applyPreset(preset: ThemePreset, overrides: Partial<Theme> = {}): Theme {
  return { ...THEME_PRESETS[preset], ...overrides, preset };
}
