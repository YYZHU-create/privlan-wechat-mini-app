const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");

const LOGIN = process.env.ATELIER_UAT_LOGIN || "uat-colleague-20260820@example.test";
const SCREENSHOTS = path.resolve(__dirname, "../../verification/product-completeness/screenshots");

test.beforeAll(() => {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
});

async function openAuthenticated(page) {
  await page.goto("/");
  await expect(page.locator(".app-shell")).toBeVisible({ timeout: 15_000 });
}

async function view(page, name, screenshotName) {
  await page.goto(`/?view=${name}`);
  await expect(page.locator(".app-shell")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: path.join(SCREENSHOTS, `${test.info().project.name}-${screenshotName}.png`), fullPage: true });
  const overflow = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 2);
}

test("Merchant Portal core views are reachable without console or core API failures", async ({ page }) => {
  const consoleErrors = [], pageErrors = [], coreFailures = [];
  page.on("console", message => { if (message.type() === "error" && !/favicon|401 \(Unauthorized\)/i.test(message.text())) consoleErrors.push(message.text()); });
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("response", response => { if (response.status() >= 500 && !/favicon/i.test(response.url())) coreFailures.push(`${response.status()} ${response.url()}`); });
  await openAuthenticated(page);
  await expect(page.locator("body")).toContainText(/概览|工作区|设计/);
  await view(page, "overview", "dashboard");
  await view(page, "design", "design");
  await view(page, "channels", "templates");
  await view(page, "channels", "preview");
  await expect(page.locator("body")).toContainText("小程序预览");
  await expect(page.locator("body")).toContainText("生成最新预览");
  await view(page, "account", "profile");
  await expect(page.locator("body")).toContainText("我的账户");
  await view(page, "customers", "customers");
  await view(page, "ai-service", "ai");
  expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  expect(pageErrors, pageErrors.join("\n")).toEqual([]);
  expect(coreFailures, coreFailures.join("\n")).toEqual([]);
});

test("Merchant Account profile exposes read-only identity fields", async ({ page }) => {
  await openAuthenticated(page);
  await page.goto("/?view=account");
  await expect(page.locator(`input[readonly][value="${LOGIN}"]`)).toBeVisible();
  await expect(page.locator("#profile-display-name")).toBeVisible();
  await expect(page.getByRole("button", { name: "保存个人资料" })).toBeVisible();
});

test("Preview and AI surfaces expose real user-facing states", async ({ page }) => {
  await openAuthenticated(page);
  await page.goto("/?view=channels");
  await expect(page.getByText("生成最新预览", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "扫码预览", exact: true }).first()).toBeVisible();
  await expect(page.locator(".preview-save-state").first()).toHaveCount(1);
  const syncResponse = page.waitForResponse(response => response.url().endsWith("/api/sync") && response.request().method() === "POST");
  await page.getByRole("button", { name: "生成最新预览", exact: true }).click();
  await expect((await syncResponse).status()).toBeLessThan(400);
  await expect(page.locator("body")).toContainText(/已生成最新预览|生成完成|配置已保存/);
  await page.goto("/?view=ai-service");
  await expect(page.locator("body")).toContainText("测试客服");
  await expect(page.locator("body")).not.toContainText("平台 AI");
});
