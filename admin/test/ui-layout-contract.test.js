const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const css = fs.readFileSync(process.env.LAYOUT_CSS || path.join(__dirname, '../public/styles.css'), 'utf8');
test('inspector block help cancels inherited float', () => {
  assert.match(css, /\.editor-mode \.side-panel.right p.field-hint\s*\{[^}]*float:\s*none/);
});
test('inspector groups contain floats and titles retain full width', () => {
  assert.match(css, /\.editor-mode \.side-panel.right \.field-group\s*\{[^}]*display:\s*flow-root/);
  assert.match(css, /\.field-group > \.field-title\s*\{[^}]*width:\s*100%/);
});
test('layout auditor reports missing panel rather than a false pass', () => {
  const { auditInspectorLayout } = require('../qa/inspector-layout-audit');
  assert.equal(auditInspectorLayout({ querySelector: () => null }).status, 'NOT_VERIFIED');
});
