/**
 * Regenerates docs/screenshot.png: seeds a demo board snapshot, serves it
 * with the real server, and captures the board UI with Playwright.
 *
 *   npm run build && npx tsx scripts/screenshot.ts
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";
import * as Y from "yjs";
import { SnapshotStore } from "../server/persistence.ts";
import { addElement, normalizeStroke } from "../src/lib/elements.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4599;
const ROOM = "demo-board";

function seed(store: SnapshotStore) {
  const doc = new Y.Doc();
  const els = doc.getMap<Y.Map<unknown>>("elements");
  doc.getMap("meta").set("name", "Launch plan");

  addElement(doc, els, { type: "text", x: 60, y: 30, w: 420, h: 60, color: "purple", text: "Launch plan 🚀" });

  // Pen underline beneath the title
  const wave: number[] = [];
  for (let i = 0; i <= 40; i++) {
    wave.push(70 + i * 8, 100 + Math.sin(i / 3.2) * 5, 0.55);
  }
  const strokeId = addElement(doc, els, {
    type: "stroke", x: 0, y: 0, w: 0, h: 0, color: "orange", size: 5, points: wave,
  });
  normalizeStroke(doc, els, strokeId);

  addElement(doc, els, { type: "sticky", x: 60, y: 170, w: 200, h: 200, color: "yellow", text: "Collect beta feedback" });
  addElement(doc, els, { type: "sticky", x: 300, y: 230, w: 200, h: 200, color: "pink", text: "Ship v1 ✨" });
  addElement(doc, els, { type: "sticky", x: 130, y: 420, w: 200, h: 200, color: "blue", text: "Write the docs" });

  const relay = addElement(doc, els, { type: "rect", x: 640, y: 170, w: 240, h: 130, color: "blue" });
  addElement(doc, els, { type: "text", x: 672, y: 218, w: 200, h: 40, color: "blue", text: "Sync server" });
  const clients = addElement(doc, els, { type: "ellipse", x: 1010, y: 330, w: 230, h: 150, color: "green" });
  addElement(doc, els, { type: "text", x: 1074, y: 386, w: 160, h: 40, color: "green", text: "Clients" });

  // Bound arrow: stays attached as shapes move
  addElement(doc, els, {
    type: "arrow", x: 760, y: 235, w: 360, h: 170, color: "purple",
    startRef: relay, endRef: clients,
  });
  addElement(doc, els, {
    type: "arrow", x: 400, y: 330, w: 240, h: -60, color: "pink",
    startRef: undefined, endRef: relay,
  });

  store.saveNow(ROOM, doc);
}

async function main() {
  const dataDir = mkdtempSync(path.join(tmpdir(), "driftboard-shot-"));
  seed(new SnapshotStore(dataDir));

  const server = spawn("npx", ["tsx", path.join(__dirname, "../server/index.ts")], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir },
    stdio: "inherit",
  });
  await new Promise((r) => setTimeout(r, 2000));

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      colorScheme: "light",
    });
    await page.goto(`http://localhost:${PORT}/b/${ROOM}`);
    await page.getByText("Live").waitFor({ timeout: 10_000 });
    await page.locator('[data-element-id]').first().waitFor();
    await page.getByTitle("Zoom to fit").click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(__dirname, "../docs/screenshot.png") });
    console.log("wrote docs/screenshot.png");
  } finally {
    await browser.close();
    const exited = new Promise((r) => server.once("exit", r));
    server.kill("SIGTERM");
    await exited; // let the shutdown flush finish before removing its data dir
    rmSync(dataDir, { recursive: true, force: true });
  }
}

void main();
