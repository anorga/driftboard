import {
  test,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import * as decoding from "lib0/decoding";

/**
 * Focused regressions for the two accepted interaction fixes.
 *
 * 1. Cursor chat: opening a draft must cancel the previous message's 4s
 *    clear timer AND immediately clear the old awareness text, so an old
 *    timer can neither erase nor outlive a reopened draft. Changing rooms
 *    (conn swap while Canvas stays mounted) retires the unsubmitted draft
 *    and clears an armed clear timer; leaving the board does the same on
 *    unmount; the latest submission expires on its OWN timer only.
 *
 * 2. Wheel units: deltaMode must be read before interpreting deltas. Policy:
 *    1 line = 24 CSS px, 1 page = the canvas viewport width/height, pixel
 *    events numerically unchanged. Synthetic pixel/line/page events with the
 *    same normalized magnitude must produce identical camera results from
 *    identical non-unit starting cameras.
 *
 * Test-side protocols (from the independent review):
 * - CURSOR READINESS: the Follow button in the presence bar proves the peer
 *   received the sender's `user` awareness field only. CursorsOverlay renders
 *   chat bubbles under `state.cursor && state.user`, and Canvas.sendCursor
 *   drops pointermoves within 40ms of its last publication while
 *   `lastCursorSent` is a ref that survives a conn swap (Canvas stays
 *   mounted). Two immediate moves therefore do NOT guarantee a broadcast.
 *   Before any bubble assertion we poll the peer-rendered cursor (the name
 *   tag inside CursorsOverlay) and keep nudging the mouse, so readiness is
 *   established from observable state, not from sleeps or move counts.
 * - TIMER OBSERVATION: a test-side addInitScript wrapper records every
 *   window.setTimeout whose delay is EXACTLY 4000 (the chat clear timer is
 *   the app's only such timer) plus the matching clearTimeout handles —
 *   native timing, callback this/arguments and return handles are preserved,
 *   all other calls pass through untouched. Nothing in app source is
 *   instrumented.
 * - ISOLATION: fixture room ids embed a randomUUID (never Date.now alone),
 *   so parallel and repeated runs cannot collide. Every manually created
 *   context is closed in a finally block.
 *
 * Notes on determinism:
 * - deltaMode 1/2 cannot be produced through CDP input, so line/page events
 *   are dispatched as real synthetic WheelEvents on the real viewport
 *   listener. This proves the code's unit handling, not physical mouse feel.
 * - Real wall-clock waits with deadline-relative (not arbitrary) margins are
 *   used; the board runs persistent requestAnimationFrame loops that a
 *   faked clock would spin.
 * - Chat regressions publish the draft with a SINGLE input event (fill) and
 *   then pause without further keystrokes — continuous typing would
 *   republish awareness and mask a disappearance under test.
 */

const RETENTION_MS = 4000;

/** Root div of CursorsOverlay (exact class combination; unique on the board). */
const CURSOR_OVERLAY = "div.pointer-events-none.absolute.inset-0.overflow-hidden";
/** Peer chat bubble inside the overlay (peer wrapper contains only svg + name pill + bubble). */
const OVERLAY_BUBBLE = `${CURSOR_OVERLAY} .rounded-2xl`;
/** Peer cursor name tag — only rendered when state.cursor AND state.user exist. */
const OVERLAY_NAME_TAG = `${CURSOR_OVERLAY} .rounded-full`;

/** Collision-resistant room id: UUID, not timestamp; server allows [A-Za-z0-9_%.~-]{1,128}. */
function room(label: string): string {
  return `e2e-${label}-${randomUUID()}`;
}

// ---------------------------------------------------------------------------
// Test-side observation of the real 4s chat-clear timer (see header).
// ---------------------------------------------------------------------------

interface ChatTimerRec {
  armedAt: number;
  clearedAt: number | null;
  firedAt: number | null;
  stack: string;
}

/**
 * Runs via addInitScript (test-side only). Wraps setTimeout/clearTimeout for
 * delay===4000 exclusively: the callback is forwarded through a transparent
 * passthrough preserving native scheduling and the callback's this/arguments,
 * and the original handle is returned unchanged. Records arm/clear/fire
 * timestamps plus the arm-time stack on window.__chatClearTimers.
 */
function installChatTimerProbe() {
  const w = window as unknown as {
    setTimeout: typeof setTimeout;
    clearTimeout: typeof clearTimeout;
    __chatClearTimers?: ChatTimerRec[];
  };
  if (w.__chatClearTimers) return; // re-runs on navigation; install once per window
  const nativeSetTimeout = w.setTimeout;
  const nativeClearTimeout = w.clearTimeout;
  const recs: ChatTimerRec[] = [];
  const byHandle = new Map<unknown, ChatTimerRec>();
  w.setTimeout = function (
    this: unknown,
    fn: unknown,
    delay?: number,
    ...args: unknown[]
  ) {
    if (delay !== 4000 || typeof fn !== "function") {
      // Everything else: byte-for-byte native behavior (bare callers pass this=undefined).
      return (nativeSetTimeout as (...a: unknown[]) => unknown).call(this ?? window, fn, delay, ...args);
    }
    const rec: ChatTimerRec = {
      armedAt: Date.now(),
      clearedAt: null,
      firedAt: null,
      stack: new Error("chat-clear-arm").stack ?? "",
    };
    const wrapped = function (this: unknown, ...cbArgs: unknown[]) {
      rec.firedAt = Date.now();
      return (fn as (...a: unknown[]) => unknown).apply(this, cbArgs);
    };
    const handle = (nativeSetTimeout as (...a: unknown[]) => unknown).call(
      this ?? window,
      wrapped,
      delay,
      ...args,
    );
    recs.push(rec);
    byHandle.set(handle, rec);
    return handle;
  } as typeof w.setTimeout;
  w.clearTimeout = function (this: unknown, handle?: unknown) {
    const rec = handle === undefined ? undefined : byHandle.get(handle);
    if (rec && rec.clearedAt === null) rec.clearedAt = Date.now();
    return (nativeClearTimeout as (h?: unknown) => unknown).call(this ?? window, handle);
  } as typeof w.clearTimeout;
  w.__chatClearTimers = recs;
}

function readChatTimers(page: Page): Promise<ChatTimerRec[]> {
  return page.evaluate(
    () =>
      (window as unknown as { __chatClearTimers?: ChatTimerRec[] }).__chatClearTimers ??
      [],
  );
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function openBoard(page: Page, roomName: string) {
  await page.goto(`/b/${roomName}`);
  await expect(page.getByText("Live")).toBeVisible({ timeout: 10_000 });
}

/** Client-side room change: same route element, so BoardPage/Canvas stay
 * MOUNTED and only the connection swaps (react-router keeps component state
 * across param changes — exactly the leak scenario). */
async function gotoRoomClientSide(page: Page, roomName: string) {
  await page.evaluate((name) => {
    const nextIdx = ((window.history.state as { idx?: number } | null)?.idx ?? 0) + 1;
    window.history.pushState({ idx: nextIdx }, "", `/b/${name}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, roomName);
}

/** Best-effort resource entries; page WebSocket events are authoritative. */
async function wsChannels(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    (performance.getEntriesByType("resource") as PerformanceResourceTiming[])
      .map((r) => r.name)
      .filter((n) => n.startsWith("ws://") || n.startsWith("wss://")),
  );
}

/** WebSocket events belong to Page, not BrowserContext. */
function trackWebSockets(sink: string[], target: Page): string[] {
  target.on("websocket", (ws) => sink.push(ws.url()));
  return sink;
}

async function twoClients(browser: Browser, roomName: string) {
  const ctxA = await browser.newContext();
  let ctxB: BrowserContext | undefined;
  try {
    ctxB = await browser.newContext();
    await ctxA.addInitScript(installChatTimerProbe);
    const wsA: string[] = [];
    const wsB: string[] = [];
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();
    trackWebSockets(wsA, a);
    trackWebSockets(wsB, b);
    await openBoard(a, roomName);
    await openBoard(b, roomName);
    return { ctxA, ctxB, a, b, wsA, wsB };
  } catch (error) {
    await Promise.allSettled([ctxA.close(), ctxB?.close()]);
    throw error;
  }
}

const chatInput = (page: Page) => page.locator('input[placeholder^="Say something"]');

const worldTransform = (page: Page) =>
  page
    .locator("[data-canvas] > div")
    .first()
    .evaluate((el) => el.style.transform);

interface Cam {
  x: number;
  y: number;
  z: number;
}

/** Parse the world transform written by Canvas into the underlying camera. */
async function readCamera(page: Page): Promise<Cam> {
  const t = await worldTransform(page);
  const m = /translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\) scale\((-?[\d.e+-]+)\)/.exec(t);
  if (!m) throw new Error(`unparseable world transform: ${t}`);
  const z = Number.parseFloat(m[3]);
  return { x: Number.parseFloat(m[1]) / -z, y: Number.parseFloat(m[2]) / -z, z };
}

/**
 * The exact string Canvas renders for `cam` panned by pixel deltas (dx, dy):
 * mirrors `-camera.x * camera.z` inside the template so float formatting
 * matches bit-for-bit.
 */
function expectedTransform(cam: Cam, dx = 0, dy = 0): string {
  const x = cam.x + dx / cam.z;
  const y = cam.y + dy / cam.z;
  return `translate(${-x * cam.z}px, ${-y * cam.z}px) scale(${cam.z})`;
}

// Let React commit and paint after a state-changing dispatch.
const settle = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r())),
      ),
  );

interface WheelOpts {
  x: number;
  y: number;
  dx?: number;
  dy?: number;
  mode?: number;
  ctrl?: boolean;
  meta?: boolean;
}

/** Dispatch a real WheelEvent (any deltaMode) on the actual canvas listener. */
async function dispatchWheel(page: Page, o: WheelOpts) {
  await page.locator("[data-canvas]").evaluate((el, o) => {
    const r = el.getBoundingClientRect();
    el.dispatchEvent(
      new WheelEvent("wheel", {
        deltaX: o.dx ?? 0,
        deltaY: o.dy ?? 0,
        deltaMode: o.mode ?? 0,
        clientX: r.left + o.x,
        clientY: r.top + o.y,
        bubbles: true,
        cancelable: true,
        ctrlKey: !!o.ctrl,
        metaKey: !!o.meta,
      }),
    );
  }, o);
  await settle(page);
}

const viewportSize = (page: Page) =>
  page.locator("[data-canvas]").evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { width: r.width, height: r.height };
  });

// ---------------------------------------------------------------------------
// Cursor readiness: peer-rendered state polling (see header)
// ---------------------------------------------------------------------------

/**
 * Establish that page `b` peer-renders a live cursor for a's user, BEFORE any
 * chat bubble assertion. The Follow button alone only proves the `user`
 * awareness field arrived; the overlay name tag requires `cursor && user`.
 * Polling nudges the sender's mouse whenever the tag is absent — after the
 * first attempt a pointermove always exists, and consecutive attempts are
 * spaced farther apart than the 40ms sendCursor throttle, so publication
 * becomes guaranteed by observation, not by luck.
 */
async function ensurePeerChatReady(a: Page, b: Page): Promise<string> {
  await expect(b.locator('button[title^="Follow "]')).toHaveCount(1, { timeout: 10_000 });
  const title = await b.locator('button[title^="Follow "]').first().getAttribute("title");
  const name = (title ?? "").replace(/^Follow\s+/, "").trim();
  expect(name, "Follow button title carries the peer user name").not.toBe("");
  await expect
    .poll(
      async () => {
        if (await b.locator(CURSOR_OVERLAY).getByText(name, { exact: true }).isVisible()) {
          return true;
        }
        await a.mouse.move(Math.round(460 + Math.random() * 240), Math.round(300 + Math.random() * 200));
        return false;
      },
      {
        timeout: 10_000,
        intervals: [80, 120, 250],
        message: `sender's cursor (name tag for "${name}") never appeared in CursorsOverlay — cursor publication starved?`,
      },
    )
    .toBe(true);
  return name;
}

/** Observable failing-state capture for chat assertions (room/channel, peer
 * awareness, sender identity, local draft). Attached on failure only. */
async function capturePeerState(b: Page, roomName: string) {
  return {
    pageUrl: b.url(),
    expectedRoom: roomName,
    wsChannels: await wsChannels(b),
    followButtons: await b.locator('button[title^="Follow "]').count(),
    peerNamesRendered: await b.locator(OVERLAY_NAME_TAG).allTextContents(),
    peerBubblesRendered: await b.locator(OVERLAY_BUBBLE).allTextContents(),
  };
}

async function attach(testInfo: TestInfo, name: string, payload: unknown) {
  await testInfo.attach(name, {
    body: JSON.stringify(payload, null, 2),
    contentType: "application/json",
  });
}

// ---------------------------------------------------------------------------
// 1. Cursor chat timer lifecycle
// ---------------------------------------------------------------------------

test("a reopened draft outlives the previous message's clear timer", async ({ browser }, testInfo) => {
  const roomName = room("chat-oldtimer");
  const { ctxA, ctxB, a, b } = await twoClients(browser, roomName);
  try {
    // Peer-rendered cursor established BEFORE typing (Follow proves `user` only).
    await ensurePeerChatReady(a, b);

    // Send message 1; its ~4s clear timer is armed at Enter (observed).
    await a.keyboard.press("/");
    await expect(chatInput(a)).toBeVisible();
    await chatInput(a).fill("first-baseline-msg");
    const tSend = Date.now();
    await a.keyboard.press("Enter");
    await expect(b.getByText("first-baseline-msg", { exact: true })).toBeVisible();

    // Reopen the draft BEFORE that timer expires and publish message 2 with a
    // single input event — no further keystrokes afterwards.
    await a.keyboard.press("/");
    await expect(chatInput(a)).toBeVisible();
    await chatInput(a).fill("second-survivor-msg");
    expect(Date.now() - tSend).toBeLessThan(3000); // old timer must not have fired yet

    // Observed on the real handle: reopening CANCELLED the armed timer and it
    // never fired (baseline: it fired and erased the reopened draft).
    const recsAfterOpen = await readChatTimers(a);
    expect(recsAfterOpen.length, "Enter armed exactly one 4000ms timer").toBe(1);
    expect(recsAfterOpen[0].clearedAt, "reopening the draft must clear the armed handle").not.toBeNull();
    expect(recsAfterOpen[0].firedAt, "the cancelled timer callback must not run").toBeNull();

    await expect(b.getByText("second-survivor-msg", { exact: true })).toBeVisible();

    // Pause across the FIRST timer's deadline (without typing) — the peer must
    // still show the reopened draft. Baseline: the stale timer erased it.
    await a.waitForTimeout(Math.max(200, tSend + RETENTION_MS + 800 - Date.now()));
    await expect(b.getByText("second-survivor-msg", { exact: true })).toBeVisible();

    // Submitting it retains the message on its OWN new timer…
    const tNew = Date.now();
    await a.keyboard.press("Enter");
    const bubble = b.getByText("second-survivor-msg", { exact: true });
    await expect(bubble).toBeVisible();
    // …with observable retention MEANINGFULLY INTO the new window (no further
    // typing): still peer-visible ~1s before the new deadline…
    const midWait = Math.max(0, tNew + RETENTION_MS - 1000 - Date.now());
    if (midWait > 0) await a.waitForTimeout(midWait);
    await expect(bubble, "submitted draft must stay visible into its own retention window").toBeVisible();
    // …then expire by itself, nothing lingering forever.
    await expect(bubble).toBeHidden({ timeout: Math.max(1200, tNew + RETENTION_MS + 1500 - Date.now()) });

    // The new timer expired NATURALLY (callback fired once), and nothing else
    // was armed by the scenario.
    const recsEnd = await readChatTimers(a);
    expect(recsEnd.length, "exactly two 4000ms timers across the scenario").toBe(2);
    expect(recsEnd[1].firedAt, "the new timer must expire by itself").not.toBeNull();

    await attach(testInfo, "chat-timer-records", recsEnd);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test("opening a blank draft clears the previous bubble immediately", async ({ browser }) => {
  const { ctxA, ctxB, a, b } = await twoClients(browser, room("chat-blankopen"));
  try {
    await ensurePeerChatReady(a, b);

    await a.keyboard.press("/");
    await expect(chatInput(a)).toBeVisible();
    await chatInput(a).fill("alpha-old-text");
    const tSend = Date.now();
    await a.keyboard.press("Enter");
    await expect(b.getByText("alpha-old-text", { exact: true })).toBeVisible();

    // Reopen an EMPTY draft shortly after sending. Baseline: the old text stayed
    // on the peer until the old timer eventually fired (~4s).
    await a.waitForTimeout(Math.max(0, 300 - (Date.now() - tSend)));
    await a.keyboard.press("/");
    await expect(chatInput(a)).toBeVisible();
    await expect(b.getByText("alpha-old-text", { exact: true })).toBeHidden({ timeout: 1200 });
    // Observed: the armed handle was CANCELLED (not fired) — the immediate
    // awareness clear, not the timer, removed the bubble.
    const recs = await readChatTimers(a);
    expect(recs.length).toBe(1);
    expect(recs[0].clearedAt, "blank reopen must cancel the pending clear").not.toBeNull();
    expect(recs[0].firedAt, "cancelled timer must not fire").toBeNull();
    // An empty draft dismissed with Escape leaves nothing behind.
    await a.keyboard.press("Escape");
    await expect(chatInput(a)).toHaveCount(0);
    await expect(b.getByText("alpha-old-text", { exact: true })).toHaveCount(0);
    expect((await readChatTimers(a)).length, "Escape must not arm a new timer").toBe(1);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test("back-to-back submissions retain only the latest, until its own timer", async ({ browser }) => {
  const { ctxA, ctxB, a, b } = await twoClients(browser, room("chat-backtoback"));
  try {
    await ensurePeerChatReady(a, b);

    await a.keyboard.press("/");
    await chatInput(a).fill("zeta-first");
    const tFirst = Date.now();
    await a.keyboard.press("Enter");
    await expect(b.getByText("zeta-first", { exact: true })).toBeVisible();

    await a.waitForTimeout(1500);
    await a.keyboard.press("/");
    await chatInput(a).fill("eta-latest");
    const tSecond = Date.now();
    await a.keyboard.press("Enter");
    await expect(b.getByText("eta-latest", { exact: true })).toBeVisible();
    await expect(b.getByText("zeta-first", { exact: true })).toHaveCount(0);

    // Past the FIRST message's deadline the latest message must still show…
    await a.waitForTimeout(Math.max(0, tFirst + RETENTION_MS + 600 - Date.now()));
    await expect(b.getByText("eta-latest", { exact: true })).toBeVisible();
    // …meaningfully into its OWN window (~1s before its deadline, no typing)…
    const midWait = Math.max(0, tSecond + RETENTION_MS - 900 - Date.now());
    if (midWait > 0) await a.waitForTimeout(midWait);
    await expect(b.getByText("eta-latest", { exact: true })).toBeVisible();
    // …and it expires on its own ~4s timer.
    await expect(b.getByText("eta-latest", { exact: true })).toBeHidden({
      timeout: Math.max(1000, tSecond + RETENTION_MS + 1500 - Date.now()),
    });
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test("Escape discards a typed draft without leaving a peer bubble", async ({ browser }) => {
  const { ctxA, ctxB, a, b } = await twoClients(browser, room("chat-escape"));
  try {
    await ensurePeerChatReady(a, b);

    await a.keyboard.press("/");
    await chatInput(a).fill("iota-draft");
    await expect(b.getByText("iota-draft", { exact: true })).toBeVisible();
    await a.keyboard.press("Escape");
    await expect(chatInput(a)).toHaveCount(0);
    await expect(b.getByText("iota-draft", { exact: true })).toBeHidden({ timeout: 1000 });
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test("empty or whitespace-only draft: Enter and blur dismiss without a bubble or timer", async ({ browser }) => {
  const { ctxA, ctxB, a, b } = await twoClients(browser, room("chat-emptydismiss"));
  try {
    await ensurePeerChatReady(a, b);
    const bubbles = b.locator(OVERLAY_BUBBLE);

    // Empty draft closed with Enter: dismissed immediately, nothing armed.
    await a.keyboard.press("/");
    await expect(chatInput(a)).toBeVisible();
    await a.keyboard.press("Enter");
    await expect(chatInput(a)).toHaveCount(0);
    await expect(bubbles).toHaveCount(0);
    expect((await readChatTimers(a)).length, "empty Enter must not arm a clear timer").toBe(0);

    // Empty draft closed by blur: same dismissal, nothing armed.
    await a.keyboard.press("/");
    await expect(chatInput(a)).toBeVisible();
    await chatInput(a).blur();
    await expect(chatInput(a)).toHaveCount(0);
    await expect(bubbles).toHaveCount(0);
    expect((await readChatTimers(a)).length, "empty blur must not arm a clear timer").toBe(0);

    // Whitespace-only text is transient while typed but is NOT retained on blur
    // (trim gate in closeChat) and arms no timer.
    await a.keyboard.press("/");
    await chatInput(a).fill("   ");
    await chatInput(a).blur();
    await expect(chatInput(a)).toHaveCount(0);
    await expect(bubbles).toHaveCount(0);
    expect((await readChatTimers(a)).length, "whitespace-only dismissal must not arm a clear timer").toBe(0);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test("a nonempty blur retains the message for its own ~4s timer and then expires", async ({ browser }, testInfo) => {
  const roomName = room("chat-blur");
  const { ctxA, ctxB, a, b, wsB } = await twoClients(browser, roomName);
  try {
    await ensurePeerChatReady(a, b);

    await a.keyboard.press("/");
    await expect(chatInput(a)).toBeVisible();
    await chatInput(a).fill("blur-retained-msg");
    const tBlur = Date.now();
    await chatInput(a).blur();
    await expect(chatInput(a)).toHaveCount(0);

    const bubble = b.getByText("blur-retained-msg", { exact: true });
    try {
      await expect(bubble, "nonempty blur must RETAIN the message for peers").toBeVisible({
        timeout: 3000,
      });
    } catch (err) {
      await attach(testInfo, "blur-retention-failure", {
        localInputValue: await chatInput(a).inputValue().catch(() => null),
        peerWsUrls: wsB,
        peerState: await capturePeerState(b, roomName),
        timers: await readChatTimers(a),
      });
      throw err;
    }

    // Blur itself armed exactly one clear timer…
    const recs0 = await readChatTimers(a);
    expect(recs0.length, "nonempty blur arms one 4000ms clear timer").toBe(1);
    // …retention holds deep into its window…
    const midWait = Math.max(0, tBlur + RETENTION_MS - 1000 - Date.now());
    if (midWait > 0) await a.waitForTimeout(midWait);
    await expect(bubble, "blur-retained message must persist until near its deadline").toBeVisible();
    // …then expires on that timer without any further publication.
    await expect(bubble).toBeHidden({ timeout: Math.max(1200, tBlur + RETENTION_MS + 1500 - Date.now()) });
    const recs1 = await readChatTimers(a);
    expect(recs1[0].firedAt, "blur timer must expire naturally (callback fires)").not.toBeNull();
    expect(recs1[0].clearedAt, "nothing cleared it early").toBeNull();
    await attach(testInfo, "blur-timer-records", recs1);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test("changing room retires an unsubmitted draft, and a fresh draft works on the new connection", async ({ browser }, testInfo) => {
  const room1 = room("conn-a");
  const room2 = room("conn-b");
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  await ctxA.addInitScript(installChatTimerProbe);
  const wsA: string[] = [];
  const wsB: string[] = [];
  try {
    const a = await ctxA.newPage();
    const b2 = await ctxB.newPage();
    trackWebSockets(wsA, a);
    trackWebSockets(wsB, b2);
    await openBoard(a, room1);
    await openBoard(b2, room2);

    // Start an unsubmitted draft in room 1.
    await a.mouse.move(500, 380);
    await a.keyboard.press("/");
    await expect(chatInput(a)).toBeVisible();
    await chatInput(a).fill("stale-cross-room-draft");

    await gotoRoomClientSide(a, room2);
    await expect(a).toHaveURL(new RegExp(`/b/${room2}$`));
    await expect(a.getByText("Live")).toBeVisible({ timeout: 10_000 });

    // The prior room's draft must be retired with the connection…
    await expect(chatInput(a)).toHaveCount(0, { timeout: 2000 });
    // …and its text must never reach the new room.
    await expect(b2.getByText("stale-cross-room-draft", { exact: true })).toHaveCount(0);

    // A fresh, empty draft on the NEW connection still works end to end.
    // Readiness protocol (see header): wait for the peer-rendered CURSOR — the
    // Follow button alone only proves `user` awareness arrived, and the 40ms
    // sendCursor throttle with its conn-surviving lastCursorSent ref means
    // immediate moves after a swap can ALL be dropped. Polling with nudges
    // establishes publication from observable state before typing.
    await ensurePeerChatReady(a, b2);
    await a.keyboard.press("/");
    await expect(chatInput(a)).toBeVisible();
    await expect(chatInput(a)).toHaveValue("");
    await chatInput(a).pressSequentially("fresh-room-draft", { delay: 15 });
    await expect(chatInput(a)).toHaveValue("fresh-room-draft");
    try {
      await expect(b2.getByText("fresh-room-draft", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
    } catch (err) {
      // Failing-state capture: room/channel + peer awareness + sender draft.
      await attach(testInfo, "fresh-draft-failure", {
        room1,
        room2,
        localInputValue: await chatInput(a).inputValue(),
        senderPageUrl: a.url(),
        senderWsUrls: wsA,
        peerWsUrls: wsB,
        peerState: await capturePeerState(b2, room2),
      });
      throw err;
    }
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test("changing room clears an ARMED 4s clear timer on the conn swap before it can fire", async ({ browser }, testInfo) => {
  const room1 = room("swaptimer-a");
  const room2 = room("swaptimer-b");
  const { ctxA, ctxB, a, b } = await twoClients(browser, room1);
  try {
    await ensurePeerChatReady(a, b);

    // Submit a message in room 1 so a real clear timer is armed and pending.
    await a.keyboard.press("/");
    await expect(chatInput(a)).toBeVisible();
    await chatInput(a).fill("armed-before-swap");
    const tEnter = Date.now();
    await a.keyboard.press("Enter");
    await expect(b.getByText("armed-before-swap", { exact: true })).toBeVisible();

    const recs0 = await readChatTimers(a);
    expect(recs0.length, "Enter armed exactly one 4000ms timer").toBe(1);
    expect(recs0[0].armedAt, "armed at Enter").toBeGreaterThanOrEqual(tEnter - 250);
    expect(recs0[0].clearedAt, "timer pending at swap time").toBeNull();
    const tSwap = Date.now();
    expect(tSwap - tEnter, "swap must occur while the timer is still pending").toBeLessThan(3500);

    await gotoRoomClientSide(a, room2);
    await expect(a).toHaveURL(new RegExp(`/b/${room2}$`));
    await expect(a.getByText("Live")).toBeVisible({ timeout: 10_000 });

    // The conn-swap cleanup must CLEAR the specific armed handle…
    await expect
      .poll(
        async () => (await readChatTimers(a))[0]?.clearedAt ?? 0,
        { timeout: 5_000, message: "armed 4s handle was not cleared on the conn swap" },
      )
      .toBeGreaterThan(tSwap - 100);
    // …peer visibility is preserved as evidence A really left room 1…
    await expect(b.locator('button[title^="Follow "]')).toHaveCount(0, { timeout: 10_000 });
    // …and after the ORIGINAL deadline the callback must NEVER have executed.
    await a.waitForTimeout(Math.max(0, recs0[0].armedAt + RETENTION_MS + 800 - Date.now()));
    const recs1 = await readChatTimers(a);
    expect(recs1.length, "the swap arms no second timer").toBe(1);
    expect(recs1[0].firedAt, "cleared timer callback must never fire").toBeNull();
    await attach(testInfo, "swap-timer-records", recs1);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test("leaving the board with a pending clear timer: handle cleared on unmount, callback never fires", async ({ browser }, testInfo) => {
  const ctx = await browser.newContext();
  await ctx.addInitScript(installChatTimerProbe);
  const page = await ctx.newPage();
  const errors: Error[] = [];
  page.on("pageerror", (e) => errors.push(e));
  try {
    await openBoard(page, room("unmount-timer"));
    await page.mouse.move(500, 380);
    await page.keyboard.press("/");
    await expect(chatInput(page)).toBeVisible();
    await chatInput(page).fill("pending-clear-msg");
    await page.keyboard.press("Enter"); // arms the ~4s clear timer

    const recs0 = await readChatTimers(page);
    expect(recs0.length, "Enter armed the 4000ms clear timer").toBe(1);
    expect(recs0[0].clearedAt, "pending at unmount time").toBeNull();

    // Client-side navigation (react-router Link) unmounts Canvas while the
    // timer is pending — same window, so the probe records survive.
    await page.locator('a[title="Driftboard home"]').click();
    await expect(page).toHaveURL("/");
    const recsAfterNav = await readChatTimers(page);
    expect(recsAfterNav.length, "window survived the client-side unmount").toBe(1);

    // The unmount cleanup must clear the armed handle…
    await expect
      .poll(
        async () => (await readChatTimers(page))[0]?.clearedAt ?? 0,
        { timeout: 5_000, message: "armed 4s handle was not cleared on unmount" },
      )
      .toBeGreaterThan(0);
    // …and past the deadline the callback must never have run.
    await page.waitForTimeout(Math.max(0, recs0[0].armedAt + RETENTION_MS + 900 - Date.now()));
    const recs1 = await readChatTimers(page);
    expect(recs1.length).toBe(1);
    expect(recs1[0].firedAt, "unmount-cleared timer callback must never fire").toBeNull();
    expect(errors, "no stale work errors after unmount").toEqual([]);
    await attach(testInfo, "unmount-timer-records", recs1);
  } finally {
    await ctx.close();
  }
});

// ---------------------------------------------------------------------------
// 1b. Missing-cursor mechanism diagnosis (see review finding 1)
// ---------------------------------------------------------------------------

test("room membership without a cursor hides received chat until cursor publication", async ({ browser }, testInfo) => {
  test.setTimeout(90_000);
  const room1 = room("thr-a");
  const room2 = room("thr-b");
  const ctxA = await browser.newContext();
  const ctxB1 = await browser.newContext();
  const ctxB2 = await browser.newContext();
  const wsA: string[] = [];
  const wsB1: string[] = [];
  const wsB2: string[] = [];
  try {
    const a = await ctxA.newPage();
    const b1 = await ctxB1.newPage();
    const b2 = await ctxB2.newPage();
    trackWebSockets(wsA, a);
    trackWebSockets(wsB1, b1);
    trackWebSockets(wsB2, b2);
    // Observe actual incoming awareness bytes, not inferred local draft state.
    // Wire layout follows installed y-websocket/messageAwareness and
    // y-protocols/awareness: count, then client id, clock, JSON state.
    type AwarenessFrame = {
      clientID: number;
      clock: number;
      state: { user?: { name: string }; cursor?: { x: number; y: number } | null; chat?: { text: string; ts: number } | null } | null;
    };
    const frames: AwarenessFrame[] = [];
    b2.on("websocket", (socket) => {
      socket.on("framereceived", ({ payload }) => {
        if (typeof payload === "string") return;
        const outer = decoding.createDecoder(new Uint8Array(payload));
        if (decoding.readVarUint(outer) !== 1) return;
        const inner = decoding.createDecoder(decoding.readVarUint8Array(outer));
        const count = decoding.readVarUint(inner);
        for (let i = 0; i < count; i++) {
          frames.push({
            clientID: decoding.readVarUint(inner),
            clock: decoding.readVarUint(inner),
            state: JSON.parse(decoding.readVarString(inner)),
          });
        }
      });
    });
    await openBoard(a, room1);
    await openBoard(b1, room1);
    await openBoard(b2, room2);

    // Baseline: a throttle-eligible move publishes and the peer renders the
    // cursor tag — the pipeline itself is healthy.
    const nameA = await ensurePeerChatReady(a, b1);

    // Swap without publishing a cursor in the new room. This demonstrates
    // the missing readiness precondition, not the exact historical timing
    // or a controlled reproduction of the 40ms throttle.
    await gotoRoomClientSide(a, room2);
    await expect(a).toHaveURL(new RegExp(`/b/${room2}$`));
    await expect(b2.locator('button[title^="Follow "]')).toHaveCount(1, { timeout: 10_000 });
    await settle(a); // conn committed; user awareness demonstrably arrived in room2

    // Keyboard-only draft on the new connection (the chat field has NO throttle).
    const msg = "throttled-hidden-msg";
    await a.keyboard.press("/");
    await expect(chatInput(a)).toBeVisible();
    await chatInput(a).fill(msg);
    await expect.poll(() => frames.findLast((frame) => frame.state?.chat?.text === msg)).toMatchObject({
      state: { user: { name: nameA }, chat: { text: msg } },
    });
    const receivedBefore = frames.findLast((frame) => frame.state?.chat?.text === msg)!;
    expect(receivedBefore.state?.cursor ?? null).toBeNull();

    // The peer actually received chat, but has no cursor to anchor its bubble.
    // Observe a bounded absence window, then change only cursor publication.
    const until = Date.now() + 400;
    while (Date.now() < until) {
      expect(await b2.locator(CURSOR_OVERLAY).getByText(nameA, { exact: true }).count()).toBe(0);
      expect(await b2.locator(OVERLAY_BUBBLE).count()).toBe(0);
      expect(await b2.getByText(msg, { exact: true }).count()).toBe(0);
      expect(await chatInput(a).inputValue()).toBe(msg);
      await a.waitForTimeout(80);
    }
    await attach(testInfo, "missing-cursor-failing-state", {
      room1,
      room2,
      senderName: nameA,
      senderPageUrl: a.url(),
      senderWsUrls: wsA,
      baselinePeerWsUrls: wsB1,
      roomPeerWsUrls: wsB2,
      peerStateBeforePublication: await capturePeerState(b2, room2),
      receivedAwarenessBefore: receivedBefore,
      localInputValue: await chatInput(a).inputValue(),
    });

    // One real move publishes the missing cursor; no further typing. Cursor
    // publication broadcasts full awareness, so only the earlier raw frame
    // proves chat was received before this move.
    await a.mouse.move(610, 420);
    await expect(b2.getByText(msg, { exact: true }), "same text, no retype, after cursor publication").toBeVisible({
      timeout: 10_000,
    });
    await expect(b2.locator(CURSOR_OVERLAY).getByText(nameA, { exact: true })).toBeVisible();
    const receivedAfter = frames.findLast((frame) => frame.clientID === receivedBefore.clientID);
    expect(receivedAfter?.state?.chat?.text).toBe(msg);
    expect(receivedAfter?.state?.cursor).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
    await attach(testInfo, "cursor-published-state", {
      peerStateAfterPublication: await capturePeerState(b2, room2),
      receivedAwarenessAfter: receivedAfter,
      localInputValue: await chatInput(a).inputValue(),
    });
    expect(await chatInput(a).inputValue()).toBe(msg);
  } finally {
    await ctxA.close();
    await ctxB1.close();
    await ctxB2.close();
  }
});

// ---------------------------------------------------------------------------
// 2. Wheel deltaMode normalization
// ---------------------------------------------------------------------------

test("line-mode pan matches the 24px-per-line pixel-equivalent on both axes and signs", async ({ page }) => {
  await openBoard(page, room("wheel-line"));
  const cam0 = await readCamera(page);
  expect(cam0.z).toBe(1);

  // 2 lines right, 3 lines up => +48px x, -72px y (24 px/line policy).
  const tLine = expectedTransform(cam0, 48, -72);
  await dispatchWheel(page, { x: 500, y: 400, dx: 2, dy: -3, mode: 1 });
  await expect
    .poll(() => worldTransform(page), { message: "line-mode deltas treated as pixels (deltaMode ignored)" })
    .toBe(tLine);

  // Opposite signs round-trip to the exact starting camera (integer math at z=1).
  await dispatchWheel(page, { x: 500, y: 400, dx: -2, dy: 3, mode: 1 });
  expect(await worldTransform(page)).toBe(expectedTransform(cam0));

  // The same normalized result from explicit pixel deltas, on a fresh board.
  await openBoard(page, room("wheel-line"));
  await dispatchWheel(page, { x: 500, y: 400, dx: 48, dy: -72, mode: 0 });
  expect(await worldTransform(page)).toBe(tLine);
});

test("page-mode pan uses the canvas viewport width and height per axis", async ({ page }) => {
  const roomName = room("wheel-page");
  await openBoard(page, roomName);
  const vp = await viewportSize(page);
  const cam0 = await readCamera(page);

  // One page right, half a page up => +width px x, -height/2 px y.
  const tPage = expectedTransform(cam0, vp.width, -vp.height / 2);
  await dispatchWheel(page, { x: 400, y: 400, dx: 1, dy: -0.5, mode: 2 });
  await expect
    .poll(() => worldTransform(page), { message: "page-mode deltas treated as pixels (deltaMode ignored)" })
    .toBe(tPage);

  // Equivalent pixel deltas from the same default camera give the identical
  // transform string.
  await openBoard(page, roomName);
  await dispatchWheel(page, { x: 400, y: 400, dx: vp.width, dy: -vp.height / 2, mode: 0 });
  expect(await worldTransform(page)).toBe(tPage);
});

test("ctrl and meta zoom read deltaMode first and preserve the focal point", async ({ page }) => {
  const roomName = room("wheel-zoom");
  await openBoard(page, roomName);
  const F = { x: 600, y: 400 };
  const cam0 = await readCamera(page);
  const w0 = { x: F.x / cam0.z + cam0.x, y: F.y / cam0.z + cam0.y };

  // ctrl + 3 lines out: normalized to 72px => factor exp(0.72), not exp(0.03).
  // Tolerances: the browser re-serializes transform numbers at ~5 decimals,
  // so numeric checks use toBeCloseTo and cross-run checks use serialized
  // string equality (identical true cameras serialize identically).
  await dispatchWheel(page, { ...F, dy: -3, mode: 1, ctrl: true });
  const cam1 = await readCamera(page);
  expect(cam1.z).toBeCloseTo(cam0.z * Math.exp(-(-3 * 24) * 0.01), 4);
  const w1 = { x: F.x / cam1.z + cam1.x, y: F.y / cam1.z + cam1.y };
  expect(Math.abs(w1.x - w0.x)).toBeLessThan(5e-3); // world point under cursor stays put
  expect(Math.abs(w1.y - w0.y)).toBeLessThan(5e-3);
  const afterLine = await worldTransform(page);

  // Equivalent pixel ctrl event on a fresh board => bit-identical camera.
  await openBoard(page, roomName);
  await dispatchWheel(page, { ...F, dy: -72, mode: 0, ctrl: true });
  expect(await worldTransform(page)).toBe(afterLine);

  // metaKey takes the same zoom path.
  await openBoard(page, roomName);
  await dispatchWheel(page, { ...F, dy: -3, mode: 1, meta: true });
  expect(await worldTransform(page)).toBe(afterLine);
});

test("zoom clamps hold across normalized line events", async ({ page }) => {
  await openBoard(page, room("wheel-clamp"));
  const F = { x: 640, y: 360 };

  for (let i = 0; i < 8; i++) await dispatchWheel(page, { ...F, dy: -10, mode: 1, ctrl: true });
  const camMax = await readCamera(page);
  expect(camMax.z).toBe(4); // MAX_ZOOM, reached via 240px/line-normalized steps
  const tMax = await worldTransform(page);
  await dispatchWheel(page, { ...F, dy: -10, mode: 1, ctrl: true });
  expect(await worldTransform(page)).toBe(tMax); // pinned, no drift at the clamp

  for (let i = 0; i < 12; i++) await dispatchWheel(page, { ...F, dy: 10, mode: 1, ctrl: true });
  expect((await readCamera(page)).z).toBe(0.1); // MIN_ZOOM
});

test("non-unit zoom: normalized pan divides by zoom, line matches pixel equivalence", async ({ page }) => {
  const roomName = room("wheel-nonunit");
  await openBoard(page, roomName);
  const F = { x: 640, y: 360 };

  // Zoom to ~2x with an exact pixel ctrl event (factor exp(ln2)), then pan by
  // lines: -5 lines => -120px screen => -120/z world units. Expectations are
  // cross-run serialized-string equalities plus toBeCloseTo deltas, because
  // the browser re-serializes transform numbers at ~5 decimals.
  await dispatchWheel(page, { ...F, dy: -Math.log(2) * 100, mode: 0, ctrl: true });
  const cam1 = await readCamera(page);
  expect(cam1.z).toBeCloseTo(2, 4);
  const t1 = await worldTransform(page); // the exact starting camera state

  await dispatchWheel(page, { x: 300, y: 300, dx: -5, dy: 3, mode: 1 });
  const camA = await readCamera(page);
  expect(camA.x - cam1.x).toBeCloseTo(-120 / cam1.z, 4); // world-space division by zoom
  expect(camA.y - cam1.y).toBeCloseTo(72 / cam1.z, 4);
  const tA = await worldTransform(page);

  // Pixel-equivalent from an identical starting camera on a fresh load.
  await openBoard(page, roomName);
  await dispatchWheel(page, { ...F, dy: -Math.log(2) * 100, mode: 0, ctrl: true });
  expect(await worldTransform(page)).toBe(t1); // deterministic starting point
  await dispatchWheel(page, { x: 300, y: 300, dx: -120, dy: 72, mode: 0 });
  expect(await worldTransform(page)).toBe(tA);
});

/**
 * Full unit-equivalence matrix ON AN ACTUAL NON-UNIT CAMERA (z ≈ 2, reached
 * by an exact exp(ln2) pixel ctrl zoom from the identical default camera):
 * - pixel vs line vs PAGE pan equivalence, both axes, both sign combinations
 *   (including page-pan reversed axes/signs);
 * - ctrl AND meta zoom in BOTH directions with unsaturated magnitudes
 *   (z stays strictly inside (0.1, 4) — saturation is covered separately by
 *   the clamp test), each compared to its pixel-equivalent camera;
 * - focal-point invariance asserted per zoom variant;
 * - meta+line landing on the exact ctrl+line camera.
 * Cross-run comparisons use serialized-transform string equality: identical
 * true cameras serialize identically.
 */
test("pixel/line/page equivalence matrix from identical non-unit cameras (pan signs, ctrl/meta zoom, focal point)", async ({ page }) => {
  test.setTimeout(180_000);
  const roomName = room("wheel-matrix");
  const F = { x: 640, y: 360 };

  await openBoard(page, roomName);
  const vp = await viewportSize(page);

  /** Reload to the deterministic z≈2 starting camera and return it. */
  async function startCam(): Promise<{ cam: Cam; t: string }> {
    await openBoard(page, roomName);
    await dispatchWheel(page, { ...F, dy: -Math.log(2) * 100, mode: 0, ctrl: true });
    const cam = await readCamera(page);
    expect(cam.z).toBeCloseTo(2, 4);
    return { cam, t: await worldTransform(page) };
  }

  async function panEquivalence(
    label: string,
    variant: Omit<WheelOpts, "x" | "y">,
    pixel: Omit<WheelOpts, "x" | "y">,
  ) {
    const s1 = await startCam();
    await dispatchWheel(page, { ...F, ...variant });
    const tVar = await worldTransform(page);
    const s2 = await startCam();
    expect(s2.t, `${label}: starting camera not reproducible — check the harness`).toBe(s1.t);
    await dispatchWheel(page, { ...F, ...pixel });
    expect(await worldTransform(page), `${label}: normalized event != pixel-equivalent camera`).toBe(tVar);
  }

  // Pan: both axes, both signs for line and page; page runs reversed axes/signs.
  await panEquivalence("line pan (+x, -y)", { dx: 5, dy: -3, mode: 1 }, { dx: 120, dy: -72, mode: 0 });
  await panEquivalence("line pan (-x, +y) reversed", { dx: -5, dy: 3, mode: 1 }, { dx: -120, dy: 72, mode: 0 });
  await panEquivalence(
    "page pan (+x, -y)",
    { dx: 0.5, dy: -0.25, mode: 2 },
    { dx: 0.5 * vp.width, dy: -0.25 * vp.height, mode: 0 },
  );
  await panEquivalence(
    "page pan (-x, +y) reversed",
    { dx: -0.5, dy: 0.25, mode: 2 },
    { dx: -0.5 * vp.width, dy: 0.25 * vp.height, mode: 0 },
  );

  /** World-space drift of the focal point F under a zoom step. */
  function focalDrift(start: Cam, end: Cam): number {
    const w0 = { x: F.x / start.z + start.x, y: F.y / start.z + start.y };
    const w1 = { x: F.x / end.z + end.x, y: F.y / end.z + end.y };
    return Math.max(Math.abs(w1.x - w0.x), Math.abs(w1.y - w0.y));
  }

  async function zoomEquivalence(
    label: string,
    variant: Omit<WheelOpts, "x" | "y">,
    pixel: Omit<WheelOpts, "x" | "y">,
  ): Promise<string> {
    const s1 = await startCam();
    await dispatchWheel(page, { ...F, ...variant });
    const endCam = await readCamera(page);
    expect(focalDrift(s1.cam, endCam), `${label}: focal point drifted`).toBeLessThan(5e-3);
    // Unsaturated magnitude: strictly inside the clamp range with real movement.
    expect(endCam.z).toBeGreaterThan(0.1 + 1e-6);
    expect(endCam.z).toBeLessThan(4 - 1e-6);
    expect(Math.abs(endCam.z / s1.cam.z - 1), `${label}: magnitude below the assertion floor`).toBeGreaterThan(0.1);
    const tVar = await worldTransform(page);
    const s2 = await startCam();
    expect(s2.t, `${label}: starting camera not reproducible`).toBe(s1.t);
    await dispatchWheel(page, { ...F, ...pixel });
    expect(await worldTransform(page), `${label}: normalized zoom != pixel-equivalent camera`).toBe(tVar);
    return tVar;
  }

  // Zoom: ctrl and meta, both signs, unsaturated, pixel vs line vs page.
  // From z=2: line 2 = 48px (factor e^0.48); page 0.08 = ~0.08*height px (< ln2/0.01).
  const ctrlLineIn = await zoomEquivalence(
    "ctrl line zoom IN",
    { dy: -2, mode: 1, ctrl: true },
    { dy: -48, mode: 0, ctrl: true },
  );
  await zoomEquivalence(
    "ctrl line zoom OUT",
    { dy: 2, mode: 1, ctrl: true },
    { dy: 48, mode: 0, ctrl: true },
  );
  await zoomEquivalence(
    "ctrl page zoom IN",
    { dy: -0.08, mode: 2, ctrl: true },
    { dy: -0.08 * vp.height, mode: 0, ctrl: true },
  );
  await zoomEquivalence(
    "meta page zoom OUT",
    { dy: 0.08, mode: 2, meta: true },
    { dy: 0.08 * vp.height, mode: 0, meta: true },
  );

  // meta+line must land on the EXACT ctrl+line camera (same path, same focal).
  await startCam();
  await dispatchWheel(page, { ...F, dy: -2, mode: 1, meta: true });
  expect(await worldTransform(page), "meta line zoom != ctrl line zoom camera").toBe(ctrlLineIn);
});

test("real pixel wheel events keep their exact existing numbers (pan and ctrl zoom)", async ({ page }) => {
  await openBoard(page, room("wheel-pixel"));
  const cam0 = await readCamera(page);

  // Real CDP wheel events are pixel-mode: numbers must be untouched.
  await page.mouse.move(640, 400);
  await page.mouse.wheel(120, 60);
  await expect
    .poll(() => readCamera(page))
    .toEqual({ x: cam0.x + 120 / cam0.z, y: cam0.y + 60 / cam0.z, z: cam0.z });

  // ctrl + real pixel wheel: same exp() sensitivity as before, exp(1) for 100
  // (tolerance covers the browser's ~5-decimal transform serialization only).
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  await expect.poll(() => readCamera(page).then((c) => c.z)).toBeCloseTo(Math.exp(1), 4);
});
