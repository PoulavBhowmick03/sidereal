// SPDX-License-Identifier: Apache-2.0

import { test, expect } from "@playwright/test";

// Full mint -> split -> swap -> redeem journey. This needs a deployed market and
// an injected or automated wallet, so it is gated on E2E_MARKET_DEPLOYED and
// skipped otherwise.
const deployed = process.env.E2E_MARKET_DEPLOYED === "1";
const signerReady = process.env.E2E_WALLET_SIGNER === "1";

test.describe("end-to-end protocol flow", () => {
  test.skip(!deployed, "set E2E_MARKET_DEPLOYED=1 with a deployed market and test wallet");

  test("mint, split, swap, then redeem", async ({ page }) => {
    test.fixme(!signerReady, "set E2E_WALLET_SIGNER=1 after wiring a test signer");

    // 1. Connect the test wallet.
    await page.goto("/mint");
    await page.getByRole("button", { name: /connect wallet/i }).click();

    // 2. Mint with split: deposit USDC, receive PT + YT.
    await page.getByPlaceholder("0.0").fill("100");
    await expect(page.getByText(/you will receive/i)).toBeVisible();
    await page.getByRole("button", { name: /deposit and split/i }).click();
    await expect(page.getByText(/confirmed/i)).toBeVisible({ timeout: 60_000 });

    // 3. Swap PT for SY on the trade page.
    await page.goto("/trade");
    await page.getByRole("button", { name: "Sell PT" }).click();
    await page.getByPlaceholder("0.0").fill("10");
    await expect(page.getByText(/expected out/i)).toBeVisible();
    await page.getByRole("button", { name: "Sell PT" }).nth(1).click();
    await expect(page.getByText(/confirmed/i)).toBeVisible({ timeout: 60_000 });

    // 4. Recombine remaining PT + YT back into SY on the portfolio page.
    await page.goto("/portfolio");
    await page.getByPlaceholder("0.0").fill("10");
    await page.getByRole("button", { name: /recombine to sy/i }).click();
    await expect(page.getByText(/confirmed/i)).toBeVisible({ timeout: 60_000 });
  });
});
