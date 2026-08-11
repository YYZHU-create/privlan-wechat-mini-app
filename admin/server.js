/**
 * PRIVLAN 小程序管理面板 — 本地服务端 (WordPress 风格)
 * Express 提供 REST API + 静态文件服务
 */
const express = require("express");
const fs = require("fs");
const path = require("path");
const { execSync, execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const CONFIG_PATH = path.join(__dirname, "config.json");
const IMAGES_DIR = path.join(ROOT, "images");
const FONTS_DIR = path.join(ROOT, "fonts");
const MEDIA_FOLDERS_PATH = path.join(__dirname, "media-folders.json");
const SYSTEM_FONTS_DIR = path.join(process.env.WINDIR || "C:\\Windows", "Fonts");
const PREVIEW_QR_PATH = path.join(path.dirname(ROOT), "preview-qr.png");
const PREVIEW_ROOT_BASE = path.join(path.dirname(ROOT), `${path.basename(ROOT)}-preview`);
const PREVIEW_IMAGE_MAX_EDGE = 960;
const PREVIEW_IMAGE_QUALITY = 72;
const PREVIEW_PACKAGE_MAX_BYTES = 2 * 1024 * 1024;
let previewBuildCount = 0;
fs.mkdirSync(IMAGES_DIR, { recursive: true });
fs.mkdirSync(FONTS_DIR, { recursive: true });

const app = express();
const PORT = Number(process.env.PORT) || 3456;

// 中间件
app.use(express.json({ limit: "100mb" }));
app.use(express.static(path.join(__dirname, "public")));
// 静态服务小程序 images 目录（管理面板内预览图片用）
app.use("/mp-images", express.static(IMAGES_DIR));
app.use("/mp-fonts", express.static(FONTS_DIR));

// ---- 工具函数 ----
function readConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
}
function writeConfig(cfg) {
  const tempPath = `${CONFIG_PATH}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(cfg, null, 2), "utf-8");
  fs.renameSync(tempPath, CONFIG_PATH);
}

function autoSyncGitHub(reason = "editor save") {
  const gitPath = process.env.PRIVLAN_GIT_BIN || "git";
  if (!fs.existsSync(path.join(ROOT, ".git"))) {
    return { ok: false, skipped: true, error: "当前项目未连接 Git 仓库" };
  }
  const runGit = args => execFileSync(gitPath, args, { cwd: ROOT, encoding: "utf8", windowsHide: true, timeout: 120000 });
  try {
    runGit(["add", "-A"]);
    try {
      runGit(["diff", "--cached", "--quiet"]);
      return { ok: true, committed: false, pushed: false };
    } catch (diffError) {
      if (diffError.status !== 1) throw diffError;
    }
    const stamp = new Date().toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
    runGit(["commit", "-m", `chore: sync ${reason} (${stamp})`]);
    runGit(["push", "origin", "HEAD:main"]);
    return { ok: true, committed: true, pushed: true };
  } catch (error) {
    return { ok: false, error: error.stderr?.toString()?.trim() || error.message };
  }
}

function readMediaFolders() {
  try {
    const parsed = JSON.parse(fs.readFileSync(MEDIA_FOLDERS_PATH, "utf-8"));
    return { folders: Array.isArray(parsed.folders) ? parsed.folders : [], assignments: parsed.assignments && typeof parsed.assignments === "object" ? parsed.assignments : {} };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { folders: [], assignments: {} };
  }
}

function writeMediaFolders(data) {
  const tempPath = `${MEDIA_FOLDERS_PATH}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tempPath, MEDIA_FOLDERS_PATH);
}

function normalizeMediaFolderId(value) {
  return String(value || "").trim().replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80);
}

