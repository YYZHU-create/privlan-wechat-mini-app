const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const baseUrl = process.env.ATELIER_UI_BASE_URL || "http://127.0.0.1:40001";
const gatewayToken = process.env.ATELIER_APPOINTMENT_GATEWAY_TOKEN || "";
const outputDir = path.join(__dirname, "appointment-customer-saas-1.0", "screenshots");

async function json(response) {
  return { status: response.status(), body: await response.json() };
}

async function assertViewport(page, label) {
  const metrics = await page.evaluate(() => {
    const visible = node => { const box = node.getBoundingClientRect(); return box.width > 0 && box.height > 0; };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      dialogs: [...document.querySelectorAll('[role="dialog"]')].filter(visible).map(node => {
        const box = node.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth };
      })
    };
  });
  assert.ok(metrics.document.width <= metrics.viewport.width + 1, `${label}: horizontal overflow ${JSON.stringify(metrics)}`);
  for (const dialog of metrics.dialogs) {
    assert.ok(dialog.left >= -1 && dialog.right <= metrics.viewport.width + 1, `${label}: dialog outside viewport ${JSON.stringify(dialog)}`);
    assert.ok(dialog.scrollWidth <= dialog.clientWidth + 1, `${label}: dialog horizontal overflow ${JSON.stringify(dialog)}`);
    assert.ok(dialog.top >= -1 && dialog.bottom <= metrics.viewport.height + 1, `${label}: dialog outside vertical viewport ${JSON.stringify(dialog)}`);
  }
}

async function run() {
  assert.ok(gatewayToken.length >= 32, "ATELIER_APPOINTMENT_GATEWAY_TOKEN is required for UI verification");
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: "zh-CN" });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(`pageerror ${error.message}`));
    page.on("response", response => {
      const url = new URL(response.url());
      if (response.url().startsWith(baseUrl) && response.status() >= 500) errors.push(`HTTP ${response.status()} ${url.pathname}`);
    });
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "还没有账户？创建店铺" }).click();
    await page.getByLabel("登录账号").fill(`appointment-ui-${Date.now()}@example.com`);
    await page.getByLabel("密码").fill("appointment-ui-password");
    await page.getByLabel("店铺名称").fill("预约验收店铺");
    await page.getByLabel("创建空白店铺").check();
    const registrationResponse = page.waitForResponse(response => response.url().endsWith("/auth/register"));
    await page.getByRole("button", { name: "创建我的工作区" }).click();
    const registration = await (await registrationResponse).json();
    const publicStoreId = registration.data.workspace.publicStoreId;
    await page.locator(".topbar").waitFor();

    const ops = await browser.newContext({ locale: "zh-CN" });
    const opsLogin = await json(await ops.request.post(`${baseUrl}/ops/v1/auth/login`, { data: { email: "ops-admin@localhost", password: process.env.ATELIER_OPS_PASSWORD } }));
    assert.equal(opsLogin.status, 200, JSON.stringify(opsLogin.body));
    const license = await json(await ops.request.post(`${baseUrl}/ops/v1/license-codes`, { data: { planId: "PRO", durationHours: 24, count: 1 } }));
    assert.equal(license.status, 201, JSON.stringify(license.body));
    const csrf = (await context.cookies(baseUrl)).find(item => item.name === "atelier_csrf")?.value;
    const redeemed = await json(await context.request.post(`${baseUrl}/v1/licenses/redeem`, { headers: { "x-atelier-csrf": csrf }, data: { code: license.body.data[0].code } }));
    assert.equal(redeemed.status, 200, JSON.stringify(redeemed.body));
    await ops.close();

    const services = await json(await context.request.get(`${baseUrl}/v1/appointment-services`));
    const advisors = await json(await context.request.get(`${baseUrl}/v1/appointment-advisors`));
    const gatewayHeaders = { Authorization: `Bearer ${gatewayToken}` };
    const options = await json(await context.request.post(`${baseUrl}/v1/miniprogram/appointment-options`, { headers: gatewayHeaders, data: { publicStoreId, serviceId: services.body.data[0].id } }));
    let selectedSlot = null;
    for (const date of options.body.data.dates) {
      const day = await json(await context.request.post(`${baseUrl}/v1/miniprogram/appointment-options`, { headers: gatewayHeaders, data: { publicStoreId, serviceId: services.body.data[0].id, advisorId: advisors.body.data[0].id, date: date.value } }));
      selectedSlot = day.body.data.slots.find(item => item.available);
      if (selectedSlot) break;
    }
    assert.ok(selectedSlot, "no available slot found for UI fixture");
    const created = await json(await context.request.post(`${baseUrl}/v1/miniprogram/appointments`, { headers: gatewayHeaders, data: { publicStoreId, openid: `ui-openid-${Date.now()}`, customerName: "林映秋", customerPhone: "13800138000", serviceId: services.body.data[0].id, advisorId: advisors.body.data[0].id, startAt: selectedSlot.startAt, notes: "偏好深色面料", idempotencyKey: `ui-${Date.now()}` } }));
    assert.equal(created.status, 200, JSON.stringify(created.body));

    await page.goto(`${baseUrl}/?view=customers`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "预约与客户" }).waitFor();
    const viewports = [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }, { width: 430, height: 932 }];
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(150);
      await assertViewport(page, `${viewport.width}x${viewport.height} appointment list`);
      await page.screenshot({ path: path.join(outputDir, `appointments-${viewport.width}x${viewport.height}.png`), fullPage: false });
    }

    await page.locator(".appointment-row").first().click();
    await page.getByRole("heading", { name: "预约详情" }).waitFor();
    await page.waitForTimeout(250);
    await assertViewport(page, "430x932 appointment drawer");
    await page.screenshot({ path: path.join(outputDir, "appointment-drawer-430x932.png") });
    await page.getByRole("button", { name: "关闭预约详情" }).click();

    await page.getByRole("tab", { name: "客户" }).click();
    await page.locator(".customer-row").first().click();
    await page.getByRole("heading", { name: "客户详情" }).waitFor();
    await page.waitForTimeout(250);
    await assertViewport(page, "430x932 customer drawer");
    await page.screenshot({ path: path.join(outputDir, "customer-drawer-430x932.png") });
    await page.getByRole("button", { name: "关闭客户详情" }).click();

    await page.getByRole("button", { name: /预约设置/ }).click();
    await page.getByRole("heading", { name: "预约设置" }).waitFor();
    for (const section of [{ name: "预约规则", slug: "rules" }, { name: "营业时间", slug: "hours" }, { name: "服务", slug: "services" }, { name: "服务人员", slug: "advisors" }]) {
      await page.getByRole("button", { name: section.name, exact: true }).click();
      await page.waitForTimeout(100);
      await assertViewport(page, `430x932 settings ${section.name}`);
      await page.screenshot({ path: path.join(outputDir, `settings-${section.slug}.png`) });
    }
    assert.deepEqual(errors, [], errors.join("\n"));
    process.stdout.write("Appointment UI checks passed: lists, appointment/customer drawers, rules, hours, services, advisors at 1366x768, 1920x1080, 430x932\n");
    await context.close();
  } finally { await browser.close(); }
}

run().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
