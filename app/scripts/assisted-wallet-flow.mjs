#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";

const DEFAULT_BASE_URL = "http://127.0.0.1:3109";
const baseURL = process.env.SIDEREAL_APP_URL ?? DEFAULT_BASE_URL;
const profileDir =
  process.env.SIDEREAL_WALLET_PROFILE ?? path.join(os.homedir(), ".sidereal-playwright-chrome-wallet");
const mintSplitAmount = process.env.SIDEREAL_MINT_SPLIT_AMOUNT ?? "2";
const mintSyAmount = process.env.SIDEREAL_MINT_SY_AMOUNT ?? "2";
const tradeAmount = process.env.SIDEREAL_TRADE_AMOUNT ?? "0.01";
const redeemAmount = process.env.SIDEREAL_REDEEM_AMOUNT ?? "0.01";
const timeout = Number(process.env.SIDEREAL_FLOW_TIMEOUT_MS ?? "240000");
const signatureWait = Number(process.env.SIDEREAL_SIGNATURE_WAIT_MS ?? "60000");
const chromeExecutable = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const defaultExtensionPath = path.join(os.homedir(), ".sidereal-playwright-extensions", "freighter");
const extensionPath = process.env.SIDEREAL_EXTENSION_PATH ?? defaultExtensionPath;
const loadUnpackedExtension = process.env.SIDEREAL_LOAD_UNPACKED_EXTENSION === "1";

