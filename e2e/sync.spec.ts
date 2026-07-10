import { test, expect, type Page } from "@playwright/test";

/**
 * The core promise of the app: open the same board URL in two browsers and
 * everything syncs live. Two isolated browser contexts (separate storage, so
 * genuinely two clients) share one room through the real WebSocket relay.
 */

async function openBoard(page: Page, room: string) {
  await page.goto(`/b/${room}`);
  await expect(page.getByText("Live")).toBeVisible({ timeout: 10_000 });
}

test("edits, presence, and deletes sync between two clients", async ({ browser }) => {
  const room = `e2e-${Date.now().toString(36)}`;
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  await openBoard(a, room);
  await openBoard(b, room);

  // A creates a sticky note and types into it
  await a.keyboard.press("n");
  await a.mouse.click(500, 350);
  const editor = a.locator("textarea");
  await expect(editor).toBeVisible();
  await editor.fill("hello from A");
  await a.keyboard.press("Escape");

  // B sees the sticky and its text
  await expect(b.locator("[data-element-id]")).toHaveCount(1);
  await expect(b.getByText("hello from A")).toBeVisible();

  // Presence: each side sees one collaborator avatar (a follow button)
  await expect(a.locator('button[title^="Follow "]')).toHaveCount(1);
  await expect(b.locator('button[title^="Follow "]')).toHaveCount(1);

  // B draws a rectangle; A sees both elements
  await b.keyboard.press("r");
  await b.mouse.move(700, 300);
  await b.mouse.down();
  await b.mouse.move(820, 400, { steps: 5 });
  await b.mouse.up();
  await expect(a.locator("[data-element-id]")).toHaveCount(2);

  // B deletes everything; A's board empties (scoped to elements, not undo)
  await b.keyboard.press("Escape");
  await b.keyboard.press("Meta+a");
  await b.keyboard.press("Backspace");
  await expect(a.locator("[data-element-id]")).toHaveCount(0);

  await ctxA.close();
  await ctxB.close();
});

test("arrows bound to shapes follow them for every client", async ({ browser }) => {
  const room = `e2e-arrow-${Date.now().toString(36)}`;
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  await openBoard(a, room);
  await openBoard(b, room);

  // A draws two rectangles and connects them with an arrow
  await a.keyboard.press("r");
  await a.mouse.move(400, 300);
  await a.mouse.down();
  await a.mouse.move(500, 380, { steps: 3 });
  await a.mouse.up();
  await a.keyboard.press("r");
  await a.mouse.move(700, 300);
  await a.mouse.down();
  await a.mouse.move(800, 380, { steps: 3 });
  await a.mouse.up();
  await a.keyboard.press("a");
  await a.mouse.move(450, 340);
  await a.mouse.down();
  await a.mouse.move(750, 340, { steps: 5 });
  await a.mouse.up();
  await expect(b.locator("[data-element-id]")).toHaveCount(3);

  const arrow = b.locator('[data-element-id]:has(marker)');
  const before = await arrow.evaluate((el) => el.style.transform);

  // B drags the first rectangle down; the arrow must follow on B's screen
  await b.keyboard.press("Escape"); // make sure select tool is active
  await b.mouse.click(450, 340);
  await b.mouse.move(450, 340);
  await b.mouse.down();
  await b.mouse.move(450, 480, { steps: 5 });
  await b.mouse.up();

  await expect
    .poll(async () => arrow.evaluate((el) => el.style.transform))
    .not.toBe(before);

  await ctxA.close();
  await ctxB.close();
});
