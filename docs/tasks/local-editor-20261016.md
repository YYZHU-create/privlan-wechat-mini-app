# Local editor with isolated content — 2026-10-16

Launcher: scripts/local-editor.cjs. Run with node scripts/local-editor.cjs.
URL: http://127.0.0.1:63159/?view=editor . Previous 63158 is the read-only UI fixture and remains separate.
Data: %LOCALAPPDATA%/FeelDao/local-editor; seeds repository config/images/fonts/mini-program source once. Existing local edits are retained on subsequent launches.
Uses local development session only, localhost binding, allowlisted child environment, disabled Git autosync. Cloud/database credentials are not inherited. No Production calls or deployment.
Verified: 65 files (64 images,1 video), all bytes SHA256 match repository assets;4 products;3 heroes; config POST/readback matches; original repository config unchanged. Browser editor renders local content. These are repository assets, not a claimed current Production export.
Remaining acceptance: browser upload/delete/selected-media save, generated QR, complete SaaS modules and restart persistence not tested this run. Local subscription state may show inactive; this runtime does not supply a SaaS database.
Evidence: C:/Users/Administrator/.codex/artifacts/local-editor-20261016/VERIFICATION.txt.
Rollback: stop launcher process; retained local data remains intact. Use old 63158 preview if needed. Source change is one new launcher file; no app/server production changes.

## Text inspector visibility — 2026-10-16
Observed live v-model updates while selected heading was above viewport (top -129.5). Added revealSelectedSection, text-field focusin reveal and explicit location button. New browser tab test: heading top -315 -> 138, text updates immediately. Original user tab and unsaved data preserved. Focused tests3/3; baseline and rollback copy fail3 as expected; syntax and diff checks pass. Full app regression not rerun for this focused change.
Evidence: C:/Users/Administrator/.codex/artifacts/editor-text-focus-20261016/VERIFICATION.txt.

## Local generation/QR fix — 2026-10-16
Sync failed ENOENT serviceQuery/store-config.js: launcher now seeds this specific generated configuration dependency. Actual POST /api/sync passes, files51. QR actual provider check requires renewed WeChat developer-tools login (code10); local API now returns409 WECHAT_DEVTOOLS_LOGIN_REQUIRED with actionable redacted message. QR success remains NOT VERIFIED. Tests3/3, syntax/diff pass. Current server restarted with same local data; no browser refresh forced.
Evidence: C:/Users/Administrator/.codex/artifacts/local-preview-fix-20261016/VERIFICATION.txt.

## Inspector controls — 2026-10-16
Measured baseline font weight buttons9px/icons13px; live heading font change worked but heading top=-85.4 offscreen. Expanded reveal behavior to inspector focus/input, added alignment labels/pressed state; scoped readable controls13px, inputs14px, icons18px, buttons40px minimum. Browser verified font24px/weight700/right alignment and heading top138; tests6/6. Temporary test values confined to a new unsaved tab; original user tab retained. Evidence C:/Users/Administrator/.codex/artifacts/inspector-20261016/VERIFICATION.txt and AFTER.png.

## Native block motion — 2026-10-16
Implemented editor block.motion.effect none/fade/rise and speed fast/standard/slow. Standard generated pages include native observer+animate lifecycle, first-visible once per page instance, unload cleanup, visible static fallback; generated tappable view/button/text receive hover feedback. No initial hidden content. Appointment dedicated template remains unchanged. Existing no-motion pages avoid runtime require. Browser menu inspected; new tests3 plus existing generator3 pass. Initial full suite exposed two default-page require compatibility failures, corrected by conditional import when motion enabled; final suite pending recorded artifact. Native WeChat compile and real device visual acceptance NOT VERIFIED (developer-tools login previously required). Editor browser canvas does not play these entrance animations; generated mini-program is target. No config submission, migration or deployment in this task. Evidence: C:/Users/Administrator/.codex/artifacts/motion-20261016/VERIFICATION.txt.
Final full regression:646 tests,642 pass,0 fail,4 skipped; exit0.

## UI layout gate — 2026-10-16
Root cause of vertical hero motion title: new p.field-hint inherited legacy float:right; escaped parent and squeezed next flex title to width0/height97.5. Scoped fix makes block help nonfloating, groups flow-root, titles full width. Found and repaired older768px rule hiding an open inspector. Added default-discovered CSS tests, browser geometry auditor and durable AGENTS UI gate. Actual affected hero motion view at1440/1024/952/768: title327x19.5, geometry PASS. Screenshot each width. Automated contracts are limited checks, not universal visual repair. Browser invocation and screenshot review remain required. Original unsaved user tab untouched; isolated QA tab has refreshed stylesheet.
Evidence C:/Users/Administrator/.codex/artifacts/ui-layout-contract-20261016/VERIFICATION.txt and GEOMETRY.json.
Full regression649 tests:645 pass0 fail4 skipped,exit0. Source contract3/3. Long-label stress not executed in this run; standard hero motion panel verified at four widths.

