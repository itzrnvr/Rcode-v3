/*
 * PURPOSE: React binding for applyTheme.
 *
 * Called once in App.tsx. Whenever the theme changes (from settings), the CSS
 * variables update and the entire app re-themes instantly.
 *
 * The actual work lives in applyTheme so non-React surfaces (the component
 * gallery) can apply the same theme without mounting the app.
 */

import { useEffect } from "react";

import type { Theme } from "../types";
import { applyTheme } from "../lib/applyTheme";

export function useTheme(theme: Theme): void {
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
}
