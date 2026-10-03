# Operator shell flexible-row layout — 2026-10-04

Scope: fix the unused third grid row when the optional banner is absent. The body explicitly occupies row 3, allowing the empty banner row to collapse and the body to fill available height. Fixed-position notices retain their existing behavior.

Acceptance: browser geometry at 1122x884, 1440x1000 and 390x844, with/without banner; body bottom equals shell bottom and body starts below header/banner. All six modified cases pass. Baseline and isolated rollback reproduce gaps 192/308/140 px without banner. Five operator UI tests pass; no runtime/API/database changes.

Source and tests are synchronized to the task branch; live Production is not changed by this source-only task. Deployment remains a separate operation subject to configuration/recovery gates.

Evidence: C:\Users\Administrator\.codex\artifacts\ops-layout-gap-20261004\VERIFICATION.txt
