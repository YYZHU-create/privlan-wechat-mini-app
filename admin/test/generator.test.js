const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "../..");
const sync = require("../sync");

function copyFixture() {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "privlan-generator-"));
  for (const name of ["app.json", "pages", "components", "utils", "custom-tab-bar"]) {
    fs.cpSync(path.join(ROOT, name), path.join(target, name), { recursive: true });
  }
  fs.mkdirSync(path.join(target, "cloudfunctions", "serviceQuery"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "cloudfunctions", "serviceQuery", "store-config.js"), path.join(target, "cloudfunctions", "serviceQuery", "store-config.js"));
  return target;
}

function loadPage(file, requireMap = {}) {
  let definition;
  const sandbox = {
    Page(value) { definition = value; },
    require(specifier) {
      if (Object.prototype.hasOwnProperty.call(requireMap, specifier)) return requireMap[specifier];
      throw new Error(`Unexpected require: ${specifier}`);
    },
    wx: {
      getWindowInfo: () => ({ statusBarHeight: 20 }),
      getSystemInfoSync: () => ({ statusBarHeight: 20 }),
      getMenuButtonBoundingClientRect: () => ({ top: 20 }),
      showToast() {}, switchTab() {}, reLaunch() {}, navigateTo() {}, navigateBack() {}
    },
    Set, encodeURIComponent, decodeURIComponent, console
  };
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
  definition.data = structuredClone(definition.data);
  definition.setData = patch => Object.assign(definition.data, patch);
  return { page: definition, wx: sandbox.wx };
}

function generatedJsFiles(root) {
  const result = [];
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.isFile() && entry.name.endsWith(".js")) result.push(file);
  });
  walk(root);
  return result;
}

test("generated detail and category pages honor dynamic route parameters", () => {
  const target = copyFixture();
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "admin", "config.json"), "utf8"));
    cfg.pageLayouts.detail[0].props.productId = 4;
    sync(cfg, target);

    const added = [];
    const cart = { read: () => [], summary: () => ({ quantity: 0, price: 0 }), add: item => added.push(item), changeQuantity() {} };
    const detail = loadPage(path.join(target, "pages", "detail", "detail.js"), { "../../utils/cart": cart }).page;
    detail.onLoad({ id: "3" });
    assert.equal(String(detail.data.block0.id), "3");
    assert.equal(detail.data.productMissing, false);
    assert.equal(detail.onShareAppMessage().path, "/pages/detail/detail?id=3");
    detail.addCart();
    assert.equal(String(added[0].id), "3");

    detail.onLoad({});
    assert.equal(String(detail.data.block0.id), "4");
    detail.onLoad({ id: "missing" });
    assert.equal(detail.data.productMissing, true);
    assert.equal(detail.data.block0.id, "");

    const category = loadPage(path.join(target, "pages", "category", "category.js")).page;
    category.onLoad({ cat: "tops" });
    assert.equal(category.data.activeCategory, "tops");
    assert.ok(category.data.visibleProducts.length > 0);
    assert.ok(category.data.visibleProducts.every(item => item.cat === "tops"));
    category.selectCategory({ currentTarget: { dataset: { category: "all" } } });
    assert.equal(category.data.visibleProducts.length, category.data.allProducts.length);
    category.onLoad({ cat: "does-not-exist" });
    assert.equal(category.data.activeCategory, "all");
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test("generator registers webview, gates cart methods and keeps handlers complete", () => {
  const target = copyFixture();
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "admin", "config.json"), "utf8"));
    sync(cfg, target, { publicStoreId: "store_public_generator_test" });
    const app = JSON.parse(fs.readFileSync(path.join(target, "app.json"), "utf8"));
    const appointmentRuntime = fs.readFileSync(path.join(target, "utils", "appointment-runtime.js"), "utf8");
    assert.match(appointmentRuntime, /store_public_generator_test/);
    assert.doesNotMatch(appointmentRuntime, /TOKEN|SECRET|gateway/i);
    assert.ok(app.pages.includes("pages/webview/webview"));
    for (const route of app.pages) {
      const base = path.join(target, route);
      for (const extension of [".js", ".json", ".wxml", ".wxss"]) assert.ok(fs.existsSync(base + extension), `${route}${extension}`);
    }

    const mineSource = fs.readFileSync(path.join(target, "pages", "mine", "mine.js"), "utf8");
    assert.doesNotMatch(mineSource, /utils\/cart|addCart\s*\(|buyNow\s*\(/);
    for (const file of generatedJsFiles(path.join(target, "pages"))) {
      const checked = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
      assert.equal(checked.status, 0, checked.stderr || file);
      const wxml = file.replace(/\.js$/, ".wxml");
      if (!fs.existsSync(wxml) || file.includes(`${path.sep}components${path.sep}`)) continue;
      const handlers = [...fs.readFileSync(wxml, "utf8").matchAll(/(?:bind|catch)(?:tap|load|error|input|change|submit|touchstart|touchmove|touchend)="([A-Za-z_$][\w$]*)"/g)].map(match => match[1]);
      if (!handlers.length) continue;
      const page = loadPage(file, {
        "../../utils/cart": { read: () => [], summary: () => ({}), add() {}, changeQuantity() {} },
        "../../utils/mock": { categories: [], products: [], heroes: [], memberBenefits: [] },
        "../../utils/service-api": {},
        "../../utils/appointment-config": { fields: {} },
        "../../utils/appointment-runtime": { publicStoreId: "store_public_generator_test" },
        "../../utils/service-config": {}
      }).page;
      for (const handler of handlers) assert.equal(typeof page[handler], "function", `${path.relative(target, file)} missing ${handler}`);
    }

    const webview = loadPage(path.join(target, "pages", "webview", "webview.js")).page;
    webview.onLoad({ url: encodeURIComponent("https://example.com/path") });
    assert.equal(webview.data.url, "https://example.com/path");
    webview.onLoad({ url: encodeURIComponent("javascript:alert(1)") });
    assert.match(webview.data.error, /HTTPS/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test("custom page registration is removed cleanly on the next sync", () => {
  const target = copyFixture();
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "admin", "config.json"), "utf8"));
    cfg.customPages = [{ id: "custom-verification", name: "Verification" }];
    cfg.pageLayouts["custom-verification"] = [{ id: "text-test", type: "text", enabled: true, props: { title: "Test", text: "Body" }, style: {} }];
    sync(cfg, target);
    const route = "pages/custom-verification/custom-verification";
    assert.ok(JSON.parse(fs.readFileSync(path.join(target, "app.json"), "utf8")).pages.includes(route));
    assert.ok(fs.existsSync(path.join(target, "pages", "custom-verification")));
    cfg.customPages = [];
    delete cfg.pageLayouts["custom-verification"];
    sync(cfg, target);
    assert.ok(!JSON.parse(fs.readFileSync(path.join(target, "app.json"), "utf8")).pages.includes(route));
    assert.ok(!fs.existsSync(path.join(target, "pages", "custom-verification")));
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
