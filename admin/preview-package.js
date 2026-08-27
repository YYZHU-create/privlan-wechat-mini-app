const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT_RUNTIME_FILES = ["app.js", "app.json", "app.wxss", "project.config.json", "project.private.config.json", "sitemap.json"];
const REQUIRED_ROOT_RUNTIME_FILES = new Set(["app.js", "app.json", "app.wxss", "project.config.json"]);
const RUNTIME_DIRECTORIES = ["pages", "components", "custom-tab-bar", "utils"];
const RUNTIME_TEXT_EXTENSIONS = new Set([".js", ".json", ".wxml", ".wxss", ".wxs", ".sjs"]);
const PREVIEW_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function isDescendantPath(root, candidate) {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function copyFile(sourcePath, targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

function copyRuntimeDirectory(sourceRoot, targetRoot, directoryName) {
  const sourceDirectory = path.join(sourceRoot, directoryName);
  if (!fs.existsSync(sourceDirectory)) return;

  const pending = [sourceDirectory];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const sourcePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(sourcePath);
        continue;
      }
      if (!entry.isFile() || !RUNTIME_TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      copyFile(sourcePath, path.join(targetRoot, path.relative(sourceRoot, sourcePath)));
    }
  }
}

function referencedPreviewAssets(previewRoot) {
  const images = new Set();
  const fonts = new Set();
  const pending = [previewRoot];

  while (pending.length) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name);
      const relative = path.relative(previewRoot, filePath);
      if (["images", "fonts", "cloudfunctions"].includes(relative.split(path.sep)[0])) continue;
      if (entry.isDirectory()) {
        pending.push(filePath);
        continue;
      }
      if (!entry.isFile() || !RUNTIME_TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      const content = fs.readFileSync(filePath, "utf8");
      for (const match of content.matchAll(/\/(images|fonts)\/([A-Za-z0-9._-]+)/g)) {
        if (match[1] === "images") images.add(match[2]);
        else fonts.add(match[2]);
      }
    }
  }

  return { images, fonts };
}

function optimizePreviewJpeg(sourcePath, targetPath, maxEdge, quality) {
  execFileSync("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "preview-image.ps1"),
    sourcePath, targetPath, String(maxEdge), String(quality)
  ], { windowsHide: true, stdio: "pipe" });
}

function copyReferencedAssets({ sourceRoot, previewRoot, directoryName, referenced, optimizeJpeg, imageMaxEdge, imageQuality }) {
  const sourceDirectory = path.join(sourceRoot, directoryName);
  if (!fs.existsSync(sourceDirectory)) return;

  for (const assetName of referenced) {
    const sourcePath = path.resolve(sourceDirectory, assetName);
    if (!isDescendantPath(sourceDirectory, sourcePath) || !fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) continue;

    const sourceSize = fs.statSync(sourcePath).size;
    if (directoryName === "images" && sourceSize > PREVIEW_IMAGE_MAX_BYTES) {
      throw new Error(`素材 /images/${assetName} 体积为 ${formatBytes(sourceSize)}，不适合直接加入小程序包。该素材应迁移至 CDN/COS 后再用于正式发布。`);
    }

    const targetPath = path.join(previewRoot, directoryName, assetName);
    copyFile(sourcePath, targetPath);
    if (directoryName === "images" && [".jpg", ".jpeg"].includes(path.extname(assetName).toLowerCase())) {
      const optimizedPath = `${targetPath}.preview`;
      optimizeJpeg(targetPath, optimizedPath, imageMaxEdge, imageQuality);
      if (fs.existsSync(optimizedPath)) {
        fs.rmSync(targetPath, { force: true });
        fs.renameSync(optimizedPath, targetPath);
      }
    }
  }
}

function listFiles(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(filePath);
      else if (entry.isFile()) files.push(filePath);
    }
  }
  return files;
}

