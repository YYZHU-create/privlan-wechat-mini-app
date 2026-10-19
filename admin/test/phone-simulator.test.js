const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.PHONE_SOURCE || path.join(__dirname, '../public');
const app = fs.readFileSync(path.join(base, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(base, 'styles.css'), 'utf8');
test('phone content has its own scroll container before fixed tabbar', () => {
  assert.match(app, /class="mobile-scroll" aria-label="手机页面内容"/);
  assert.ok(app.indexOf('class="mobile-scroll"') < app.indexOf('class="mobile-tabbar"'));
  assert.match(css, /\.phone-canvas.mobile \.mobile-scroll[^}]*overflow-y: auto/);
});
test('mobile screen has fixed 874px logical height and simulated WeChat chrome', () => {
  assert.match(css, /\.phone-canvas.mobile \.mobile-page[^}]*height: 874px/);
  assert.match(app, /class="wechat-capsule" aria-hidden="true"/);
  assert.match(css, /\.phone-canvas.mobile \.mobile-tabbar[^}]*padding-bottom: var\(--phone-bottom-inset\)/);
});
test('tablet and desktop keep their existing document flow', () => {
  assert.match(css, /\.phone-canvas:not\(\.mobile\) \.mobile-scroll \{ display: contents/);
});

test('phone interface reserves simulated system insets and readable navigation', () => {
  assert.match(css, /--phone-status-height: 62px/);
  assert.match(css, /--phone-bottom-inset: 34px/);
  assert.match(css, /height: calc\(100% - var\(--phone-status-height\) - var\(--phone-tab-height\)\)/);
  assert.match(css, /\.phone-canvas.mobile \.mobile-tab \{[^}]*font-size: 10px/);
  assert.match(css, /\.phone-canvas.mobile \.wechat-capsule \{ top: 69px/);
});
