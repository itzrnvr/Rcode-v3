/*
 * PURPOSE: Custom instructions editor — global + per-session instructions
 *
 * Global instructions apply to all sessions.
 * Per-session instructions apply only to the currently selected session.
 * Both auto-save on blur (no explicit save button needed).
 *
 * CONSUMERS: settings/SettingsModal.tsx
 */

import { useState, useEffect, useCallback } from "react";

import { useSettings } from "../../state/useSettings";
import { useApp } from "../../state/AppContext";
import { api } from "../../api/client";

export function InstructionsEditor() {
  const { settings, updateSetting } = useSettings();
  const { currentSessionId } = useApp();

  const [globalText, setGlobalText] = useState(settings.globalInstructions);
  const [sessionText, setSessionText] = useState("");
  const [sessionTitle, setSessionTitle] = useState("");

  // Load per-session instructions when session changes
  useEffect(() => {
    if (!currentSessionId) {
      setSessionText("");
      setSessionTitle("");
      return;
    }
    api.getSession(currentSessionId).then(s => {
      if (s) {
        setSessionText(s.customInstructions ?? "");
        setSessionTitle(s.title);
      }
    });
  }, [currentSessionId]);

  // Sync global text when settings change externally
  useEffect(() => {
    setGlobalText(settings.globalInstructions);
  }, [settings.globalInstructions]);

  const saveGlobal = useCallback(() => {
    if (globalText !== settings.globalInstructions) {
      updateSetting("globalInstructions", globalText);
    }
  }, [globalText, settings.globalInstructions, updateSetting]);

  const saveSession = useCallback(() => {
    if (!currentSessionId) return;
    api.updateSession(currentSessionId, { customInstructions: sessionText });
  }, [currentSessionId, sessionText]);

  return (
    <div>
      <h3 className="text-ui-base font-semibold" style={{ marginBottom: 12 }}>Custom Instructions</h3>

      <div className="settings-row">
        <label>Global Instructions (all sessions)</label>
        <textarea
          value={globalText}
          onChange={e => setGlobalText(e.target.value)}
          onBlur={saveGlobal}
          placeholder="e.g. Always use TypeScript. Prefer functional components."
        />
      </div>

      {currentSessionId && (
        <div className="settings-row">
          <label>Session Instructions — {sessionTitle}</label>
          <textarea
            value={sessionText}
            onChange={e => setSessionText(e.target.value)}
            onBlur={saveSession}
            placeholder="Instructions specific to this session..."
          />
        </div>
      )}

      {!currentSessionId && (
        <div className="text-ui-caption" style={{ color: "var(--color-foreground-subtle)", padding: 8 }}>
          Select a session to edit its per-session instructions.
        </div>
      )}
    </div>
  );
}
