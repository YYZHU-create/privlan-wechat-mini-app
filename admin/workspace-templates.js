const fs = require("node:fs");
const path = require("node:path");

const LEGACY_CONFIG_PATH = path.join(__dirname, "config.json");

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function replaceBrand(value, storeName) {
  if (typeof value === "string") {
    return value
      .replaceAll("PRIVLAN 上海会所", `${storeName} 门店`)
      .replaceAll("PRIVLAN 杭州会所", `${storeName} 门店`)
      .replaceAll("PRIVLAN", storeName)
      .replaceAll("LAKE MAGGIORE", "SEASONAL EDIT");
  }
  if (Array.isArray(value)) return value.map(item => replaceBrand(item, storeName));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceBrand(item, storeName)]));
  return value;
}

function createWorkspaceConfig({ storeName, template = "sample", sourceConfig } = {}) {
  const base = clone(sourceConfig || JSON.parse(fs.readFileSync(LEGACY_CONFIG_PATH, "utf8")));
  const config = replaceBrand(base, String(storeName || "新店铺").trim() || "新店铺");
  delete config._lastSync;
  config.brand = { ...(config.brand || {}), name: storeName, subtitle: template === "blank" ? "数字店铺" : (config.brand?.subtitle || "数字店铺") };
  config.serviceBot = { ...(config.serviceBot || {}), authMode: "wechat" };
  const mode = template === "sample" ? "retail" : template;
  config.businessMode = ["retail", "service", "restaurant", "education", "studio", "blank"].includes(mode) ? mode : "retail";
  config.features = { products: config.businessMode === "retail", appointments: ["service", "studio"].includes(config.businessMode), membership: true, ai: true, media: true };
  config.onboarding = { completed: false, skipped: false, step: 1 };
  config.tabBar = normalizeTabBar(config.tabBar, config.businessMode);
  if (template === "blank") {
    config.products = [];
    config.categories = [{ id: "all", name: "全部商品" }];
    config.heroes = [];
    config.homeChannels = [];
    config.campaign = { ...(config.campaign || {}), products: [] };
    config.customPages = [];
  }
  return config;
}

const TEMPLATE_CATALOG = {
  retail: { id: "retail", name: "零售 / 电商", description: "商品、分类、购物车和会员", features: { products: true, appointments: false }, nav: ["首页", "分类", "商品", "购物车", "我的"] },
  service: { id: "service", name: "预约 / 服务", description: "服务、预约、团队和客户联系", features: { products: false, appointments: true }, nav: ["首页", "服务", "预约", "团队", "我的"] },
  restaurant: { id: "restaurant", name: "餐饮", description: "菜单、门店、会员和联系信息", features: { products: true, appointments: false }, nav: ["首页", "菜单", "门店", "会员", "我的"] },
  education: { id: "education", name: "教育 / 课程", description: "课程、老师、报名和个人中心", features: { products: false, appointments: true }, nav: ["首页", "课程", "老师", "报名", "我的"] },
  studio: { id: "studio", name: "工作室 / 展示", description: "作品、服务、团队和联系信息", features: { products: false, appointments: true }, nav: ["首页", "作品", "服务", "联系", "我的"] },
  blank: { id: "blank", name: "空白", description: "从首页和个人中心开始", features: { products: false, appointments: false }, nav: ["首页", "我的"] }
};

function normalizeTabBar(tabBar, mode = "retail") {
  const source = tabBar && typeof tabBar === "object" ? tabBar : {};
  const catalog = TEMPLATE_CATALOG[mode] || TEMPLATE_CATALOG.retail;
  const oldItems = Array.isArray(source.items) ? source.items : [];
  const labels = catalog.nav;
  const items = (oldItems.length ? oldItems : labels.map((label, index) => ({ id: `tab-${index + 1}`, text: label, label, page: index === 0 ? "home" : "custom", icon: "ph:circle" }))).map((item, index) => ({
    id: String(item.id || `tab-${index + 1}`),
    text: String(item.text || item.label || labels[index] || `导航 ${index + 1}`),
    label: String(item.label || item.text || labels[index] || `导航 ${index + 1}`),
    icon: String(item.icon || "ph:circle"),
    iconOn: String(item.iconOn || item.selectedIcon || item.icon || "ph:circle-fill"),
    selectedIcon: String(item.selectedIcon || item.iconOn || item.icon || "ph:circle-fill"),
    page: String(item.page || item.target || (index === 0 ? "home" : "custom")),
    visible: item.visible !== false,
    order: Number.isFinite(Number(item.order)) ? Number(item.order) : index
  })).sort((a, b) => a.order - b.order).slice(0, 5);
  while (items.filter(item => item.visible).length < 2 && items.length < 2) items.push({ id: `tab-${items.length + 1}`, text: labels[items.length] || "我的", label: labels[items.length] || "我的", icon: "ph:circle", iconOn: "ph:circle-fill", selectedIcon: "ph:circle-fill", page: "custom", visible: true, order: items.length });
  const oldFeatured = source.featuredItemId || oldItems.find(item => item.center)?.id || (source.center ? items[2]?.id : null);
  return { schemaVersion: 2, items: items.map((item, index) => ({ ...item, order: index })), featuredItemId: oldFeatured && items.some(item => item.id === oldFeatured && item.visible) ? oldFeatured : null };
}

function listBusinessTemplates() { return Object.values(TEMPLATE_CATALOG).map(item => ({ ...item, nav: [...item.nav], features: { ...item.features } })); }

function applyBusinessTemplate(document, templateId) {
  const template = TEMPLATE_CATALOG[templateId];
  if (!template) throw new Error("模板不存在");
  const next = clone(document || {});
  next.businessMode = template.id;
  next.features = { ...(next.features || {}), ...template.features };
  next.tabBar = normalizeTabBar({ items: template.nav.map((label, index) => ({ id: `tab-${index + 1}`, text: label, label, page: index === 0 ? "home" : "custom", icon: "ph:circle", visible: true })) }, template.id);
  next.onboarding = { ...(next.onboarding || {}), completed: false, skipped: false, step: 2 };
  if (template.id === "blank") { next.heroes = []; next.homeChannels = []; next.customPages = []; }
  return next;
}

module.exports = { createWorkspaceConfig, replaceBrand, normalizeTabBar, listBusinessTemplates, applyBusinessTemplate };
