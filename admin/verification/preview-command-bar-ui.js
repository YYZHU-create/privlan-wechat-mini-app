const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const baseUrl = process.env.ATELIER_UI_BASE_URL || "http://127.0.0.1:40001";
const outputDir = path.join(__dirname, "preview-command-bar");

async function assertViewport(page, viewport) {
  const metrics = await page.evaluate(() => {
    const visible = node => {
      const box = node.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    };
    const bar = document.querySelector(".preview-command-shell .topbar");
    const actionBoxes = [...document.querySelectorAll(".preview-command-actions > *")].filter(visible).map(node => {
      const box = node.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
    });
    return {
      viewport: { width: innerWidth, height: innerHeight },
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      bar: bar ? { left: bar.getBoundingClientRect().left, right: bar.getBoundingClientRect().right, height: bar.getBoundingClientRect().height } : null,
      actionBoxes,
      statusVisible: !!document.querySelector(".preview-save-state") && getComputedStyle(document.querySelector(".preview-save-state")).display !== "none",
      scanLabelVisible: !!document.querySelector(".preview-scan-action .btn-label") && getComputedStyle(document.querySelector(".preview-scan-action .btn-label")).display !== "none"
    };
  });
  assert.ok(metrics.bar, `${viewport.width}px: command bar missing`);
  assert.equal(Math.round(metrics.bar.height), 58, `${viewport.width}px: command bar height`);
  assert.ok(metrics.documentWidth <= metrics.viewport.width + 1, `${viewport.width}px: document overflow`);
  assert.ok(metrics.bodyWidth <= metrics.viewport.width + 1, `${viewport.width}px: body overflow`);
  assert.ok(metrics.actionBoxes.every(box => box.left >= -1 && box.right <= metrics.viewport.width + 1), `${viewport.width}px: action outside viewport`);
  for (let index = 1; index < metrics.actionBoxes.length; index += 1) {
    assert.ok(metrics.actionBoxes[index - 1].right <= metrics.actionBoxes[index].left + 1, `${viewport.width}px: command actions overlap`);
  }
  assert.equal(metrics.statusVisible, viewport.width > 900, `${viewport.width}px: status visibility`);
  assert.equal(metrics.scanLabelVisible, viewport.width > 680, `${viewport.width}px: scan label visibility`);
}

