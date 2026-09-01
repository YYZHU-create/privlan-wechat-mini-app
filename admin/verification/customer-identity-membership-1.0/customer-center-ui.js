const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const baseUrl = process.env.ATELIER_UI_BASE_URL || "http://127.0.0.1:41001";
const gatewayToken = process.env.ATELIER_APPOINTMENT_GATEWAY_TOKEN || "ui-test-gateway-token-with-at-least-32-bytes";
const outputDir = path.join(__dirname, "screenshots");

async function assertViewport(page, label) {
  const metrics = await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth, dialogs: [...document.querySelectorAll('[role="dialog"]')].filter(node => node.getClientRects().length).map(node => { const box=node.getBoundingClientRect();return {left:box.left,right:box.right,scrollWidth:node.scrollWidth,clientWidth:node.clientWidth}; }) }));
  assert.ok(metrics.documentWidth <= metrics.width + 1, `${label}: document overflow`);
  assert.ok(metrics.bodyWidth <= metrics.width + 1, `${label}: body overflow`);
  for (const dialog of metrics.dialogs) { assert.ok(dialog.left >= -1 && dialog.right <= metrics.width + 1, `${label}: drawer outside viewport`); assert.ok(dialog.scrollWidth <= dialog.clientWidth + 1, `${label}: drawer overflow`); }
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: "zh-CN" });
  const page = await context.newPage(); const errors=[];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "还没有账户？创建店铺" }).click();
    await page.getByLabel("登录账号").fill(`customer-center-${Date.now()}@example.com`);
    await page.getByLabel("密码").fill("customer-center-password");
    await page.getByLabel("店铺名称").fill("客户中心验收店铺");
    await page.getByLabel("创建空白店铺").check();
    const registrationResponse = page.waitForResponse(response => response.url().endsWith("/auth/register"));
    await page.getByRole("button", { name: "创建我的工作区" }).click();
    const registration = await (await registrationResponse).json();
    const publicStoreId = registration.data.workspace.publicStoreId;
    const touched = await context.request.post(`${baseUrl}/v1/miniprogram/customers/touch`, { headers: { Authorization: `Bearer ${gatewayToken}` }, data: { publicStoreId, openid: "trusted-ui-openid", displayName: "微信访客" } });
    assert.equal(touched.status(), 200, await touched.text());
    await page.goto(`${baseUrl}/?view=customers`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "客户中心" }).waitFor();
    assert.equal(await page.getByText("全部用户", { exact: true }).count() > 0, true);
    assert.equal(await page.getByText("顾客", { exact: true }).count() > 0, true);
    assert.equal(await page.getByText("会员", { exact: true }).count() > 0, true);
    await page.locator(".customer-row").first().click();
    await page.getByRole("heading", { name: "客户详情" }).waitFor();
    await page.locator(".customer-360-tabs").waitFor();
    const drawer = page.locator(".customer-360-drawer");
    for (const tab of ["概览","订单","预约","会员","动态","备注"]) assert.equal(await drawer.getByRole("button", { name: tab, exact: true }).count(), 1, `${tab} tab`);
    for (const viewport of [{width:1920,height:1080},{width:1366,height:768},{width:1024,height:768},{width:430,height:932}]) { await page.setViewportSize(viewport); await page.waitForTimeout(100); await assertViewport(page, `${viewport.width}x${viewport.height}`); await page.screenshot({ path:path.join(outputDir,`customer-drawer-${viewport.width}x${viewport.height}.png`) }); }
    await page.getByRole("button", { name: "关闭客户详情" }).click();
    await page.getByRole("tab", { name: "标签", exact: true }).click();
    assert.equal(await page.getByPlaceholder("新标签名称").count(), 1);
    await page.getByRole("tab", { name: "会员设置", exact: true }).click();
    assert.equal(await page.getByText("会员计划", { exact: true }).count(), 1);
    await page.goto(`${baseUrl}/?view=appointments`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "预约管理" }).waitFor();
    assert.deepEqual(errors, []);
    process.stdout.write("Customer Center UI checks passed: navigation, filters, Customer 360 tabs, tags, membership settings, 1920/1366/1024/430.\n");
  } finally { await context.close(); await browser.close(); }
}
run().catch(error => { console.error(error.stack || error); process.exitCode=1; });
