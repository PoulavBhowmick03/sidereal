// SPDX-License-Identifier: Apache-2.0

import { test, expect } from "@playwright/test";

// Smoke coverage that runs without a deployed market: the app boots, routes
// render, navigation works, and the wallet entry point is present.

test("landing page renders the protocol pitch and a launch CTA", async ({ page }) => {
  await page.goto("/");
  // Marketing hero: editorial headline, the PT+YT=SY invariant, and a Launch App CTA.
  await expect(
    page.getByRole("heading", { name: /split stellar yield into principal and yield/i }),
  ).toBeVisible();
  await expect(page.getByText("PT + YT = SY")).toBeVisible();
  await expect(page.getByRole("link", { name: /launch app/i }).first()).toBeVisible();
});

test("nav reaches mint, trade, and portfolio", async ({ page }) => {
  // The in-app tabs live in the app shell, not on the marketing landing. Enter
  // the app first via Launch App, then exercise the header tabs.
  await page.goto("/");
  await page.getByRole("link", { name: /launch app/i }).first().click();
  await expect(page).toHaveURL(/\/trade$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Trade" })).toBeVisible({ timeout: 15_000 });

  const nav = page.locator("header nav");

  await nav.getByRole("link", { name: "Mint" }).click();
  await expect(page).toHaveURL(/\/mint$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Mint" })).toBeVisible();
  await expect(page.getByRole("button", { name: /connect wallet to mint/i })).toBeVisible();

  await nav.getByRole("link", { name: "Trade" }).click();
  await expect(page).toHaveURL(/\/trade$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Trade" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Buy PT" })).toBeVisible();

  await nav.getByRole("link", { name: "Portfolio" }).click();
  await expect(page).toHaveURL(/\/portfolio$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible();
});

test("trade page exposes all four pool routes", async ({ page }) => {
  await page.goto("/trade");
  for (const label of ["Buy PT", "Sell PT", "Buy YT", "Sell YT"]) {
    await expect(page.getByRole("button", { name: label })).toBeVisible();
  }
});

test("production public contract configuration reaches the browser", async ({ page }) => {
  test.skip(
    process.env.E2E_EXPECT_DEPLOYED !== "1",
    "set E2E_EXPECT_DEPLOYED=1 when the target has public contract addresses",
  );
  await page.goto("/trade");
  await expect(page.getByText(/no market is configured yet/i)).toHaveCount(0);
});

test("configured market loads a live mint preview", async ({ page }) => {
  test.skip(
    process.env.E2E_EXPECT_DEPLOYED !== "1",
    "set E2E_EXPECT_DEPLOYED=1 when the target has a readable market",
  );
  await page.goto("/mint");
  await page.getByPlaceholder("0.0").fill("10");
  await expect(page.getByText(/you will receive/i)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/market not deployed yet/i)).toHaveCount(0);
});
