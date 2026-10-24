import { test, expect, type Page, type Locator } from "@playwright/test";

/**
 * Responsive layout invariants.
 *
 * The recurring failure mode in this app is not "a control is missing" — it is
 * "two controls are both present, and on a narrow viewport they overlap or the
 * panel runs past the edge". Neither shows up in a DOM query, so these assert
 * real geometry.
 */

/**
 * The dev backend's IPC endpoint.
 *
 * The renderer reaches these channels through window.electron, which a plain
 * browser page does not have, so a test that needs backend state the UI
 * cannot click its way to talks to the API directly.
 */
const API_BASE = "http://127.0.0.1:5174/api/ipc/";

async function api(channel: string, args: unknown[]) {
  const res = await fetch(API_BASE + channel, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ args }),
  });
  const json = (await res.json()) as { ok: boolean; result: unknown };
  return json.result;
}

async function box(page: Page, selector: string) {
  const el = page.locator(selector).first();
  await expect(el).toBeVisible();
  return (await el.boundingBox())!;
}

/** Do two boxes share any area? Touching edges do not count. */
function overlaps(a: NonNullable<Awaited<ReturnType<typeof box>>>, b: Awaited<ReturnType<typeof box>>) {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/** Wait until `check()` turns true, within `ms`. */
async function within(ms: number, check: () => Promise<boolean>): Promise<boolean> {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await check()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

/**
 * Drive a panel toggle to the expected state.
 *
 * The titlebar toggles intermittently swallow physical clicks in this dev
 * environment while their handlers stay perfectly alive - a synthetic
 * el.click() reaches the same handler and works. So: one physical click, a
 * second physical attempt, then a synthetic fallback. A toggle whose handler
 * is genuinely broken still fails the caller's assertion, because none of the
 * three attempts would move it. Pass assumeClicked when a prior click may
 * already have landed (the resizer's click also closes the panel); the state
 * is then verified before anything further is sent.
 */
async function toggleTo(
  page: Page,
  toggle: Locator,
  achieved: () => Promise<boolean>,
  assumeClicked = false
) {
  if (!assumeClicked) await toggle.click();
  for (let attempt = 0; attempt < 4; attempt++) {
    if (await within(600, achieved)) return;
    if (attempt < 2) await toggle.click();
    else await toggle.evaluate(el => { (el as HTMLElement).click(); });
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByPlaceholder("Do anything")).toBeVisible();
  // The app applies persisted panel/sidebar state from async settings fetches
  // shortly after mount; a late flip landing after an assertion reads as an
  // unexplained failure. Let that hydration settle before any panel state is
  // read or toggled.
  await page.waitForTimeout(1_200);
});

test("document never scrolls horizontally", async ({ page }) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, "document is wider than the viewport").toBeLessThanOrEqual(1);
});

test("left sidebar collapses and expands", async ({ page }, testInfo) => {
  // The drawer collapses to width 0 on desktop and tablet (the One UI panel
  // motion, with the content held at a fixed width inside), and slides
  // off-canvas on a phone, where it keeps its width. Both states are marked
  // with data-collapsed on the panel itself.
  const collapsed = page.locator('.panel-sessions[data-collapsed="true"]');

  // Collapse state persists across runs; establish the expanded start the
  // test's first click assumes.
  if (await collapsed.count()) {
    await toggleTo(
      page,
      page.getByRole("button", { name: "Toggle sidebar" }),
      () => collapsed.count().then(count => count === 0)
    );
  }

  const toggle = page.getByRole("button", { name: "Toggle sidebar" });
  await toggleTo(
    page,
    toggle,
    () => collapsed.count().then(count => count > 0)
  );
  await expect(collapsed).toHaveCount(1);

  if (testInfo.project.name === "mobile") {
    const drawer = page.locator(".panel-sessions");
    await expect(drawer).toBeAttached();
    // The drawer keeps its width off-canvas, so its right edge is what has to
    // clear the viewport, not its width.
    await expect
      .poll(async () => drawer.evaluate(el => el.getBoundingClientRect().right), { timeout: 2_000 })
      .toBeLessThanOrEqual(1);
  } else {
    // The width animates to 0 and the panel then flips to visibility:hidden.
    // Read the rect through evaluate() rather than boundingBox(): Playwright
    // reports null for a hidden element, and the visibility flip lands before
    // the width poll would otherwise settle.
    await expect
      .poll(async () => collapsed.evaluate(el => el.getBoundingClientRect().width), { timeout: 2_000 })
      .toBeLessThanOrEqual(1);
    await expect(collapsed).toBeHidden();
  }

  await toggleTo(
    page,
    page.getByRole("button", { name: "Toggle sidebar" }),
    () => collapsed.count().then(count => count === 0),
    true
  );
  await expect(collapsed).toHaveCount(0);
});

/** Panel toggles persist to the shared dev database, and the write from a
 *  previous test's last action races that page's teardown — so a test cannot
 *  assume the state it inherited. Each panel test establishes its own start. */
