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
  muted: string;
  success: string;
  warning: string;
  danger: string;
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

export const DEFAULT_THEME: Theme = {
  preset: "rcode-blue",
  // ZCode's brand is monochrome. --color-brand is #ffffff and --color-accent
  // is #001d3d, a near-black blue tint that only ever sits behind white text.
  // The cyan this used (#5DD1FF) was applied to buttons, badges, focus rings
  // and borders simultaneously, so nothing on screen had a clear priority.
  accent: "#ffffff",
  background: "#161616",
  foreground: "#d4d4d4",
  surface: "#202020",
  sidebar: "#161616",
  border: "rgba(255, 255, 255, 0.1)",
  muted: "#919191",
  success: "#46bf72",
  warning: "#ff8a30",
  danger: "#ff5c5c",
  uiFont: "Geist Variable, system-ui, -apple-system, 'Segoe UI', sans-serif",
  codeFont: "'Geist Mono Variable', 'JetBrains Mono', 'Cascadia Code', Menlo, Consolas, monospace",
  // ZCode's base is 14px at scale 1.0.
  fontSizeScale: 1,
  // Tailwind's lg, which is where ZCode puts its controls.
  radius: 8,
  translucentSidebar: false,
  contrast: "medium",
  darkMode: true,
};

export const DEFAULT_SETTINGS: Settings = {
  apiBase: "http://127.0.0.1:3459/v1",
  apiKey: "",
  model: "glm-5.2",
  providerName: "local-proxy",
  globalInstructions: "",
  theme: DEFAULT_THEME,
  enableFeedback: false,
};

export const THEME_PRESETS: Record<ThemePreset, Theme> = {
  "unsloth-mint": {
    preset: "unsloth-mint",
    accent: "#17B88B",
    background: "#181818",
    foreground: "#ECECEC",
    surface: "#212121",
    sidebar: "#1F1F1F",
    border: "#303030",
    muted: "#9B9B9B",
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
    border: "#ffffff1a",
    muted: "#a3a3a3",
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
    muted: "#8A8A8A",
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
    muted: "#6B7280",
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
    // One UI dark. The light variant is the same preset with darkMode: false —
    // applyTheme writes data-mode="light" and the class block in index.css
    // swaps the palette off that attribute.
    accent: "#4d8dff",
    background: "#111318",
    foreground: "#e8eaf0",
    surface: "#1a1d23",
    sidebar: "#15181e",
    border: "rgba(232, 234, 240, 0.12)",
    muted: "#9aa1ae",
    success: "#3ddc84",
    warning: "#ffb300",
    danger: "#ff6b6b",
    uiFont: "Geist Variable, system-ui, -apple-system, 'Segoe UI', sans-serif",
    codeFont: "'Geist Mono Variable', 'JetBrains Mono', 'Cascadia Code', Menlo, Consolas, monospace",
    fontSizeScale: 1,
    // One UI's radius ladder is 8/12/16/24 — much rounder than Tailwind's
    // 4/6/8/12 baseline. The class block pins the exact ladder; this radius
    // only drives applyTheme's derived steps, which the block also overrides.
    radius: 16,
    translucentSidebar: false,
    contrast: "medium",
    darkMode: true,
  },
};

export function applyPreset(preset: ThemePreset, overrides: Partial<Theme> = {}): Theme {
  return { ...THEME_PRESETS[preset], ...overrides, preset };
}
