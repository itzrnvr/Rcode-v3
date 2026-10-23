/*
 * esbuild entry for tests/trace-ssr.test.ts. Never imported by node directly —
 * esbuild compiles it (and src/components/ui/trace.tsx, which node cannot
 * parse because of JSX, and resolve whose "@/..." alias) into a single
 * self-contained ESM bundle in the OS temp dir, which the test then imports.
 */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Trace,
  TraceLine,
  TraceIcon,
  TraceTitle,
  TraceDescription,
  TraceCollapsible,
  TraceCollapsibleTrigger,
  TraceCollapsibleContent,
} from "../src/components/ui/trace";

export function render(ui: React.ReactElement): string {
  return renderToStaticMarkup(ui);
}

export const h = React.createElement;

export {
  Trace,
  TraceLine,
  TraceIcon,
  TraceTitle,
  TraceDescription,
  TraceCollapsible,
  TraceCollapsibleTrigger,
  TraceCollapsibleContent,
};
