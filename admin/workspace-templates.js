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

module.exports = { createWorkspaceConfig, replaceBrand };
