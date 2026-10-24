/*
 * PURPOSE: App-wide React context — shared state that multiple components need
 *
 * Provides:
 * - currentSessionId + setter (which session is active in the chat panel)
 * - settings + refresh (API config, global instructions, theme)
 * - showSettings + setter (settings modal visibility)
 * - sessionListVersion + bumper (triggers SessionList reload on create/delete)
 *
 * ARCHITECTURE: Domain hooks (useSessions, useChat, useSideChats) are NOT in
 * context — they're called by individual components and parameterized by
 * currentSessionId from this context. This keeps re-renders scoped.
 */

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

import { api } from "../api/client";

import type { Settings } from "../types";
import { DEFAULT_SETTINGS } from "../types";

interface AppContextValue {
  currentSessionId: string | null;
  setCurrentSessionId: (id: string | null) => void;
  settings: Settings;
  refreshSettings: () => Promise<void>;
  setSetting: (key: string, value: string) => Promise<void>;
  showSettings: boolean;
  setShowSettings: (show: boolean) => void;
  sessionListVersion: number;
  bumpSessionList: () => void;
  sideChatVersion: number;
  bumpSideChats: () => void;
  hasSideChats: boolean;
  setHasSideChats: (v: boolean) => void;
  sidePanelCollapsed: boolean;
  setSidePanelCollapsed: (v: boolean) => void;
  collapseSidePanelTransiently: (v: boolean) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (v: boolean) => void;
  collapseSidebarTransiently: (v: boolean) => void;
  sidePanelWidth: number;
  setSidePanelWidth: (n: number) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);
  const [sessionListVersion, setSessionListVersion] = useState(0);
  const [sideChatVersion, setSideChatVersion] = useState(0);
  const [hasSideChats, setHasSideChats] = useState(false);
  const [sidePanelCollapsed, setSidePanelCollapsedState] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsedState] = useState(false);
  const [sidePanelWidth, setSidePanelWidthState] = useState(320);

  const refreshSettings = useCallback(async () => {
    const s = await api.getSettings();
    setSettings(s);
  }, []);

  // The database is the source of truth. If a session disappears while the UI
  // still holds its ID, release the stale ID instead of letting later chat
  // operations fail with an opaque backend error.
  useEffect(() => {
    if (!currentSessionId) return;
    let cancelled = false;

    api.getSession(currentSessionId).then(session => {
      if (cancelled || session) return;
      setCurrentSessionId(null);
      setSessionListVersion(version => version + 1);
    }).catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [currentSessionId]);

  const setSetting = useCallback(async (key: string, value: string) => {
    await api.setSetting(key, value);
    // Optimistically update local state
    setSettings(prev => {
      if (key === "theme") {
        try { return { ...prev, theme: JSON.parse(value) }; }
        catch { return prev; }
      }
      return { ...prev, [key]: value } as Settings;
    });
  }, []);

  useEffect(() => {
    refreshSettings();
  }, [refreshSettings]);

  useEffect(() => {
    api.getSetting("sidePanelCollapsed").then(v => { if (v === "false") setSidePanelCollapsedState(false); }).catch(() => {});
    api.getSetting("sidebarCollapsed").then(v => { if (v === "true") setSidebarCollapsedState(true); }).catch(() => {});
    api.getSetting("sidePanelWidth").then(v => { const n = parseInt(v ?? "", 10); if (!isNaN(n) && n >= 240 && n <= 600) setSidePanelWidthState(n); }).catch(() => {});
  }, []);

  const setSidePanelCollapsed = useCallback(async (v: boolean) => {
    setSidePanelCollapsedState(v);
    await api.setSetting("sidePanelCollapsed", v ? "true" : "false");
  }, []);
  const setSidebarCollapsed = useCallback(async (v: boolean) => {
    setSidebarCollapsedState(v);
    await api.setSetting("sidebarCollapsed", v ? "true" : "false");
  }, []);
  /*
   * Responsive collapse must not persist. The auto-collapse in App.tsx runs on
   * every narrow window, and because it went through setSidebarCollapsed it
   * wrote "true" to the database - so opening the app in a small window
   * permanently collapsed the sidebar in every window, including wide ones.
   * Only an explicit user toggle is a preference worth keeping.
   */
  const collapseSidebarTransiently = useCallback((v: boolean) => {
    setSidebarCollapsedState(v);
  }, []);
  const collapseSidePanelTransiently = useCallback((v: boolean) => {
    setSidePanelCollapsedState(v);
  }, []);
  const setSidePanelWidth = useCallback(async (n: number) => {
    setSidePanelWidthState(n);
    await api.setSetting("sidePanelWidth", String(n));
  }, []);

  const bumpSessionList = useCallback(() => {
    setSessionListVersion(v => v + 1);
  }, []);

  const bumpSideChats = useCallback(() => {
    setSideChatVersion(v => v + 1);
  }, []);

  const value: AppContextValue = {
    currentSessionId,
    setCurrentSessionId,
    settings,
    refreshSettings,
    setSetting,
    showSettings,
    setShowSettings,
    sessionListVersion,
    bumpSessionList,
    sideChatVersion,
    bumpSideChats,
    hasSideChats,
    setHasSideChats,
    sidePanelCollapsed,
    setSidePanelCollapsed,
    collapseSidePanelTransiently,
    sidebarCollapsed,
    setSidebarCollapsed,
    collapseSidebarTransiently,
    sidePanelWidth,
    setSidePanelWidth,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