function findWechatDevtoolsCli() {
  const candidates = [
    process.env.WECHAT_DEVTOOLS_CLI,
    "E:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.bat",
    "C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.bat",
    "C:\\Program Files\\Tencent\\微信web开发者工具\\cli.bat"
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate));
}
function listSystemFonts() {
  if (process.platform !== "win32") return [];
  const output = execFileSync("reg.exe", ["query", "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts"], { encoding: "utf8", windowsHide: true });
  const seen = new Set();
  return output.split(/\r?\n/).map(line => {
    const match = line.match(/^\s{2,}(.+?)\s+REG_\w+\s+(.+?)\s*$/);
    if (!match) return null;
    const name = match[1].replace(/\s*\((TrueType|OpenType|All res)\)\s*$/i, "").trim();
    const file = path.basename(match[2].trim());
    const filePath = path.join(SYSTEM_FONTS_DIR, file);
    const key = `${name}|${file}`.toLowerCase();
    if (!name || seen.has(key) || !fs.existsSync(filePath)) return null;
    seen.add(key);
    const stat = fs.statSync(filePath);
    return { name, file, format: path.extname(file).slice(1).toLowerCase(), sizeKB: Math.round(stat.size / 1024) };
  }).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

function optimizePreviewJpeg(sourcePath, targetPath) {
  execFileSync("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "preview-image.ps1"),
    sourcePath, targetPath, String(PREVIEW_IMAGE_MAX_EDGE), String(PREVIEW_IMAGE_QUALITY)
  ], { windowsHide: true, stdio: "pipe" });
}

function referencedPreviewImages(projectRoot) {
  const references = new Set();
  const supportedTextFiles = new Set([".js", ".json", ".wxml", ".wxss"]);
  const pending = [projectRoot];

  while (pending.length) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name);
      const relative = path.relative(projectRoot, filePath);
      if (relative === "images" || relative.startsWith(`images${path.sep}`)) continue;
      if (entry.isDirectory()) {
        pending.push(filePath);
        continue;
      }
      if (!entry.isFile() || !supportedTextFiles.has(path.extname(entry.name).toLowerCase())) continue;
      const content = fs.readFileSync(filePath, "utf8");
      for (const match of content.matchAll(/\/images\/([A-Za-z0-9._-]+)/g)) references.add(match[1]);
    }
  }
  return references;
}

function prunePreviewImages(previewRoot) {
  const previewImagesDir = path.join(previewRoot, "images");
  if (!fs.existsSync(previewImagesDir)) return;
  const referenced = referencedPreviewImages(previewRoot);
  for (const entry of fs.readdirSync(previewImagesDir, { withFileTypes: true })) {
    if (entry.isFile() && !referenced.has(entry.name)) fs.rmSync(path.join(previewImagesDir, entry.name), { force: true });
  }
}

function directorySize(directory) {
  let total = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) total += directorySize(filePath);
    else if (entry.isFile()) total += fs.statSync(filePath).size;
  }
  return total;
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function buildPreviewProject() {
  previewBuildCount += 1;
  const previewRoot = `${PREVIEW_ROOT_BASE}-${Date.now()}-${process.pid}-${previewBuildCount}`;
  fs.cpSync(ROOT, previewRoot, {
    recursive: true,
    filter(source) {
      const relative = path.relative(ROOT, source);
      return relative !== "admin" && !relative.startsWith(`admin${path.sep}`) && relative !== ".git" && !relative.startsWith(`.git${path.sep}`);
    }
  });

  const previewImagesDir = path.join(previewRoot, "images");
  prunePreviewImages(previewRoot);
  if (fs.existsSync(previewImagesDir)) {
    for (const entry of fs.readdirSync(previewImagesDir)) {
      const imagePath = path.join(previewImagesDir, entry);
      const ext = path.extname(entry).toLowerCase();
      if (fs.statSync(imagePath).isFile() && [".jpg", ".jpeg"].includes(ext)) {
        const optimizedPath = `${imagePath}.preview`;
        optimizePreviewJpeg(imagePath, optimizedPath);
        if (fs.existsSync(optimizedPath)) {
          fs.rmSync(imagePath, { force: true });
          fs.renameSync(optimizedPath, imagePath);
        }
      }
    }
  }
  return previewRoot;
}