## Fixed mobile simulator — 2026-10-16
Browser editor mobile mode now has logical390x844 screen inside414px bezel; status bar, simulated WeChat capsule and home indicator; tabbar outside independent mobile-scroll. Tablet/desktop retain document flow. Initial zoom fits window height; page switch resets inner scroll. Browser: content1702/viewport722 scrollTop350; tab/status fixed, category click resets0. Four viewport widths1440/1024/952/768 retain390x844 internal screen. Dedicated tests3/3; full suite pending. This is browser chrome simulation, not native WeChat rendering or device acceptance. Existing user tab and local config preserved. Evidence C:/Users/Administrator/.codex/artifacts/phone-simulator-20261016/VERIFICATION.txt.
Full regression652 tests:648 pass0 fail4 skipped,exit0. PHONE.png captured at952x884 with76% canvas zoom.

## Native detail image/header — 2026-10-16
User true-device screenshot showed duplicate native/custom 商品详情 title and partial image with large blank gallery. Generator inspection: swiper height:auto/aspect-ratio and image missing explicit height. Changed detail to native header only; compute gallery px height from window width minus configured block padding at3:4; image/slide explicit100% height, aspectFit preserves full garment. Tests execute generated onLoad at320/375/390/430 widths; existing generator tests pass. Local service restarted, saved config sync success57files; new QR still required. Native device result NOT VERIFIED; no claim screenshot fixed on-device yet. Evidence C:/Users/Administrator/.codex/artifacts/detail-preview-20261016/VERIFICATION.txt.
Admin suite653:649 pass0 fail4 skipped exit0. Root-level test discovery also ran:8 failures including missing tmp/mbuild fixtures; repository-wide PASS not claimed.

## Product horizontal layout — 2026-10-16
Implemented per-block props.layout grid/horizontal, itemsPerView1/2, showSwipeHint in editor content panel; grid columns hidden for horizontal. Browser strip single-row overflow; native generator scroll-view scroll-x with explicit card/image sizes calculated onLoad/onResize and margin-based gaps, no intrinsic-width grid overflow. Default old layouts remain grid. Only local saved homepage unique早秋新品 block set horizontal2 after local backup; product IDs/category/order preserved. Browser strip360/card175/content730 scrollLeft370 lastVisible true;four-width panel audit PASS after separately settled1440 recheck (initial transitional fail retained in verification). Generator tests3 plus existing3 PASS; full656 tests652pass0fail4skip. Saved local config sync57files; actual native horizontal gesture, tap suppression and device layout still NOT VERIFIED and require new QR. User tab unsaved state not refreshed. Evidence C:/Users/Administrator/.codex/artifacts/product-horizontal-20261016/VERIFICATION.txt.
`nSlide delete control: removed visible text, retained title/aria-label,36px square flex center; browser four widths icon dx0dy0,text empty;no actual deletion. Evidence C:/Users/Administrator/.codex/artifacts/slide-delete-icon-20261016/VERIFICATION.txt.

## iPhone profile — 2026-10-17
Local simulator changed to iPhone18Pro402x874 from390x844; physical1206x2622 converted3x, safeareas remain approximated. Outer426, zoom denominator898. Browser four viewport widths retain402x874; settled1024/952 inner scrolling preserves tabbar. Focused3tests pass; original isolated rollback3pass. Generated native app remains responsive. Evidence C:/Users/Administrator/.codex/artifacts/iphone18-preview-20261017/VERIFICATION.txt. No release performed.

Phone interface follow-up: simulated status62/bottom34/tab83/nav44, channel13/tab10/title17; screen402x874 content729 browser verified. Focused4pass; native generator unchanged. Evidence C:\Users\Administrator\.codex\artifacts\iphone-interface-20261017/VERIFICATION.txt.

Mouse product drag20261017: pointer mouse drag zoom-aware, threshold6,400ms click guard. Removed bubbled lostcapture handler after real mouse movement prematurely stopped. Browser left0->219/right219->0 at73%;no detail ondrag,normalclick detail0004.8focusedtestsPASS. Evidence C:\Users\Administrator\.codex\artifacts\product-mouse-drag-20261017/VERIFICATION.txt. Local only.

Removed AI模板 merchant navigation/page/allowlist and load triggers20261017. Old URL browser showsoverview,AI客服 retained.2testsPASS. Local only. Evidence C:\Users\Administrator\.codex\artifacts\remove-ai-template-20261017/VERIFICATION.txt.

20261019 acceptance work: see docs/tasks/editor-acceptance-20261019.md for HTTP roundtrip, computed geometry and browser CI gate. Existing user config preserved.

20261019 removed toolbar device label span;phone dimensions retained.5focusedtestsPASS;browser labelabsent. Evidence C:\Users\Administrator\.codex\artifacts\remove-device-label-20261019/VERIFICATION.txt.

20261019 desktoppreview fixed1920x1080,csszoom anddevice-switch fit;slider10..110. Browseractual1920x1080 at43%.6testsPASS. Evidence C:\Users\Administrator\.codex\artifacts\desktop-preview-20261019/VERIFICATION.txt.