if (process.argv.includes("--help")) {
  console.log(`Assisted Sidereal wallet flow

Runs a headed Playwright browser against the local Sidereal app and clicks the
real UI. You still approve wallet popups manually.

Default URL:
  ${DEFAULT_BASE_URL}

Usage:
  pnpm --filter @sidereal/app run wallet:flow

Useful env vars:
  SIDEREAL_APP_URL=http://127.0.0.1:3109
  SIDEREAL_WALLET_PROFILE=${profileDir}
  SIDEREAL_MINT_SPLIT_AMOUNT=2
  SIDEREAL_MINT_SY_AMOUNT=2
  SIDEREAL_TRADE_AMOUNT=0.01
  SIDEREAL_REDEEM_AMOUNT=0.01
  SIDEREAL_SIGNATURE_WAIT_MS=60000
  SIDEREAL_BROWSER_EXECUTABLE="${chromeExecutable}"
  SIDEREAL_EXTENSION_PATH=${defaultExtensionPath}
  SIDEREAL_LOAD_UNPACKED_EXTENSION=0

Prereqs:
  1. The website is running at SIDEREAL_APP_URL.
  2. Install Freighter or another supported wallet in the opened Chrome profile.
  3. Set the wallet to Stellar testnet.
  4. Fund the wallet with testnet XLM and the deployment's custom USDC asset.
`);
  process.exit(0);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let readlineClosed = false;
rl.on("close", () => {
  readlineClosed = true;
});

function url(pathname) {
  return new URL(pathname, baseURL).toString();
}

async function note(message) {
  console.log(`\n==> ${message}`);
}

async function pause(message) {
  if (readlineClosed) return;
  try {
    await rl.question(`\n${message}\nPress Enter to continue. `);
  } catch (error) {
    if (error instanceof Error && error.code === "ERR_USE_AFTER_CLOSE") return;
    throw error;
  }
}

function existingExecutable(...candidates) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

async function launchContext() {
  const args = [];
  if (loadUnpackedExtension && extensionPath && fs.existsSync(path.join(extensionPath, "manifest.json"))) {
    console.log(`Loading extension: ${extensionPath}`);
    args.push(`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`);
  }
  const options = {
    headless: false,
    viewport: { width: 1440, height: 1000 },
    chromiumSandbox: true,
    args,
    ignoreDefaultArgs: ["--disable-extensions", "--no-sandbox"],
  };
  const executablePath = existingExecutable(process.env.SIDEREAL_BROWSER_EXECUTABLE, chromeExecutable);
  if (executablePath !== null) {
    console.log(`Browser executable: ${executablePath}`);
    return chromium.launchPersistentContext(profileDir, {
      ...options,
      executablePath,
    });
  }
  try {
    return await chromium.launchPersistentContext(profileDir, {
      ...options,
      channel: process.env.PLAYWRIGHT_CHROME_CHANNEL ?? "chrome",
    });
  } catch (error) {
    console.warn(`Could not launch Chrome channel, falling back to bundled Chromium.`);
    console.warn(error instanceof Error ? error.message : String(error));
    return chromium.launchPersistentContext(profileDir, options);
  }
}

async function visible(locator, waitMs = 1500) {
  return locator.isVisible({ timeout: waitMs }).catch(() => false);
}

async function ensureConnected(page) {
  await page.goto(url("/mint"), { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Mint" })).toBeVisible({ timeout });

  const connected = page.locator('header button[title^="G"]').first();
  if (await visible(connected)) {
    console.log(`Wallet already connected: ${await connected.getAttribute("title")}`);
    return;
  }

  const connect = page.getByRole("button", { name: "Connect wallet", exact: true });
  await connect.click();
  await pause(
    "Select your wallet in the Sidereal browser window and approve connection. If this is the first run, install Freighter in this Playwright Chrome profile, set it to testnet, then connect.",
  );
  await connected.waitFor({ timeout });
  console.log(`Wallet connected: ${await connected.getAttribute("title")}`);
}

async function setSplit(page, checked) {
  const checkbox = page.getByLabel("Split into PT + YT");
  if ((await checkbox.count()) > 0) {
    await checkbox.setChecked(checked, { force: true });
    return;
  }
  await page.locator('input[type="checkbox"]').first().setChecked(checked, { force: true });
}

async function actionButton(page) {
  const button = page.locator("button.btn-solid").last();
  await expect(button).toBeVisible({ timeout });
  await expect(button).toBeEnabled({ timeout });
  return button;
}

async function approveSignatures(page, label, count) {
  for (let i = 1; i <= count; i += 1) {
    await page
      .getByRole("button", { name: /awaiting signature/i })
      .waitFor({ timeout: signatureWait })
      .catch(() => {});
    await pause(`${label}: approve wallet signature ${i}/${count}.`);
  }
}

async function waitForConfirmed(page, label) {
  const confirmed = page.getByText(/Confirmed\. Tx/i).last();
  await confirmed.waitFor({ timeout });
  console.log(`${label}: ${await confirmed.textContent()}`);
}

async function runAction(page, label, approvals) {
  const button = await actionButton(page);
  await button.click();
  await approveSignatures(page, label, approvals);
  await waitForConfirmed(page, label);
}

async function mint(page, amount, split) {
  await note(split ? `Mint and split ${amount}` : `Mint SY only ${amount}`);
  await page.goto(url("/mint"), { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Mint" })).toBeVisible({ timeout });
  await setSplit(page, split);
  await page.getByPlaceholder("0.0").fill(amount);
  await expect(page.getByText(/You will receive/i)).toBeVisible({ timeout });
  await runAction(page, split ? "Deposit and split" : "Deposit", split ? 2 : 1);
}

async function trade(page, routeLabel, amount) {
  await note(`Trade ${routeLabel} ${amount}`);
  await page.goto(url("/trade"), { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Trade" })).toBeVisible({ timeout });
  await page.getByRole("button", { name: routeLabel, exact: true }).first().click();
  await page.getByPlaceholder("0.0").fill(amount);
  await expect(page.getByText("Price impact")).toBeVisible({ timeout });
  await runAction(page, routeLabel, 1);
}

async function optionalClaim(page) {
  await note("Portfolio claim check");
  await page.goto(url("/portfolio"), { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible({ timeout });

  const claim = page.getByRole("button", { name: /^Claim .* SY$/ });
  if ((await claim.count()) === 0 || !(await claim.first().isEnabled().catch(() => false))) {
    console.log("Claim skipped: no claimable yield is currently available.");
    return;
  }

  await claim.first().click();
  await approveSignatures(page, "Claim yield", 1);
  await waitForConfirmed(page, "Claim yield");
}

async function recombine(page, amount) {
  await note(`Recombine ${amount}`);
  await page.goto(url("/portfolio"), { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible({ timeout });
  await page.getByLabel(/PT \+ YT to recombine|PT to redeem/i).fill(amount);
  await page.getByRole("button", { name: /Recombine to SY|Redeem PT/i }).click();
  await approveSignatures(page, "Recombine", 1);
  await waitForConfirmed(page, "Recombine");
}

async function redeemSy(page, amount) {
  await note(`Redeem SY ${amount}`);
  await page.goto(url("/portfolio"), { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible({ timeout });
  await page.getByLabel("SY to redeem").fill(amount);
  await page.getByRole("button", { name: "Redeem SY to underlying" }).click();
  await approveSignatures(page, "Redeem SY", 1);
  await waitForConfirmed(page, "Redeem SY");
}

async function main() {
  console.log(`Sidereal assisted wallet flow`);
  console.log(`URL: ${baseURL}`);
  console.log(`Wallet profile: ${profileDir}`);
  console.log(`\nThis script clicks the website. You approve wallet prompts manually.`);

  const context = await launchContext();
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    await ensureConnected(page);
    await mint(page, mintSplitAmount, true);
    await mint(page, mintSyAmount, false);
    await trade(page, "Buy PT", tradeAmount);
    await trade(page, "Sell PT", tradeAmount);
    await trade(page, "Buy YT", tradeAmount);
    await trade(page, "Sell YT", tradeAmount);
    await optionalClaim(page);
    await recombine(page, redeemAmount);
    await redeemSy(page, redeemAmount);
    await note("Manual wallet flow completed");
  } finally {
    await pause("Review the final browser state.");
    await context.close();
    rl.close();
  }
}

main().catch(async (error) => {
  console.error("\nFlow failed.");
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  await pause("Fix the issue in the browser if needed, then close this run.");
  rl.close();
  process.exit(1);
});
