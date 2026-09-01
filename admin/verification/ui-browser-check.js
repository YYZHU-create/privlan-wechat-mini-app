const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");

const baseUrl = process.env.ATELIER_UI_BASE_URL || "http://127.0.0.1:40000";
const outputDir = __dirname;

async function assertViewport(page, name) {
  const result = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    visibleDialogs: [...document.querySelectorAll('[role="dialog"]')].filter(node => {
      const box = node.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    }).map(node => {
      const box = node.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
    })
  }));
  assert.ok(result.documentWidth <= result.viewportWidth + 1, `${name}: document overflows by ${result.documentWidth - result.viewportWidth}px`);
  assert.ok(result.bodyWidth <= result.viewportWidth + 1, `${name}: body overflows by ${result.bodyWidth - result.viewportWidth}px`);
  for (const dialog of result.visibleDialogs) {
    assert.ok(dialog.left >= -1 && dialog.right <= result.viewportWidth + 1, `${name}: dialog leaves viewport ${JSON.stringify(dialog)} / ${result.viewportWidth}`);
  }
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const runtimeErrors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: "zh-CN" });
    const page = await context.newPage();
    page.on("pageerror", error => runtimeErrors.push(`pageerror: ${error.message}`));
    page.on("response", response => {
      const url = new URL(response.url());
      if (response.url().startsWith(baseUrl) && response.status() >= 400 && url.pathname !== "/auth/session") runtimeErrors.push(`HTTP ${response.status()} ${url.pathname}`);
    });
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "还没有账户？创建店铺" }).click();
    await page.getByLabel("登录账号").fill(`ui-browser-${Date.now()}@example.com`);
    await page.getByLabel("密码").fill("ui-browser-password");
    await page.getByLabel("店铺名称").fill("浏览器验收店铺");
    await page.getByLabel("创建空白店铺").check();
    await page.getByRole("button", { name: "创建我的工作区" }).click();
    await page.locator(".topbar").waitFor();
    await page.getByRole("button", { name: /账户与订阅/ }).click();
    await page.getByRole("heading", { name: "账户与订阅" }).waitFor();
    await page.screenshot({ path: path.join(outputDir, "ui-1366x768.png") });
    await assertViewport(page, "1366x768 account");
    const undersizedControls = await page.evaluate(() => [...document.querySelectorAll("button,label,input,select,textarea,.nav-item,.field-help,.status-chip")]
      .filter(node => !node.closest(".phone-canvas") && node.getClientRects().length && Number.parseFloat(getComputedStyle(node).fontSize) < 12)
      .map(node => `${node.tagName}.${node.className}:${getComputedStyle(node).fontSize}`).slice(0, 10));
    assert.deepEqual(undersizedControls, [], `functional text below 12px: ${undersizedControls.join(", ")}`);
    await page.keyboard.press("Tab");
    const focusState = await page.evaluate(() => ({ tag: document.activeElement?.tagName, outline: getComputedStyle(document.activeElement).outlineWidth }));
    assert.notEqual(focusState.tag, "BODY", "keyboard focus did not enter the interface");

    for (const viewport of [{ width: 1920, height: 1080 }, { width: 2560, height: 1440 }, { width: 430, height: 932 }]) {
      await page.setViewportSize(viewport);
      await page.screenshot({ path: path.join(outputDir, `ui-${viewport.width}x${viewport.height}.png`) });
      await assertViewport(page, `${viewport.width}x${viewport.height} account`);
    }

    await page.locator(".nav-item").filter({ hasText: "客服" }).click();
    await page.getByRole("button", { name: "添加模型连接" }).first().click();
    await page.getByRole("heading", { name: "添加模型连接" }).waitFor();
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(outputDir, "ui-430x932-ai-drawer.png") });
    await assertViewport(page, "430x932 AI drawer");
    await page.keyboard.press("Escape");

    await page.goto(`${baseUrl}/?view=orders`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "让店铺从设计走向顾客" }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get("view"), "orders", "URL evidence remains while disabled view safely falls back");

    const opsContext = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: "zh-CN" });
    const opsPage = await opsContext.newPage();
    opsPage.on("pageerror", error => runtimeErrors.push(`ops pageerror: ${error.message}`));
    opsPage.on("response", response => {
      const url = new URL(response.url());
      if (response.url().startsWith(baseUrl) && response.status() >= 400 && url.pathname !== "/ops/v1/auth/session") runtimeErrors.push(`ops HTTP ${response.status()} ${url.pathname}`);
    });
    await opsPage.goto(`${baseUrl}/ops/`, { waitUntil: "networkidle" });
    await opsPage.getByLabel("运营账号").fill("ops-admin@localhost");
    await opsPage.getByLabel("密码").fill("ui-operator-password");
    await opsPage.getByRole("button", { name: /进入运营后台/ }).click();
    await opsPage.locator(".ops-topbar").waitFor();
    await opsPage.getByRole("button", { name: /兑换码/ }).click();
    await opsPage.getByRole("heading", { name: "兑换码" }).waitFor();
    await opsPage.screenshot({ path: path.join(outputDir, "ops-1366x768-licenses.png") });
    await assertViewport(opsPage, "1366x768 ops licenses");
    await opsPage.setViewportSize({ width: 430, height: 932 });
    await opsPage.screenshot({ path: path.join(outputDir, "ops-430x932-licenses.png") });
    await assertViewport(opsPage, "430x932 ops licenses");
    await opsContext.close();
    await context.close();

    assert.deepEqual(runtimeErrors, [], runtimeErrors.join("\n"));
    process.stdout.write("UI browser checks passed: 1366x768, 1920x1080, 2560x1440, 430x932, AI drawer, disabled views, ops licenses\n");
  } finally {
    await browser.close();
  }
}

run().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
