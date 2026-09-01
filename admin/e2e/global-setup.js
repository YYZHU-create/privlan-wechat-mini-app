const { chromium } = require("@playwright/test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

module.exports = async function globalSetup(config) {
  const login = process.env.ATELIER_UAT_LOGIN || "uat-colleague-20260820@example.test";
  const password = process.env.ATELIER_UAT_PASSWORD;
  if (!password) throw new Error("ATELIER_UAT_PASSWORD must be provided at runtime");
  const statePath = path.join(os.tmpdir(), "atelier-os-product-uat-storage.json");
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: process.env.UAT_BASE_URL || "http://127.0.0.1:3457" });
  const page = await context.newPage();
  await page.goto("/");
  await page.locator('input[name="login"]').fill(login);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.locator(".app-shell").waitFor({ state: "visible", timeout: 20_000 });
  await context.storageState({ path: statePath });
  await browser.close();
};
