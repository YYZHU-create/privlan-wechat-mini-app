const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(path.resolve(__dirname, "../../admin/node_modules/playwright"));

const loginName = process.env.ATELIER_UAT_LOGIN;
const passwordFile = process.env.ATELIER_UAT_PASSWORD_FILE;
if (!loginName || !passwordFile) throw new Error("Protected UAT login inputs are required");
const password = fs.readFileSync(passwordFile, "utf8").trim();

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 912 } });
    const login = await context.request.post("http://127.0.0.1:40003/auth/login", { data: { login: loginName, password } });
    if (!login.ok()) throw new Error(`Merchant login failed (${login.status()})`);
    const serviceResponse = await context.request.get("http://127.0.0.1:40003/v1/appointment-services");
    if (!serviceResponse.ok()) throw new Error(`Service API failed (${serviceResponse.status()})`);
    const servicePayload = await serviceResponse.json();
    const expected = (servicePayload.data || servicePayload).filter(item => item.enabled !== false).map(item => item.name);

    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const consoleErrors = [];
    const pageErrors = [];
    const networkErrors = [];
    let serviceCalls = 0;
    page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
    page.on("pageerror", error => pageErrors.push(error.message));
    page.on("response", response => { if (response.url().includes("/v1/appointment-services")) serviceCalls += 1; if (response.status() >= 400) networkErrors.push(`${response.status()} ${new URL(response.url()).pathname}`); });
    await page.goto("http://127.0.0.1:40003/?view=editor", { waitUntil: "networkidle" });
    console.log(`API_SERVICES=${expected.length}`);
    await page.locator(".page-nav-entry", { hasText: "预约到店" }).locator(".page-nav-main").click();
    console.log("APPOINTMENT_PAGE=OPEN");
    console.log(`SERVICE_CALLS=${serviceCalls}`);
    await page.locator(".appointment-editor-form").waitFor();
    await page.locator("section.page-section", { has: page.locator(".appointment-editor-form") }).click();
    const serviceToggle = page.getByRole("switch", { name: "显示预约服务" });
    if (await serviceToggle.getAttribute("aria-checked") === "false") await serviceToggle.click();
    await page.waitForTimeout(1000);
    const actual = await page.locator(".appointment-editor-options button").allTextContents();
    const statusText = await page.locator(".appointment-editor-live").allTextContents();
    const namesMatch = JSON.stringify(actual) === JSON.stringify(expected);
    await page.screenshot({ path: path.join(__dirname, "browser-uat", "modified.png"), fullPage: true });
    console.log(`PREVIEW_SERVICES=${actual.length}`);
    console.log(`PREVIEW_STATUS=${JSON.stringify(statusText)}`);
    console.log(`NAMES_MATCH=${namesMatch}`);
    console.log(`CONSOLE_ERRORS=${consoleErrors.length}`);
    console.log(`PAGE_ERRORS=${pageErrors.length}`);
    console.log(`NETWORK_ERRORS=${networkErrors.length}`);
    if (!namesMatch || consoleErrors.length || pageErrors.length || networkErrors.length) process.exitCode = 2;
    await context.close();
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error.message); process.exit(1); });
