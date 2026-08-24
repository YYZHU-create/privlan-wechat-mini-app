const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const publicDir = path.resolve(__dirname, "../public");
const appSource = fs.readFileSync(path.join(publicDir, "app.js"), "utf8");
const styleSource = fs.readFileSync(path.join(publicDir, "styles.css"), "utf8");

test("editor panel groups pages and navigation with a primary page action", () => {
  assert.match(appSource, /页面与导航/);
  assert.match(appSource, /editor-pages-title/);
  assert.match(appSource, /editor-home-nav-title/);
  assert.match(appSource, /page-primary-action/);
  assert.match(appSource, /管理顶部导航/);
  assert.doesNotMatch(appSource, /首页导航/);
  assert.match(appSource, /design-tabbar-card[^>]*open/);
  const panelSource = appSource.match(/<aside class="side-panel left-panel"[\s\S]*?<div class="section-label block-library-label>/)?.[0] || "";
  assert.doesNotMatch(panelSource, /新建空白页/);
});

test("page and navigation groups are collapsible with aligned controls", () => {
  assert.match(appSource, /<details class="editor-panel-group editor-panel-pages"[^>]*open>/);
  assert.match(appSource, /<details class="editor-panel-group editor-panel-navigation"[^>]*open>/);
  assert.match(appSource, /editor-panel-pages[\s\S]*?<summary class="editor-panel-group-head"/);
  assert.match(styleSource, /\.page-primary-action, \.editor-panel-action\s*\{[^}]*height: 44px/s);
  assert.match(styleSource, /\.page-navigator button\.page-nav-main\s*\{[^}]*width: 100%[^}]*height: 44px/s);
  assert.match(appSource, /'has-actions':page\.custom/);
  assert.match(styleSource, /\.page-nav-entry\s*\{[^}]*width: 100%/s);
  assert.match(styleSource, /\.page-nav-entry \.page-nav-more\s*\{[^}]*position: absolute[^}]*right: 2px/s);
  assert.match(styleSource, /\.editor-panel-group\[open\][^\{]*\{[^}]*rotate\(180deg\)/s);
});

test("bottom navigation keeps the five-item limit and exposes row actions accessibly", () => {
  assert.match(appSource, /cfg\.tabBar\.items\.length>=5/);
  assert.match(appSource, /tabbar-row-menu/);
  assert.match(appSource, /打开导航项操作/);
  assert.match(appSource, /固定字号/);
  assert.match(styleSource, /\.tabbar-row-menu-popover/);
  assert.match(styleSource, /\.tabbar-row-menu-popover button[^\{]*\{[^}]*min-height: 40px/s);
});

test("editor panel layout uses a single-column page list and responsive drawer rules", () => {
  assert.match(styleSource, /\.page-navigator\s*\{[^}]*grid-template-columns: 1fr/s);
  assert.match(styleSource, /\.page-primary-action[^\{]*\{[^}]*min-height: 44px/s);
  assert.match(styleSource, /@media \(max-width: 680px\)/);
  assert.match(styleSource, /\.editor-panel-group-head/);
  assert.match(styleSource, /\.page-nav-entry \.page-nav-more[^\{]*\{[^}]*min-width: 40px/s);
});

test("editor icon-only controls stay centered, tappable and accessibly named", () => {
  assert.match(appSource, /class="section-add-btn"[^>]*aria-label="添加区块"/);
  assert.match(appSource, /class="layer-visibility"[^>]*:aria-label=/);
  assert.match(styleSource, /\.editor-layout \.section-add-btn,[\s\S]*?place-items: center;[\s\S]*?line-height: 0;/);
  assert.match(styleSource, /\.editor-layout \.layer-visibility[^\{]*\{[\s\S]*?width: 40px;[\s\S]*?height: 40px;/);
  assert.match(styleSource, /\.editor-layout \.section-add-btn > \.icon,[\s\S]*?display: block;[\s\S]*?width: 18px;[\s\S]*?height: 18px;/);
});

test("new-page dialog header centers its title, description and close control", () => {
  assert.match(styleSource, /\.new-page-dialog \.drawer-header\s*\{[^}]*align-items: center;[^}]*padding: 0 24px;/s);
  assert.match(styleSource, /\.new-page-dialog \.drawer-header > div\s*\{[^}]*justify-content: center;/s);
  assert.match(styleSource, /\.new-page-dialog \.drawer-header > \.icon-btn\s*\{[^}]*align-self: center;[^}]*margin-top: 0;/s);
});

test("appointment preview reads enabled services from the merchant API", () => {
  assert.match(appSource, /async function loadAppointmentServices\(\)/);
  assert.match(appSource, /apiJson\("\/v1\/appointment-services"\)/);
  assert.match(appSource, /const editorAppointmentServices = ref\(\[\]\)/);
  assert.match(appSource, /editorAppointmentServices\.value = Array\.isArray\(services\) \? services : \[\]/);
  assert.match(appSource, /computed\(\(\) => editorAppointmentServices\.value\.filter/);
  assert.match(appSource, /if \(currentView\.value === "editor"\) await loadAppointmentServices\(\)/);
  assert.match(appSource, /if \(id === "appointment"\) loadAppointmentServices\(\)/);
  assert.match(appSource, /window\.addEventListener\("focus", refreshEditorAppointmentServices\)/);
  assert.match(appSource, /document\.addEventListener\("visibilitychange", refreshEditorAppointmentServices\)/);
  assert.match(appSource, /v-for="service in previewAppointmentServices"/);
  assert.match(appSource, /\{\{ service\.name \}\}/);
  const preview = appSource.match(/section\.type === 'appointment-form'[\s\S]*?section\.type === 'appointment-note'/)?.[0] || "";
  assert.doesNotMatch(preview, /量体与定制咨询|成衣选购咨询/);
});

test("editor distinguishes system and custom pages", () => {
  assert.match(appSource, /page-nav-kind/);
  assert.match(appSource, /page\.custom \? '自定义页' : '系统页'/);
  assert.match(appSource, /v-if="page\.custom" class="page-nav-more"/);
  assert.match(appSource, /\{ id: "appointment", name: "预约到店", path: "\/pages\/appointment\/index"/);
  assert.match(styleSource, /\.page-nav-kind\s*\{/);
});

test("reserved appointment names and duplicate page names are rejected", () => {
  assert.match(appSource, /function validatePageName\(value, currentPageId = ""\)/);
  assert.match(appSource, /normalized === "预约" \|\| normalized === "预约到店"/);
  assert.match(appSource, /系统已提供“预约到店”页面，请直接编辑该页面/);
  assert.match(appSource, /已存在同名页面/);
  assert.match(appSource, /@blur="newPage\.error=validatePageName\(newPage\.name\)"/);
  assert.match(appSource, /@blur="pageEditor\.error=validatePageName\(pageEditor\.name,pageEditor\.id\)"/);
});