async function register(page) {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  if (await page.locator(".merchant-auth-page").count()) {
    await page.getByRole("button", { name: "还没有账户？创建店铺" }).click();
    await page.getByLabel("登录账号").fill(`preview-command-${Date.now()}@example.com`);
    await page.getByLabel("密码").fill("preview-command-password");
    await page.getByLabel("店铺名称").fill("预览命令栏验收店铺");
    await page.getByLabel("创建空白店铺").check();
    await page.getByRole("button", { name: "创建我的工作区" }).click();
  }
  await page.locator(".topbar").waitFor();
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: "zh-CN" });
  const page = await context.newPage();
  const errors = [];
  const calls = [];
  page.on("pageerror", error => errors.push(error.message));
  for (const endpoint of ["/api/config", "/api/sync", "/api/preview"]) {
    await page.route(`**${endpoint}`, async route => {
      calls.push({ endpoint, method: route.request().method() });
      if (route.request().method() === "POST") {
        const body = endpoint === "/api/config"
          ? { ok: true, git: { ok: true } }
          : endpoint === "/api/sync"
            ? { ok: true, lastSync: new Date().toISOString(), files: [], git: { ok: true } }
            : { ok: true, qrUrl: "/api/preview/qr?v=preview-command-bar" };
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
        return;
      }
      await route.continue();
    });
  }
  try {
    await register(page);
    await page.goto(`${baseUrl}/?view=channels`, { waitUntil: "networkidle" });
    await page.locator(".preview-command-shell .topbar").waitFor();
    const topbarText = await page.locator(".preview-command-shell .topbar").innerText();
    assert.match(topbarText, /小程序预览/);
    assert.match(topbarText, /已保存|未保存|保存中|正在生成|操作失败/);
    assert.equal(await page.locator(".preview-command-shell .atelier-wordmark").count(), 0);
    assert.equal(await page.locator(".preview-command-shell .workspace-switcher").count(), 0);
    assert.equal(await page.locator(".preview-command-shell .crumb").count(), 0);
    assert.equal(await page.locator(".preview-command-actions .icon-btn").count(), 3);
    assert.equal(await page.getByRole("button", { name: "扫码预览" }).count(), 1);
    assert.equal(await page.getByRole("button", { name: "生成预览" }).count(), 1);
    assert.ok(await page.getByRole("button", { name: "保存当前更改" }).count());

    await page.goto(`${baseUrl}/?view=account`, { waitUntil: "networkidle" });
    assert.equal(await page.locator(".topbar .atelier-wordmark").count(), 1, "non-preview brand remains");
    assert.equal(await page.locator(".topbar .workspace-switcher").count(), 1, "non-preview workspace context remains");
    assert.equal(await page.locator(".topbar .crumb-current").count(), 1, "non-preview breadcrumb remains");

    await page.goto(`${baseUrl}/?view=settings`, { waitUntil: "networkidle" });
    const editable = page.locator("#brand-name");
    await editable.waitFor();
    await editable.fill(`${await editable.inputValue()} command-bar`);
    await page.waitForTimeout(250);
    assert.match((await page.locator(".save-state").first().innerText()).trim(), /未保存|有未保存更改/, "settings edit did not mark config dirty");
    await page.getByRole("button", { name: "小程序预览", exact: true }).click();
    await page.locator(".preview-command-shell .topbar").waitFor();
    const status = page.locator(".preview-save-state");
    await status.waitFor();
    assert.equal((await status.innerText()).trim(), "未保存");
    const save = page.getByRole("button", { name: "保存当前更改" });
    assert.equal(await save.isEnabled(), true);
    await page.getByRole("button", { name: "撤销" }).click();
    await page.getByRole("button", { name: "重做" }).click();
    const configResponse = page.waitForResponse(response => response.url().endsWith("/api/config") && response.request().method() === "POST");
    await save.click();
    assert.equal((await configResponse).status(), 200);
    await page.waitForTimeout(150);
    assert.equal((await status.innerText()).trim(), "✓ 已保存");

    const syncResponses = [];
    page.on("response", response => {
      if (["/api/sync", "/api/preview"].some(endpoint => response.url().endsWith(endpoint))) syncResponses.push({ path: new URL(response.url()).pathname, status: response.status() });
    });
    const scanResponse = page.waitForResponse(response => response.url().endsWith("/api/preview") || response.url().endsWith("/api/sync"));
    await page.getByRole("button", { name: "扫码预览" }).click();
    await scanResponse;
    await page.locator(".preview-dialog").waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
    assert.ok(syncResponses.some(item => item.path === "/api/sync"), "scan uses sync handler");
    assert.ok(syncResponses.some(item => item.path === "/api/preview"), "scan uses preview handler");
    const closePreview = page.locator(".preview-dialog .drawer-footer .btn").filter({ hasText: "关闭" });
    if (await closePreview.isVisible()) await closePreview.click({ force: true });
    await page.waitForTimeout(3600);

    for (const viewport of [{ width: 2560, height: 1440 }, { width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 1024, height: 768 }, { width: 430, height: 932 }]) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(100);
      await assertViewport(page, viewport);
      await page.screenshot({ path: path.join(outputDir, `command-bar-${viewport.width}x${viewport.height}.png`) });
    }
    assert.deepEqual(errors, [], `page errors: ${errors.join(" | ")}`);
    process.stdout.write(`Preview Command Bar UI checks passed: ${calls.map(call => `${call.method} ${call.endpoint}`).join(", ")}\n`);
  } finally {
    await context.close();
    await browser.close();
  }
}

run().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
