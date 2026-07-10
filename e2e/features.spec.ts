import { test, expect, type Page, type Locator } from "@playwright/test";

async function openBoard(page: Page, room: string) {
  await page.goto(`/b/${room}`);
  await expect(page.getByText("Live")).toBeVisible({ timeout: 10_000 });
}

function drawRect(page: Page, x1: number, y1: number, x2: number, y2: number) {
  return (async () => {
    await page.keyboard.press("r");
    await page.mouse.move(x1, y1);
    await page.mouse.down();
    await page.mouse.move(x2, y2, { steps: 3 });
    await page.mouse.up();
    await page.keyboard.press("Escape");
  })();
}

const arrowLine = (arrow: Locator) => arrow.locator("line[marker-end]");
const lineEnd = (arrow: Locator) =>
  arrowLine(arrow).evaluate((el) => `${el.getAttribute("x2")},${el.getAttribute("y2")}`);

test("arrow endpoints can be dragged to rebind to a shape", async ({ page }) => {
  await openBoard(page, `e2e-endpoint-${Date.now().toString(36)}`);

  await drawRect(page, 700, 300, 800, 380);

  // Unbound arrow in empty space
  await page.keyboard.press("a");
  await page.mouse.move(400, 550);
  await page.mouse.down();
  await page.mouse.move(560, 550, { steps: 3 });
  await page.mouse.up();

  const arrow = page.locator('[data-element-id]:has(marker)');
  await expect(arrow).toHaveCount(1);
  const before = await lineEnd(arrow);

  // The arrow is selected after drawing; drag its end handle onto the rect
  await page.mouse.move(560, 550);
  await page.mouse.down();
  await page.mouse.move(750, 340, { steps: 5 });
  await page.mouse.up();

  // Now drag the rect away — a bound arrow end must follow it
  const boundEnd = await lineEnd(arrow);
  expect(boundEnd).not.toBe(before);
  await page.mouse.click(750, 340);
  await page.mouse.move(750, 340);
  await page.mouse.down();
  await page.mouse.move(900, 500, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => lineEnd(arrow)).not.toBe(boundEnd);
});

test("copy/paste duplicates elements at the cursor", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openBoard(page, `e2e-copy-${Date.now().toString(36)}`);

  await drawRect(page, 400, 300, 500, 380);
  await expect(page.locator("[data-element-id]")).toHaveCount(1);

  await page.mouse.click(450, 340); // select
  await page.keyboard.press("ControlOrMeta+c");
  await page.mouse.move(900, 600); // paste lands at the cursor
  await page.keyboard.press("ControlOrMeta+v");

  await expect(page.locator("[data-element-id]")).toHaveCount(2);
});

test("send to back changes stacking order", async ({ page }) => {
  await openBoard(page, `e2e-zorder-${Date.now().toString(36)}`);

  await drawRect(page, 400, 300, 520, 400);
  await drawRect(page, 460, 350, 580, 450); // overlaps the first
  const ids = await page
    .locator("[data-element-id]")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-element-id")));
  expect(ids).toHaveLength(2);

  // Click the overlap: hits the second (topmost) rect; send it to back
  await page.mouse.click(490, 370);
  await expect(page.getByText("1 selected")).toBeVisible();
  await page.keyboard.press("[");

  // Elements render sorted by z-order, so the DOM order must have flipped
  await expect
    .poll(() =>
      page
        .locator("[data-element-id]")
        .evaluateAll((els) => els.map((el) => el.getAttribute("data-element-id"))),
    )
    .toEqual([ids[1], ids[0]]);
});

test("follow mode mirrors the followed user's viewport", async ({ browser }) => {
  const room = `e2e-follow-${Date.now().toString(36)}`;
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  await openBoard(a, room);
  await openBoard(b, room);

  const worldTransform = (page: Page) =>
    page
      .locator('[data-canvas] > div')
      .first()
      .evaluate((el) => el.style.transform);

  // B follows A
  await expect(b.locator('button[title^="Follow "]')).toHaveCount(1);
  await b.locator('button[title^="Follow "]').click();
  await expect(b.getByText(/^Following /)).toBeVisible();

  // A pans; B's camera should converge to A's
  await a.mouse.move(600, 400);
  await a.mouse.wheel(300, 200);
  await expect.poll(async () => worldTransform(b), { timeout: 5000 }).toBe(
    await worldTransform(a),
  );

  // B takes control back — following stops
  await b.mouse.move(500, 400);
  await b.mouse.wheel(50, 0);
  await expect(b.getByText(/^Following /)).toHaveCount(0);

  await ctxA.close();
  await ctxB.close();
});