function migrateCenterTabCrop(cfg) {
  const items = cfg?.tabBar?.items;
  const index = Array.isArray(items) ? items.findIndex(item => item?.center) : -1;
  const item = items?.[index];
  if (!item?.centerIconSource || !/\.webp$/i.test(item.centerIcon || "")) return;

  const sourceName = path.basename(item.centerIconSource);
  const sourcePath = path.join(IMAGES_DIR, sourceName);
  if (!fs.existsSync(sourcePath)) return;

  const crop = item.centerIconCrop || {};
  const targetName = `tab-${index + 1}-centerIcon-crop-${Date.now()}.jpg`;
  const targetPath = path.join(IMAGES_DIR, targetName);
  execFileSync("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "tabbar-center-crop.ps1"),
    "-Source", sourcePath, "-Target", targetPath, "-Zoom", String(crop.zoom ?? 1),
    "-OffsetX", String(crop.offsetX ?? 0), "-OffsetY", String(crop.offsetY ?? 0)
  ], { windowsHide: true, stdio: "pipe" });
  item.centerIcon = `/images/${targetName}`;
}

// ---- Dashboard API ----
app.get("/api/dashboard", (req, res) => {
  try {
    const cfg = readConfig();
    let imageCount = 0;
    let totalImageSize = 0;
    try {
      const files = fs.readdirSync(IMAGES_DIR);
      for (const f of files) {
        const ext = path.extname(f).toLowerCase();
        if ([".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext)) {
          imageCount++;
          totalImageSize += fs.statSync(path.join(IMAGES_DIR, f)).size;
        }
      }
    } catch (e) {}
    res.json({
      productCount: cfg.products.length,
      categoryCount: cfg.categories.length,
      heroCount: cfg.heroes.length,
      imageCount,
      imageTotalKB: Math.round(totalImageSize / 1024),
      brandName: cfg.brand.name,
      themePreset: cfg.theme.preset,
      lastSync: cfg._lastSync || null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Config API ----
app.get("/api/config", (req, res) => {
  try { res.json(readConfig()); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/api/config", (req, res) => {
  try {
    writeConfig(req.body);
    res.json({ ok: true, git: autoSyncGitHub("editor save") });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Media Library API ----
app.get("/api/media/folders", (req, res) => {
  try {
    const data = readMediaFolders();
    const counts = Object.entries(data.assignments).reduce((result, [name, folderId]) => {
      if (fs.existsSync(path.join(IMAGES_DIR, name))) result[folderId] = (result[folderId] || 0) + 1;
      return result;
    }, {});
    res.json(data.folders.map(folder => ({ ...folder, count: counts[folder.id] || 0 })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/media/folders", (req, res) => {
  try {
    const name = String(req.body?.name || "").trim().replace(/\s+/g, " ").slice(0, 40);
    if (!name) return res.status(400).json({ error: "请输入文件夹名称" });
    const data = readMediaFolders();
    if (data.folders.some(folder => folder.name.toLowerCase() === name.toLowerCase())) return res.status(409).json({ error: "文件夹名称已存在" });
    const baseId = normalizeMediaFolderId(`folder-${Date.now().toString(36)}`) || `folder-${Date.now()}`;
    let id = baseId;
    let counter = 1;
    while (data.folders.some(folder => folder.id === id)) id = `${baseId}-${counter++}`;
    const folder = { id, name, createdAt: new Date().toISOString() };
    data.folders.push(folder);
    writeMediaFolders(data);
    res.json({ ok: true, folder: { ...folder, count: 0 } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch("/api/media/folders/:id", (req, res) => {
  try {
    const data = readMediaFolders();
    const folder = data.folders.find(item => item.id === req.params.id);
    if (!folder) return res.status(404).json({ error: "文件夹不存在" });
    const name = String(req.body?.name || "").trim().replace(/\s+/g, " ").slice(0, 40);
    if (!name) return res.status(400).json({ error: "请输入文件夹名称" });
    if (data.folders.some(item => item.id !== folder.id && item.name.toLowerCase() === name.toLowerCase())) return res.status(409).json({ error: "文件夹名称已存在" });
    folder.name = name;
    writeMediaFolders(data);
    res.json({ ok: true, folder });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/media/folders/:id", (req, res) => {
  try {
    const data = readMediaFolders();
    const index = data.folders.findIndex(item => item.id === req.params.id);
    if (index < 0) return res.status(404).json({ error: "文件夹不存在" });
    const assigned = Object.values(data.assignments).filter(folderId => folderId === req.params.id).length;
    if (assigned) return res.status(409).json({ error: `文件夹内还有 ${assigned} 个素材，请先移动素材` });
    data.folders.splice(index, 1);
    writeMediaFolders(data);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/media", (req, res) => {
  try {
    const folderData = readMediaFolders();
    const folderMap = new Map(folderData.folders.map(folder => [folder.id, folder]));
    const files = fs.readdirSync(IMAGES_DIR).filter(f => {
      const ext = path.extname(f).toLowerCase();
      return [".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".webm", ".mov"].includes(ext);
    }).map(f => {
      const stat = fs.statSync(path.join(IMAGES_DIR, f));
      const ext = path.extname(f).toLowerCase();
      const kind = [".mp4", ".webm", ".mov"].includes(ext) ? "video" : "image";
      return {
        name: f,
        path: `/mp-images/${f}`,
        mpPath: `/images/${f}`,
        kind,
        size: stat.size,
        sizeKB: Math.round(stat.size / 1024),
        mtime: stat.mtime.toISOString(),
        folderId: folderMap.has(folderData.assignments[f]) ? folderData.assignments[f] : "",
        folderName: folderMap.get(folderData.assignments[f])?.name || "",
      };
    }).sort((a, b) => b.mtime.localeCompare(a.mtime));
    res.json(files);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/media/upload", (req, res) => {
  try {
    const { name, data } = req.body;
    const requestedFolderId = String(req.body?.folderId || "");
    const folderData = readMediaFolders();
    if (requestedFolderId && !folderData.folders.some(folder => folder.id === requestedFolderId)) return res.status(400).json({ error: "目标文件夹不存在" });
    if (!name || !data) return res.status(400).json({ error: "缺少 name 或 data" });
    const ext = path.extname(name).toLowerCase();
    const allowed = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".webm", ".mov"];
    if (!allowed.includes(ext)) return res.status(400).json({ error: "仅支持图片或 MP4/WebM/MOV 视频" });
    const base64 = data.replace(/^data:[^;]+;base64,/, "");
    const buf = Buffer.from(base64, "base64");
    if (buf.length > 80 * 1024 * 1024) return res.status(400).json({ error: "单个媒体文件不能超过 80MB" });
    // 防止覆盖：同名加后缀
    const safeName = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, "-");
    if (!safeName) return res.status(400).json({ error: "文件名无效" });
    let destName = safeName;
    let counter = 1;
    while (fs.existsSync(path.join(IMAGES_DIR, destName))) {
      const ext = path.extname(safeName);
      const base = path.basename(safeName, ext);
      destName = `${base}-${counter}${ext}`;
      counter++;
    }
    fs.writeFileSync(path.join(IMAGES_DIR, destName), buf);
    if (requestedFolderId) {
      folderData.assignments[destName] = requestedFolderId;
      writeMediaFolders(folderData);
    }
    const kind = [".mp4", ".webm", ".mov"].includes(path.extname(destName).toLowerCase()) ? "video" : "image";
    const folder = folderData.folders.find(item => item.id === requestedFolderId);
    res.json({ ok: true, name: destName, path: `/mp-images/${destName}`, mpPath: `/images/${destName}`, kind, size: buf.length, sizeKB: Math.round(buf.length / 1024), folderId: requestedFolderId, folderName: folder?.name || "" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/media/move", (req, res) => {
  try {
    const names = [...new Set(Array.isArray(req.body?.names) ? req.body.names : [])].slice(0, 500);
    const folderId = String(req.body?.folderId || "");
    const data = readMediaFolders();
    if (folderId && !data.folders.some(folder => folder.id === folderId)) return res.status(400).json({ error: "目标文件夹不存在" });
    if (!names.length) return res.status(400).json({ error: "请选择要移动的素材" });
    for (const name of names) {
      const safeName = path.basename(String(name || ""));
      if (!safeName || safeName !== name) return res.status(400).json({ error: `文件名无效：${name}` });
      if (!fs.existsSync(path.join(IMAGES_DIR, safeName))) continue;
      if (folderId) data.assignments[safeName] = folderId;
      else delete data.assignments[safeName];
    }
    writeMediaFolders(data);
    res.json({ ok: true, moved: names.length, folderId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/media/delete", (req, res) => {
  try {
    const names = [...new Set(Array.isArray(req.body?.names) ? req.body.names : [])].slice(0, 500);
    if (!names.length) return res.status(400).json({ error: "请选择要删除的素材" });
    const deleted = [];
    const missing = [];
    for (const name of names) {
      const safeName = path.basename(String(name || ""));
      if (!safeName || safeName !== name) return res.status(400).json({ error: `文件名无效：${name}` });
      const filePath = path.join(IMAGES_DIR, safeName);
      if (!fs.existsSync(filePath)) { missing.push(safeName); continue; }
      fs.unlinkSync(filePath);
      deleted.push(safeName);
    }
    const folderData = readMediaFolders();
    deleted.forEach(name => delete folderData.assignments[name]);
    writeMediaFolders(folderData);
    res.json({ ok: true, deleted, missing });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Custom Fonts API ----
app.get("/api/fonts", (req, res) => {
  try {
    const files = fs.readdirSync(FONTS_DIR).filter(f => [".woff2", ".woff", ".ttf", ".otf", ".ttc"].includes(path.extname(f).toLowerCase()));
    res.json(files.map(name => {
      const stat = fs.statSync(path.join(FONTS_DIR, name));
      return { name, path: `/mp-fonts/${name}`, mpPath: `/fonts/${name}`, sizeKB: Math.round(stat.size / 1024) };
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/fonts/upload", (req, res) => {
  try {
    const { name, data } = req.body;
    if (!name || !data) return res.status(400).json({ error: "缺少字体文件" });
    const ext = path.extname(name).toLowerCase();
    if (![".woff2", ".woff", ".ttf", ".otf", ".ttc"].includes(ext)) return res.status(400).json({ error: "仅支持 WOFF2、WOFF、TTF、OTF、TTC" });
    const safeName = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, "-");
    const buf = Buffer.from(data.replace(/^data:[^;]+;base64,/, ""), "base64");
    if (buf.length > 8 * 1024 * 1024) return res.status(400).json({ error: "字体文件不能超过 8MB" });
    let destName = safeName;
    let counter = 1;
    while (fs.existsSync(path.join(FONTS_DIR, destName))) {
      destName = `${path.basename(safeName, ext)}-${counter}${ext}`;
      counter++;
    }
    fs.writeFileSync(path.join(FONTS_DIR, destName), buf);
    res.json({ ok: true, name: destName, path: `/mp-fonts/${destName}`, mpPath: `/fonts/${destName}`, sizeKB: Math.round(buf.length / 1024) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/system-fonts", (req, res) => {
  try { res.json(listSystemFonts()); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/fonts/import-system", (req, res) => {
  try {
    const { name, file } = req.body || {};
    const available = listSystemFonts();
    const source = available.find(font => font.name === name && font.file === file);
    if (!source) return res.status(404).json({ error: "未找到该电脑字体" });
    const sourcePath = path.join(SYSTEM_FONTS_DIR, source.file);
    if (fs.statSync(sourcePath).size > 8 * 1024 * 1024) return res.status(400).json({ error: "该字体超过 8MB，请先转换为 WOFF2 再上传，避免小程序包体过大" });
    const ext = path.extname(source.file).toLowerCase();
    const safeBase = String(name).normalize("NFKD").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "system-font";
    let destName = `${safeBase}${ext}`;
    let counter = 1;
    while (fs.existsSync(path.join(FONTS_DIR, destName))) {
      const existing = fs.statSync(path.join(FONTS_DIR, destName));
      const original = fs.statSync(sourcePath);
      if (existing.size === original.size) break;
      destName = `${safeBase}-${counter}${ext}`;
      counter++;
    }
    if (!fs.existsSync(path.join(FONTS_DIR, destName))) fs.copyFileSync(sourcePath, path.join(FONTS_DIR, destName));
    const stat = fs.statSync(path.join(FONTS_DIR, destName));
    res.json({ ok: true, name: destName, mpPath: `/fonts/${destName}`, path: `/mp-fonts/${destName}`, format: source.format, sizeKB: Math.round(stat.size / 1024) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/media/:name", (req, res) => {
  try {
    const safeName = path.basename(req.params.name);
    if (safeName !== req.params.name) return res.status(400).json({ error: "文件名无效" });
    const filePath = path.join(IMAGES_DIR, safeName);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      const folderData = readMediaFolders();
      delete folderData.assignments[safeName];
      writeMediaFolders(folderData);
      res.json({ ok: true });
    } else {
      res.status(404).json({ error: "文件不存在" });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Presets API ----
app.get("/api/presets", (req, res) => {
  try { res.json(readConfig().themePresets || {}); } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Sync API ----
app.post("/api/sync", (req, res) => {
  try {
    const sync = require("./sync");
    let cfg;
    if (req.body && Object.keys(req.body).length > 0) {
      writeConfig(req.body);
      cfg = req.body;
    } else {
      cfg = readConfig();
    }
    migrateCenterTabCrop(cfg);
    const result = sync(cfg, ROOT);
    cfg._lastSync = new Date().toISOString();
    writeConfig(cfg);
    res.json({ ok: true, ...result, lastSync: cfg._lastSync, git: autoSyncGitHub("mini program sync") });
  } catch (e) { res.status(500).json({ error: e.message, stack: e.stack });
  }
});

// ---- Preview API ----
app.post("/api/preview", (req, res) => {
  try {
    const cliPath = findWechatDevtoolsCli();
    if (!cliPath) {
      return res.status(503).json({
        error: "未找到微信开发者工具命令行。请安装微信开发者工具，或设置 WECHAT_DEVTOOLS_CLI 指向 cli.bat。"
      });
    }
    const cliDir = path.dirname(cliPath);
    const previewProject = buildPreviewProject();
    const previewPackageSize = directorySize(previewProject);
    if (previewPackageSize > PREVIEW_PACKAGE_MAX_BYTES) {
      const error = new Error(`预览包体积为 ${formatBytes(previewPackageSize)}，超过微信开发版二维码的 2 MB 限制。请压缩或移除未使用的图片、GIF 和字体后重试。`);
      error.details = `previewProject=${previewProject}`;
      throw error;
    }
    const tempQrPath = path.join(path.dirname(PREVIEW_QR_PATH), `preview-qr-${Date.now()}-${process.pid}.png`);
    const cmd = `cd /d "${cliDir}" && set NODE_OPTIONS= && "${cliPath}" preview --project "${previewProject}" --port 9420 -f image -o "${tempQrPath}" 2>&1`;
    const output = execSync(cmd, { timeout: 120000, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (!fs.existsSync(tempQrPath)) {
      const error = new Error(output.trim() || "微信开发者工具未生成新的预览二维码，请先修复小程序编译错误。");
      error.details = output.trim();
      throw error;
    }
    fs.rmSync(PREVIEW_QR_PATH, { force: true });
    fs.renameSync(tempQrPath, PREVIEW_QR_PATH);
    if (!fs.existsSync(PREVIEW_QR_PATH)) throw new Error("微信开发者工具没有生成预览二维码");
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, qrUrl: `/api/preview/qr?v=${Date.now()}` });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message, details: e.details || "", stderr: e.stderr ? e.stderr.toString() : "" });
  }
});

app.get("/api/preview/qr", (req, res) => {
  if (!fs.existsSync(PREVIEW_QR_PATH)) return res.status(404).json({ error: "尚未生成预览二维码" });
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.sendFile(PREVIEW_QR_PATH);
});

const server = app.listen(PORT, () => {
  console.log(`\n  PRIVLAN Admin Panel (WordPress-style)`);
  console.log(`  ──────────────────────────────────────`);
  console.log(`  Running at  http://localhost:${PORT}`);
  console.log(`  Project    ${ROOT}`);
  console.log(`  ──────────────────────────────────────\n`);
});

module.exports = { app, server };