function packageReport(previewRoot, cloudFunctionRelative) {
  const cloudPrefix = cloudFunctionRelative ? `${cloudFunctionRelative}${path.sep}` : null;
  const report = {
    totalBytes: 0,
    mainPackageBytes: 0,
    codeBytes: 0,
    imageBytes: 0,
    fontBytes: 0,
    cloudFunctionBytes: 0,
    otherRuntimeBytes: 0,
    imageBytesByFormat: { jpg: 0, jpeg: 0, png: 0, gif: 0, webp: 0, other: 0 },
    largestRuntimeFiles: []
  };

  for (const filePath of listFiles(previewRoot)) {
    const relative = path.relative(previewRoot, filePath);
    const bytes = fs.statSync(filePath).size;
    const topLevel = relative.split(path.sep)[0];
    const isCloudFunction = cloudPrefix && (relative === cloudFunctionRelative || relative.startsWith(cloudPrefix));
    report.totalBytes += bytes;
    if (isCloudFunction) {
      report.cloudFunctionBytes += bytes;
      continue;
    }
    report.mainPackageBytes += bytes;
    if (topLevel === "images") {
      report.imageBytes += bytes;
      const extension = path.extname(relative).slice(1).toLowerCase();
      const imageFormat = Object.prototype.hasOwnProperty.call(report.imageBytesByFormat, extension) ? extension : "other";
      report.imageBytesByFormat[imageFormat] += bytes;
    } else if (topLevel === "fonts") report.fontBytes += bytes;
    else report.codeBytes += bytes;
    report.largestRuntimeFiles.push({ path: relative.split(path.sep).join("/"), bytes });
  }

  report.otherRuntimeBytes = Math.max(0, report.mainPackageBytes - report.codeBytes - report.imageBytes - report.fontBytes);
  report.largestRuntimeFiles.sort((left, right) => right.bytes - left.bytes || left.path.localeCompare(right.path));
  report.largestRuntimeFiles = report.largestRuntimeFiles.slice(0, 12);
  return report;
}

function configuredCloudFunctionRelative(projectRoot) {
  const configPath = path.join(projectRoot, "project.config.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  if (typeof config.cloudfunctionRoot !== "string" || !config.cloudfunctionRoot.trim()) return null;
  const cloudFunctionPath = path.resolve(projectRoot, config.cloudfunctionRoot);
  if (!isDescendantPath(projectRoot, cloudFunctionPath) || !fs.existsSync(cloudFunctionPath) || !fs.statSync(cloudFunctionPath).isDirectory()) return null;
  return path.relative(projectRoot, cloudFunctionPath);
}

function buildPreviewPackage({ projectRoot, previewRoot, imageMaxEdge = 960, imageQuality = 72, optimizeJpeg = optimizePreviewJpeg }) {
  fs.mkdirSync(previewRoot, { recursive: true });

  for (const fileName of ROOT_RUNTIME_FILES) {
    const sourcePath = path.join(projectRoot, fileName);
    if (!fs.existsSync(sourcePath)) {
      if (REQUIRED_ROOT_RUNTIME_FILES.has(fileName)) throw new Error(`小程序运行时文件缺失：${fileName}`);
      continue;
    }
    copyFile(sourcePath, path.join(previewRoot, fileName));
  }
  for (const directoryName of RUNTIME_DIRECTORIES) copyRuntimeDirectory(projectRoot, previewRoot, directoryName);

  const referenced = referencedPreviewAssets(previewRoot);
  copyReferencedAssets({ sourceRoot: projectRoot, previewRoot, directoryName: "images", referenced: referenced.images, optimizeJpeg, imageMaxEdge, imageQuality });
  copyReferencedAssets({ sourceRoot: projectRoot, previewRoot, directoryName: "fonts", referenced: referenced.fonts, optimizeJpeg, imageMaxEdge, imageQuality });

  const cloudFunctionRelative = configuredCloudFunctionRelative(projectRoot);
  if (cloudFunctionRelative) fs.cpSync(path.join(projectRoot, cloudFunctionRelative), path.join(previewRoot, cloudFunctionRelative), { recursive: true });

  return {
    previewRoot,
    referencedImages: [...referenced.images].sort(),
    referencedFonts: [...referenced.fonts].sort(),
    cloudFunctionRelative,
    report: packageReport(previewRoot, cloudFunctionRelative)
  };
}

module.exports = {
  ROOT_RUNTIME_FILES,
  RUNTIME_DIRECTORIES,
  buildPreviewPackage,
  formatBytes,
  packageReport,
  referencedPreviewAssets
};