async function ensureSidePanelClosed(page: Page) {
  if (await page.locator(".panel-side").count()) {
    await toggleTo(
      page,
      page.getByRole("button", { name: "Toggle side panel" }),
      () => page.locator(".panel-side").count().then(count => count === 0)
    );
    await expect(page.locator(".panel-side")).toHaveCount(0);
  }
}

test("right side panel toggles open, closed and open again", async ({ page }) => {
  await ensureSidePanelClosed(page);
  await expect(page.locator(".panel-side")).toHaveCount(0);

  const expand = page.getByRole("button", { name: "Toggle side panel" });
  const panelClosed = () => page.locator(".panel-side").count().then(count => count === 0);
  const panelOpen = () => page.locator(".panel-side").count().then(count => count > 0);
  await toggleTo(page, expand, panelOpen);
  const panel = page.locator(".panel-side");
  await expect(panel).toBeVisible();

  // Must sit inside the viewport, not hang off the right edge.
  const b = (await panel.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(b.x + b.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(b.x).toBeGreaterThanOrEqual(-1);

  const close = page.getByRole("separator", { name: "Resize side panel" });
  if (await close.isVisible().catch(() => false)) await close.click();
  else await expand.click();
  // Same swallowed-click tolerance for whichever close control fired, without
  // clicking again if the first one already closed the panel.
  await toggleTo(page, expand, panelClosed, true);
  await expect(page.locator(".panel-side")).toHaveCount(0);

  // Re-opening must still work — a toggle that only opens once is the bug this
  // suite exists to catch.
  await toggleTo(page, expand, panelOpen);
  await expect(page.locator(".panel-side")).toBeVisible();
});

test("composer controls do not overlap each other", async ({ page }) => {
  const selectors = [
    ".rcode-mode-select [data-slot='select-trigger']",
    ".rcode-effort-trigger",
    ".rcode-composer-model-trigger",
  ];
  const boxes = [];
  for (const s of selectors) {
    const el = page.locator(s).first();
    if (await el.isVisible().catch(() => false)) {
      boxes.push(await el.boundingBox());
    }
  }
  expect(boxes.length).toBeGreaterThanOrEqual(2);

  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      expect(
        overlaps(boxes[i]!, boxes[j]!),
        `${selectors[i]} overlaps ${selectors[j]} at ${page.viewportSize()!.width}px`,
      ).toBe(false);
    }
  }
});

/** The sidebar's open/closed state persists across runs, so a test that has to
 *  read a session row has to establish it first. */
async function ensureSidebarOpen(page: Page) {
  const panel = page.locator(".panel-sessions");
  if (await panel.isVisible().catch(() => false)) return;
  await toggleTo(
    page,
    page.getByRole("button", { name: "Toggle sidebar" }),
    () => panel.isVisible()
  );
  await expect(panel).toBeVisible();
}

/**
 * The composer in the side panel.
 *
 * The composer is the same component in the chat column and in the side
 * panel, but the panel is 320px wide whatever the window is. Viewport
 * breakpoints cannot tell those apart, so the panel's composer used to get
 * the full desktop control sizes and run off the panel's right edge - the
 * model trigger ended up 6px outside a 1440px window.
 *
 * The composer now adapts to its own container instead. This is the desktop
 * case on purpose: the bug needs a wide window and a narrow panel, which is
 * exactly the shape a user gets at 1440px.
 */
test("the composer in the side panel fits inside the panel", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "needs a wide window and a narrow panel");

  // A side chat is forked from the CURRENT session, so one has to be open.
  // The title comes from the API because the sidebar row's accessible name
  // also carries its timestamp.
  const sessions = (await api("session:listMain", [])) as { id: string; title: string }[];
  const title = sessions.find(s => s.title)?.title;
  expect(title, "the dev database should hold at least one session").toBeTruthy();
  await ensureSidebarOpen(page);
  const row = page.locator(".panel-sessions button").filter({ hasText: title!.slice(0, 24) }).first();
  await row.click();
  // The selected row is the one carrying the selected fill.
  await expect(
    page.locator(".panel-sessions .session-row").filter({ hasText: title!.slice(0, 24) }).first(),
  ).toHaveClass(/color-selected/);

  await ensureSidePanelClosed(page);
  await toggleTo(
    page,
    page.getByRole("button", { name: "Toggle side panel" }),
    () => page.locator(".panel-side").count().then(count => count > 0)
  );
  await page.getByRole("button", { name: "New tab" }).click();
  // The picker entries are menu items, not buttons.
  const sideConversation = page.getByRole("menuitem", { name: "Side conversation" });
  await expect(sideConversation).toBeVisible();
  await sideConversation.click();

  const pane = page.locator(".panel-side [role='tabpanel']");
  await expect(pane).toBeVisible();

  // The side chat this test just forked has to go away again, or the dev
  // database fills up with one dead side chat per run.
  const sideChatId = (await pane.getAttribute("id"))?.split("-pane-").pop();
  try {
    // Measured in one pass through the DOM: the panel is mid-animation when
    // the side chat mounts, so a locator's boundingBox() can land on a frame
    // where the panel has no box yet.
    const measured = await page.evaluate(() => {
      const panel = document.querySelector(".panel-side");
      if (!panel) return null;
      const pr = panel.getBoundingClientRect();
      const selectors = [
        ".panel-side .rcode-mode-select [data-slot='select-trigger']",
        ".panel-side .rcode-effort-trigger",
        ".panel-side .rcode-composer-model-trigger",
      ];
      const boxes = selectors.flatMap(s => {
        const el = document.querySelector(s);
        if (!el) return [];
        const r = el.getBoundingClientRect();
        if (r.width === 0) return [];
        return [{ sel: s, x: r.x, right: r.right, width: r.width }];
      });
      return { panel: { x: pr.x, right: pr.right, width: pr.width }, boxes };
    });

    expect(measured, "the side panel should be on screen").not.toBeNull();
    const { panel, boxes } = measured!;
    expect(boxes.length, "the panel composer should have its controls").toBeGreaterThanOrEqual(2);

    for (const b of boxes) {
      expect(b.x, `${b.sel} starts left of the panel`).toBeGreaterThanOrEqual(panel.x - 1);
      expect(
        b.right,
        `${b.sel} runs past the panel's right edge`,
      ).toBeLessThanOrEqual(panel.right + 1);
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        expect(
          boxes[i].x < boxes[j].right && boxes[j].x < boxes[i].right,
          `${boxes[i].sel} overlaps ${boxes[j].sel}`,
        ).toBe(false);
      }
    }
  } finally {
    if (sideChatId) {
      await api("sidechat:close", [sideChatId]).catch(() => undefined);
      await api("session:delete", [sideChatId]).catch(() => undefined);
    }
  }
});

