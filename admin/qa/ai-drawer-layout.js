const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const APP_URL = process.env.ATELIER_QA_URL || "http://127.0.0.1:3456/?view=ai-service";
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
].filter(Boolean);
const VIEWPORTS = [[1329, 912], [1024, 768], [430, 932], [320, 640]];

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function availablePort() {
  const server = net.createServer();
  const port = await listen(server);
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitForJson(url, attempts = 80) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw lastError || new Error(`无法连接 ${url}`);
}

class CdpClient {
  constructor(url) {
    this.id = 0;
    this.pending = new Map();
    this.consoleErrors = [];
    this.opened = new Promise((resolve, reject) => {
      this.socket = new WebSocket(url);
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
      this.socket.addEventListener("message", event => this.receive(JSON.parse(event.data)));
    });
  }

  receive(message) {
    if (message.id && this.pending.has(message.id)) {
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message)); else resolve(message.result || {});
      return;
    }
    if (message.method === "Runtime.exceptionThrown") this.consoleErrors.push(message.params.exceptionDetails?.text || "Runtime exception");
    if (message.method === "Log.entryAdded" && ["error", "warning"].includes(message.params.entry?.level)) {
      const entry = message.params.entry;
      if (!String(entry.url || "").endsWith("/favicon.ico")) this.consoleErrors.push(`${entry.text}${entry.url ? ` (${entry.url})` : ""}`);
    }
  }

  async send(method, params = {}) {
    await this.opened;
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() { this.socket.close(); }
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "页面脚本执行失败");
  return result.result?.value;
}

function layoutExpression() {
  return `(() => {
    const pick = selector => document.querySelector(selector);
    const rect = element => {
      const value = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return { top:value.top, right:value.right, bottom:value.bottom, left:value.left, width:value.width, height:value.height, scrollWidth:element.scrollWidth, clientWidth:element.clientWidth, scrollHeight:element.scrollHeight, clientHeight:element.clientHeight, overflowY:style.overflowY };
    };
    return {
      viewport:{ width:innerWidth, height:innerHeight },
      topbar:rect(pick('.topbar')),
      drawer:rect(pick('.ai-connection-drawer')),
      header:rect(pick('.ai-connection-drawer .drawer-header')),
      title:rect(pick('#ai-connection-title')),
      description:rect(pick('#ai-connection-description')),
      body:rect(pick('.ai-connection-drawer .drawer-body')),
      footer:rect(pick('.ai-connection-drawer .drawer-footer')),
      activeId:document.activeElement?.id || ''
    };
  })()`;
}

function assertLayout(metrics) {
  const tolerance = 1.1;
  assert.ok(Math.abs(metrics.drawer.top - metrics.topbar.bottom) <= tolerance, "抽屉必须紧接顶栏");
  assert.ok(metrics.title.top >= metrics.header.top - tolerance && metrics.title.bottom <= metrics.header.bottom + tolerance, "标题超出抽屉头部");
  assert.ok(metrics.description.bottom <= metrics.header.bottom + tolerance, "说明文字超出抽屉头部");
  assert.ok(metrics.header.bottom <= metrics.body.top + tolerance, "头部与正文重叠");
  assert.ok(metrics.body.bottom <= metrics.footer.top + tolerance, "正文与底部操作区重叠");
  assert.ok(metrics.footer.bottom <= metrics.viewport.height + tolerance, "底部操作区超出视口");
  assert.ok(metrics.drawer.right <= metrics.viewport.width + tolerance && metrics.drawer.left >= -tolerance, "抽屉横向超出视口");
  assert.ok(metrics.drawer.scrollWidth <= metrics.drawer.clientWidth + 1, "抽屉存在横向滚动");
  assert.ok(metrics.header.scrollWidth <= metrics.header.clientWidth + 1, "抽屉头部存在横向溢出");
  assert.equal(metrics.body.overflowY, "auto", "只允许正文区域滚动");
}

async function main() {
  const chromePath = CHROME_CANDIDATES.find(candidate => fs.existsSync(candidate));
  if (!chromePath) throw new Error("未找到 Chrome 或 Edge");
  const debugPort = await availablePort();
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-drawer-chrome-"));
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-drawer-qa-"));
  const chrome = spawn(chromePath, [
    "--headless=new",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank"
  ], { windowsHide: true, stdio: "ignore" });

  let client;
  try {
    await waitForJson(`http://127.0.0.1:${debugPort}/json/version`);
    const targets = await waitForJson(`http://127.0.0.1:${debugPort}/json/list`);
    const target = targets.find(item => item.type === "page");
    if (!target) throw new Error("未找到页面调试目标");
    client = new CdpClient(target.webSocketDebuggerUrl);
    await Promise.all([client.send("Page.enable"), client.send("Runtime.enable"), client.send("Log.enable")]);
    await client.send("Page.navigate", { url: APP_URL });
    await new Promise(resolve => setTimeout(resolve, 600));
    await evaluate(client, `new Promise((resolve, reject) => {
      const started = Date.now();
      const find = () => {
        const button = [...document.querySelectorAll('button')].find(item => item.textContent.includes('添加模型连接'));
        if (button) { button.click(); return resolve(true); }
        if (Date.now() - started > 8000) return reject(new Error('找不到添加模型连接按钮'));
        setTimeout(find, 100);
      };
      find();
    })`);
    await new Promise(resolve => setTimeout(resolve, 250));

    const results = [];
    for (const [width, height] of VIEWPORTS) {
      await client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
      await evaluate(client, "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
      const metrics = await evaluate(client, layoutExpression());
      assertLayout(metrics);
      if (results.length === 0) assert.equal(metrics.activeId, "ai-provider-preset", "打开抽屉后应聚焦供应商预设");
      const screenshot = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true });
      const screenshotPath = path.join(outputDir, `ai-drawer-${width}x${height}.png`);
      fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
      results.push({ viewport: `${width}x${height}`, headerHeight: Math.round(metrics.header.height), bodyScrollable: metrics.body.scrollHeight > metrics.body.clientHeight, screenshotPath });
    }
    assert.deepEqual(client.consoleErrors, [], `浏览器控制台出现错误：${client.consoleErrors.join(" | ")}`);
    process.stdout.write(`${JSON.stringify({ ok: true, results }, null, 2)}\n`);
  } finally {
    client?.close();
    chrome.kill();
    await new Promise(resolve => setTimeout(resolve, 200));
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
