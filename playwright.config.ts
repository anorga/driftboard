import { defineConfig } from "@playwright/test";

/**
 * E2E tests run against the production server (which serves dist/ and the
 * WebSocket relay on one port) — run `npm run build` first. DATA_DIR= keeps
 * the test server purely in-memory so runs never touch local snapshots.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://localhost:4173",
  },
  webServer: {
    command: "npm run start:e2e",
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
});
