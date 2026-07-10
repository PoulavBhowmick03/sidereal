// SPDX-License-Identifier: Apache-2.0

import { test, expect } from "@playwright/test";

// Smoke coverage that runs without a deployed market: the app boots, routes
// render, navigation works, and the wallet entry point is present.

const PUBLIC_PASSPHRASE = "Public Global Stellar Network ; September 2015";
const isPublicProfile = process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE === PUBLIC_PASSPHRASE;

test("landing page renders the protocol pitch and a launch CTA", async ({ page }) => {
  await page.goto("/");
  // Marketing hero: editorial headline, the PT+YT=SY invariant, and a Launch App CTA.
  await expect(
    page.getByRole("heading", { name: /split stellar yield into principal and yield/i }),
  ).toBeVisible();
  await expect(page.getByText("PT + YT = SY")).toBeVisible();
  await expect(page.getByRole("link", { name: /launch app/i }).first()).toBeVisible();
});

test("nav reaches mint, trade, pool, and portfolio", async ({ page }) => {
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
  await expect(page.getByRole("button", { name: "Deposit SY", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Deposit + split", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /connect wallet to mint/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Getting started" })).toBeVisible();

  await nav.getByRole("link", { name: "Trade" }).click();
  await expect(page).toHaveURL(/\/trade$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Trade" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Buy PT" })).toBeVisible();

  await nav.getByRole("link", { name: "Pool" }).click();
  await expect(page).toHaveURL(/\/pool$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Pool", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Add liquidity" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Remove liquidity" })).toBeVisible();

  await nav.getByRole("link", { name: "Portfolio" }).click();
  await expect(page).toHaveURL(/\/portfolio$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible();

});

test("mint page frames fixed and variable choices on a blend market", async ({ page }) => {
  test.skip(
    process.env.NEXT_PUBLIC_YIELD_SOURCE_KIND !== "blend",
    "yield choice renders only for Blend-backed markets",
  );
  await page.goto("/mint");
  await expect(page.getByText("Choose your yield exposure")).toBeVisible();
  await expect(page.getByText("Lock a fixed rate with PT")).toBeVisible();
  await expect(page.getByText("Stay variable or buy YT")).toBeVisible();
});

test("trade page exposes all four pool routes", async ({ page }) => {
  await page.goto("/trade");
  for (const label of ["Buy PT", "Sell PT", "Buy YT", "Sell YT"]) {
    await expect(page.getByRole("button", { name: label })).toBeVisible();
  }
});

test("pool page exposes liquidity actions and live stats shell", async ({ page }) => {
  await page.goto("/pool");
  await expect(page.getByRole("heading", { name: "Pool", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Add liquidity" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Remove liquidity" })).toBeVisible();
  await expect(page.getByRole("button", { name: /connect wallet to add liquidity/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /connect wallet to remove liquidity/i })).toBeVisible();
  await expect(page.getByText("Pool status")).toBeVisible();
  await expect(page.getByText("Your LP position")).toBeVisible();
});

test("demo page exposes the automated proof runner without starting it", async ({ page }) => {
  await page.goto("/demo?manual=1");
  await expect(page.getByRole("heading", { name: "Demo", exact: true })).toBeVisible();
  if (isPublicProfile) {
    await expect(page.getByText(/automation disabled/i)).toBeVisible();
    await expect(page.getByLabel("Maturity date")).toHaveCount(0);
    await expect(page.getByText("No output yet.")).toHaveCount(0);
    return;
  }
  await expect(page.getByRole("button", { name: /run full demo|run locally/i })).toBeVisible();
  await expect(page.getByLabel("Maturity date")).toBeVisible();
  for (const label of ["Auth invariant", "Live AMM proof"]) {
    await expect(page.getByRole("heading", { name: label })).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "Browser smoke" })).toHaveCount(0);
  await expect(page.getByText("No output yet.")).toBeVisible();
});

test("demo page guides the manual Blend walkthrough on a blend market", async ({ page }) => {
  test.skip(
    process.env.NEXT_PUBLIC_YIELD_SOURCE_KIND !== "blend",
    "walkthrough renders only for Blend-backed markets",
  );
  await page.goto("/demo?manual=1");
  const main = page.getByRole("main");
  await expect(
    main.getByText("Manual walkthrough: tokenize a real Blend deposit"),
  ).toBeVisible();
  for (const label of isPublicProfile
    ? ["Connect a wallet", "Bring Circle USDC", "Supply USDC on Blend", "Tokenize on the mint page"]
    : ["Connect a wallet", "Get Blend testnet USDC", "Supply USDC on Blend", "Tokenize on the mint page"]) {
    await expect(main.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(
    page.getByRole("link", { name: isPublicProfile ? "Open Blend" : "Open Blend testnet" }),
  ).toHaveAttribute("href", isPublicProfile ? "https://blend.capital" : "https://testnet.blend.capital");
  await expect(page.getByRole("link", { name: "Go to mint" })).toHaveAttribute("href", "/mint");
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
