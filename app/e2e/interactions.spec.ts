// SPDX-License-Identifier: Apache-2.0

import { test, expect } from "@playwright/test";

// Exercises the client-side validation and connect-gating without a wallet or a
// deployed market: behavior the unit tests cover at the lib level, verified here
// through the real browser.

test("mint validates the amount and gates on wallet connection", async ({ page }) => {
  await page.goto("/mint");
  const input = page.getByPlaceholder("0.0");
  const submit = page.getByRole("button", { name: /connect wallet to mint/i });

  await expect(submit).toBeDisabled();

  await input.fill("abc");
  await expect(page.getByText(/invalid amount/i)).toBeVisible();

  await input.fill("0");
  await expect(page.getByText(/greater than zero/i)).toBeVisible();

  await input.fill("1.23456789"); // more than 7 decimals
  await expect(page.getByText(/too many decimals/i)).toBeVisible();

  await input.fill("10");
  // A valid amount clears the error; the action stays gated on connecting.
  await expect(page.getByText(/invalid amount|greater than zero|too many decimals/i)).toHaveCount(0);
  await expect(submit).toBeDisabled();
});

test("redeem validates the amount", async ({ page }) => {
  await page.goto("/redeem");
  const input = page.getByRole("textbox", { name: /pt \+ yt to recombine|pt to redeem/i });

  await input.fill("abc");
  await expect(page.getByText(/invalid amount/i)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect wallet to redeem", exact: true }),
  ).toBeDisabled();
});

test("redeem exposes claim, recombine, and SY unwrap actions", async ({ page }) => {
  await page.goto("/redeem");
  await expect(page.getByRole("button", { name: /connect wallet to claim/i })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Connect wallet to redeem", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Connect wallet to redeem SY", exact: true }),
  ).toBeDisabled();

  const inputs = page.getByPlaceholder("0.0");
  await inputs.nth(1).fill("abc");
  await expect(page.getByText(/invalid amount/i)).toBeVisible();
});

test("trade gates submission on wallet connection", async ({ page }) => {
  await page.goto("/trade");
  await expect(page.getByRole("button", { name: "Buy PT" })).toBeVisible();
  await page.getByPlaceholder("0.0").fill("5");
  await expect(page.getByRole("button", { name: /connect wallet to trade/i })).toBeDisabled();
});

test("trade warns that YT routes may not settle", async ({ page }) => {
  await page.goto("/trade");
  // PT route: no warning.
  await expect(page.getByText(/flash-route through the pool/i)).toHaveCount(0);
  // YT route: warning appears.
  await page.getByRole("button", { name: "Buy YT" }).click();
  await expect(page.getByText(/flash-route through the pool/i)).toBeVisible();
});
