import { defineConfig, devices } from "@playwright/test";

/**
 * Responsive regression suite.
 *
 * These are the behaviours we have been checking by hand in a browser, which
 * is exactly the class of bug unit tests cannot see: jsdom has no layout
 * engine, no media queries and no real hit-testing, so a panel that overflows
 * or a control that overlaps at a breakpoint passes every `render()` test.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 30_000,
  expect: { timeout: 7_000 },

  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "tablet",
      use: { ...devices["Desktop Chrome"], viewport: { width: 834, height: 1112 } },
    },
    {
      name: "mobile",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, hasTouch: true },
    },
  ],

  webServer: {
    command: "npm run dev:web",
    url: "http://127.0.0.1:5173/gallery.html",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
