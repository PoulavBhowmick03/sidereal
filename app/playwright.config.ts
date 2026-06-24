// SPDX-License-Identifier: Apache-2.0

import { defineConfig, devices } from "@playwright/test";

// Mobile-first: the app targets phone users (AGENTS.md section 7), so the
// default project emulates a phone viewport. Run with `pnpm test:e2e`.
// Browsers must be installed once: `pnpm exec playwright install chromium`.
// Use a dedicated port so the e2e dev server never collides with a default
// Next app on :3000 (yours or another project's).
const PORT = process.env.E2E_PORT ?? "3100";
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `pnpm exec next dev -p ${PORT}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