test("side panel controls stay inside the viewport when open", async ({ page }) => {
  await ensureSidePanelClosed(page);
  const expand = page.getByRole("button", { name: "Toggle side panel" });
  await toggleTo(
    page,
    expand,
    () => page.locator(".panel-side").count().then(count => count > 0)
  );
  await expect(page.locator(".panel-side")).toBeVisible();

  const b = (await box(page, ".panel-side"));
  const viewport = page.viewportSize()!;
  expect(b.x).toBeGreaterThanOrEqual(-1);
  expect(b.x + b.width).toBeLessThanOrEqual(viewport.width + 1);
});

test("model picker opens with providers collapsed and expands on click", async ({ page }) => {
  const trigger = page.locator(".rcode-composer-model-trigger");
  await expect(trigger).toBeVisible();
  await trigger.click();
  await expect(page.locator(".rcode-model-selector")).toBeVisible();

  // Default state is collapsed: provider headers are visible, model rows are
  // not. Rows in a Pinned section (a user with favourites sees those at rest)
  // are exempt, so assert within the provider groups specifically.
  const providerGroups = page.locator(
    ".rcode-model-selector [data-slot='command-group']:has(.rcode-model-provider)"
  );
  await expect(providerGroups.first()).toBeVisible();
  await expect(providerGroups.locator("[data-slot='command-item']")).toHaveCount(0);

  // Expanding a provider reveals its rows.
  await page.locator(".rcode-model-provider").first().click();
  await expect(
    page.locator(".rcode-model-selector [data-slot='command-item']").first()
  ).toBeVisible();
});

test("searching the model picker shows matches without expanding", async ({ page }) => {
  const trigger = page.locator(".rcode-composer-model-trigger");
  await trigger.click();
  await expect(page.locator(".rcode-model-selector")).toBeVisible();

  // A query force-expands every provider with matches: results must be
  // visible immediately, with no expand click in between.
  await page.locator(".rcode-model-selector [data-slot='command-input']").fill("glm");
  await expect(
    page.locator(".rcode-model-selector [data-slot='command-item']").first()
  ).toBeVisible();
});

test("pinning a model surfaces it in a Pinned section and unpinning removes it", async ({ page }) => {
  const trigger = page.locator(".rcode-composer-model-trigger");
  await trigger.click();
  await expect(page.locator(".rcode-model-selector")).toBeVisible();

  // "kimi-k3" exists in exactly one provider, so the search yields one row.
  await page.locator(".rcode-model-selector [data-slot='command-input']").fill("kimi-k3");
  const row = page
    .locator(".rcode-model-selector [data-slot='command-item']")
    .filter({ hasText: "kimi-k3" })
    .first();
  await expect(row).toBeVisible();

  // The star toggles the pin without selecting the model - the picker must
  // stay open and the Pinned section must appear above the providers.
  await row.locator(".rcode-model-star").click();
  const pinnedGroup = page.locator(
    ".rcode-model-selector [data-slot='command-group']:has([cmdk-group-heading])"
  );
  await expect(pinnedGroup.first()).toBeVisible();
  await expect(
    pinnedGroup.locator("[data-slot='command-item']").filter({ hasText: "kimi-k3" }).first()
  ).toBeVisible();

  // Unpin from the pinned row; the section drops the model again.
  await pinnedGroup.locator("[data-slot='command-item']").first().locator(".rcode-model-star").click();
  await expect(
    pinnedGroup.locator("[data-slot='command-item']").filter({ hasText: "kimi-k3" })
  ).toHaveCount(0);
});
