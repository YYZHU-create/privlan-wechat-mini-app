const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { buildPreviewPackage } = require("../preview-package");

function write(root, relative, content) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

test("preview package copies only runtime files and referenced assets", () => {
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-preview-source-"));
  const previewRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-preview-output-"));
  try {
    write(sourceRoot, "app.js", 'const hero = "/images/used.jpg";');
    write(sourceRoot, "app.json", JSON.stringify({ pages: ["pages/appointment/index", "pages/service-chat/index"] }));
    write(sourceRoot, "app.wxss", '@font-face { src: url("/fonts/used.ttf"); }');
    write(sourceRoot, "project.config.json", JSON.stringify({ cloudfunctionRoot: "cloudfunctions/" }));
    write(sourceRoot, "sitemap.json", "{}");
    write(sourceRoot, "pages/appointment/index.js", 'const banner = "/images/used.jpg";');
    write(sourceRoot, "pages/service-chat/index.wxml", "<view>chat</view>");
    write(sourceRoot, "components/service-fab/index.js", "module.exports = {};");
    write(sourceRoot, "custom-tab-bar/index.js", "module.exports = {};");
    write(sourceRoot, "utils/runtime.js", "module.exports = {};");
    write(sourceRoot, "utils/generator.py", "print('not runtime')");
    write(sourceRoot, "images/used.jpg", "used-image-bytes");
    write(sourceRoot, "images/unreferenced.png", "unused-image-bytes");
    write(sourceRoot, "fonts/used.ttf", "used-font-bytes");
    write(sourceRoot, "fonts/unreferenced.ttf", "unused-font-bytes");
    write(sourceRoot, "cloudfunctions/appointment/index.js", "exports.main = async () => ({});");
    write(sourceRoot, "verification/screenshot.png", "artifact");
    write(sourceRoot, "docs/notes.md", "artifact");
    write(sourceRoot, "admin/server.js", "artifact");

    const sourceImageHash = sha256(path.join(sourceRoot, "images/used.jpg"));
    const sourceFontHash = sha256(path.join(sourceRoot, "fonts/used.ttf"));
    const result = buildPreviewPackage({
      projectRoot: sourceRoot,
      previewRoot,
      optimizeJpeg(sourcePath, targetPath) { fs.copyFileSync(sourcePath, targetPath); }
    });

    assert.equal(fs.existsSync(path.join(previewRoot, "pages/appointment/index.js")), true);
    assert.equal(fs.existsSync(path.join(previewRoot, "pages/service-chat/index.wxml")), true);
    assert.equal(fs.existsSync(path.join(previewRoot, "images/used.jpg")), true);
    assert.equal(fs.existsSync(path.join(previewRoot, "fonts/used.ttf")), true);
    assert.equal(fs.existsSync(path.join(previewRoot, "cloudfunctions/appointment/index.js")), true);
    assert.equal(fs.existsSync(path.join(previewRoot, "images/unreferenced.png")), false);
    assert.equal(fs.existsSync(path.join(previewRoot, "fonts/unreferenced.ttf")), false);
    assert.equal(fs.existsSync(path.join(previewRoot, "utils/generator.py")), false);
    assert.equal(fs.existsSync(path.join(previewRoot, "verification/screenshot.png")), false);
    assert.equal(fs.existsSync(path.join(previewRoot, "docs/notes.md")), false);
    assert.equal(fs.existsSync(path.join(previewRoot, "admin/server.js")), false);
    assert.equal(result.report.totalBytes, result.report.mainPackageBytes + result.report.cloudFunctionBytes);
    assert.ok(result.report.cloudFunctionBytes > 0);
    assert.deepEqual(result.referencedImages, ["used.jpg"]);
    assert.deepEqual(result.referencedFonts, ["used.ttf"]);
    assert.ok(result.report.imageBytesByFormat.jpg > 0);
    assert.equal(result.report.imageBytesByFormat.gif, 0);
    assert.equal(sha256(path.join(sourceRoot, "images/used.jpg")), sourceImageHash);
    assert.equal(sha256(path.join(sourceRoot, "fonts/used.ttf")), sourceFontHash);
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(previewRoot, { recursive: true, force: true });
  }
});

