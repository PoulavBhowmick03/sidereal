// SPDX-License-Identifier: Apache-2.0

import { test, expect } from "@playwright/test";

// Smoke coverage that runs without a deployed market: the app boots, routes
// render, navigation works, and the wallet entry point is present.

test("landing page renders the protocol pitch and pool stats section", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /fix or trade your stellar yield/i })).toBeVisible();
  await expect(page.getByText(/pool stats/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /connect wallet/i })).toBeVisible();
});

test("nav reaches mint, trade, and redeem", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("link", { name: "Mint" }).click();
  await expect(page.getByRole("heading", { name: "Mint" })).toBeVisible();
  await expect(page.getByRole("button", { name: /connect wallet to mint/i })).toBeVisible();

  await page.getByRole("link", { name: "Trade" }).click();
  await expect(page.getByRole("heading", { name: "Trade" })).toBeVisible();
  await expect(page.getByRole("button", { name: /buy pt/i })).toBeVisible();

  await page.getByRole("link", { name: "Redeem" }).click();
  await expect(page.getByRole("heading", { name: "Redeem" })).toBeVisible();
});

test("trade page exposes all four pool routes", async ({ page }) => {
  await page.goto("/trade");
  for (const label of ["Buy PT", "Sell PT", "Buy YT", "Sell YT"]) {
    await expect(page.getByRole("button", { name: label })).toBeVisible();
  }
});
