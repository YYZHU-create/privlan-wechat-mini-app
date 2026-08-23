const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");

const SCREENSHOTS = path.resolve(__dirname, "../../verification/sprint1-merchant-os/browser-uat");
const UAT_CUSTOMER = "Sprint 1 UAT 客户";

function screenshotPath(name) { return path.join(SCREENSHOTS, `${test.info().project.name}-${name}.png`); }
async function assertNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 2);
}
async function closeDrawer(page, label) {
  const button = page.getByRole("button", { name: label, exact: true });
  await button.click();
  await expect(button).toBeHidden();
}
async function switchToView(page, label) {
  const mobileNavigation = page.getByRole("button", { name: "打开主导航", exact: true });
  if (await mobileNavigation.isVisible().catch(() => false)) {
    await mobileNavigation.click();
    await expect(page.getByRole("navigation", { name: "主导航", exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: label, exact: true }).click();
}

test.beforeAll(() => fs.mkdirSync(SCREENSHOTS, { recursive: true }));

test("Sprint 1 Merchant OS browser gate uses real Customer and Appointment data", async ({ page }) => {
  const consoleErrors = [];
  const pageErrors = [];
  const networkErrors = [];
  page.on("console", message => {
    if (message.type() === "error" && !/favicon/i.test(message.text())) consoleErrors.push(message.text());
  });
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("response", response => {
    if (response.url().startsWith("http://127.0.0.1:40003") && response.status() >= 400) networkErrors.push(`${response.status()} ${new URL(response.url()).pathname}`);
  });

  await page.goto("/?view=overview");
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.locator(".nav-group-label")).toContainText(["工作台", "内容中心", "经营中心", "账户"]);
  await expect(page.locator(".overview-metrics")).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: screenshotPath("dashboard"), fullPage: true });
  await page.screenshot({ path: screenshotPath("navigation"), fullPage: false });

  await switchToView(page, "客户中心");
  await expect(page.getByRole("heading", { name: "客户中心", exact: true })).toBeVisible();
  const customerRow = page.locator(".customer-row").filter({ hasText: UAT_CUSTOMER }).first();
  await expect(customerRow).toBeVisible();
  await assertNoHorizontalOverflow(page);
  if (["1366", "430"].includes(test.info().project.name)) await page.screenshot({ path: screenshotPath("customer-list"), fullPage: true });
  await customerRow.click();
  await expect(page.getByRole("heading", { name: "客户详情", exact: true })).toBeVisible();
  await expect(page.locator(".customer-360-drawer")).toContainText("139****0001");
  await expect(page.locator(".customer-360-drawer")).toContainText("预约");
  await page.getByRole("button", { name: "会员", exact: true }).click();
  await expect(page.locator(".customer-360-drawer")).toContainText("会员与积分");
  if (["1366", "430"].includes(test.info().project.name)) await page.screenshot({ path: screenshotPath("customer-360"), fullPage: true });
  await page.getByRole("button", { name: "动态", exact: true }).click();
  await expect(page.locator(".customer-360-drawer")).toContainText(/appointment_created|follow_up_created/);
  await closeDrawer(page, "关闭客户详情");

  await switchToView(page, "预约中心");
  await expect(page.getByRole("heading", { name: "预约管理", exact: true })).toBeVisible();
  const appointmentRow = page.locator(".appointment-row").filter({ hasText: UAT_CUSTOMER }).first();
  await expect(appointmentRow).toBeVisible();
  await assertNoHorizontalOverflow(page);
  if (["1366", "430"].includes(test.info().project.name)) await page.screenshot({ path: screenshotPath("appointment-list"), fullPage: true });

  const availability = await page.evaluate(async () => {
    const response = await fetch("/v1/appointments/availability");
    const result = await response.json();
    return { status: response.status, ok: result.ok, data: result.data };
  });
  expect(availability.status).toBe(200);
  expect(availability.ok).toBe(true);
  expect(Array.isArray(availability.data.slots)).toBe(true);
  expect(availability.data.slots.length).toBeGreaterThan(0);
  if (["1366", "430"].includes(test.info().project.name)) await page.screenshot({ path: screenshotPath("availability"), fullPage: false });

  await appointmentRow.click();
  await expect(page.getByRole("heading", { name: "预约详情", exact: true })).toBeVisible();
  const detail = page.locator(".appointment-detail-drawer");
  await expect(detail).toContainText(UAT_CUSTOMER);
  await expect(detail).toContainText("门店");
  await expect(detail).toContainText("服务时长");
  await expect(detail).toContainText("操作动态");
  if (["1366", "430"].includes(test.info().project.name)) await page.screenshot({ path: screenshotPath("appointment-detail"), fullPage: true });

  if (test.info().project.name === "1366") {
    const followUp = `Sprint 1 Browser UAT ${new Date().toISOString()}`;
    await detail.locator("textarea#appointment-follow-up").fill(followUp);
    await detail.getByRole("button", { name: "添加跟进", exact: true }).click();
    await expect(detail).toContainText("follow_up_created");
    await page.screenshot({ path: screenshotPath("follow-up"), fullPage: true });
  }
  await closeDrawer(page, "关闭预约详情");

  if (test.info().project.name === "1366") {
    await page.reload();
    await switchToView(page, "预约中心");
    await page.locator(".appointment-row").filter({ hasText: UAT_CUSTOMER }).first().click();
    await expect(page.locator(".appointment-detail-drawer")).toContainText("follow_up_created");
    await closeDrawer(page, "关闭预约详情");
    await switchToView(page, "客户中心");
    await page.locator(".customer-row").filter({ hasText: UAT_CUSTOMER }).first().click();
    await page.getByRole("button", { name: "动态", exact: true }).click();
    await expect(page.locator(".customer-360-drawer")).toContainText("follow_up_created");
    await closeDrawer(page, "关闭客户详情");
  }

  await switchToView(page, "会员中心");
  await expect(page.locator(".appointment-tabs")).toContainText("会员设置");
  await assertNoHorizontalOverflow(page);
  expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  expect(pageErrors, pageErrors.join("\n")).toEqual([]);
  expect(networkErrors, networkErrors.join("\n")).toEqual([]);
});
