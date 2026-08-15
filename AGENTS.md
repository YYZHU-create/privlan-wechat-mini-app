# PrivLan WeChat Mini App Repository Guidance

## Context recovery

Before modifying code or documentation, read these files in order:

1. `README.md`
2. `docs/PROJECT_STATE.md`
3. `docs/ARCHITECTURE.md`
4. `docs/DECISIONS.md`
5. `docs/ROADMAP.md`
6. `docs/NEXT_STEPS.md`

Do not infer current project state from conversation history. Confirm the branch, `git status`, latest commit, active phase, architecture constraints, and unfinished work first. Keep capabilities on unmerged branches separate from code available on `main`. If evidence is incomplete, use `Unverified` or `Needs verification`.

## Project boundaries

This repository contains the PRIVLAN native WeChat Mini Program, WeChat Cloud functions, a local Node/Express operations and generation tool, ATELIER OS platform-boundary prototypes, and production design assets.

- `pages/`, `components/`, and `custom-tab-bar/`: Mini Program UI.
- `cloudfunctions/`: trusted identity, appointment, reminder, measurement, and service boundary.
- `admin/`: local editor, synchronization, generation, preview, operations, AI gateway, and QA tooling.
- `platform/`: cross-system contracts and database reference; a schema file alone does not prove production persistence.
- `images/` and `design-assets/`: tracked product/design assets.

## Verification

- Install and test admin: `cd admin && npm ci && npm test`
- Focused AI tests: `cd admin && npm run test:ai`
- Syntax: run `node --check` for every file returned by `git ls-files "*.js"`
- Diff hygiene: `git diff --check`
- Use WeChat DevTools and a test device for routing, permissions, cloud-function calls, phone authorization, subscriptions, WebView domains, and device-only behavior.

## Security and production rules

- Never commit `.env`, API keys, Feishu secrets/tokens, AI gateway credentials, private keys, customer data, logs, caches, or `project.private.config.json`.
- Derive customer identity from trusted WeChat context; never trust a client-supplied `openId`.
- Production must use `AUTH_MODE=wechat`; test codes must not remain enabled.
- Appointment creation must preserve idempotency, capacity locks, audit events, and reconciliation behavior.
- Model-provider credentials stay server/cloud-side and must never be generated into Mini Program files.
- Generated projects and preview QR codes are development artifacts, not proof of upload, review, or production release.

## Durable project memory

After an important task, compare code and test results with `PROJECT_STATE`, `ROADMAP`, and `NEXT_STEPS`. Update durable memory for completed phases, features, APIs, schemas, security or permission changes, dependencies, architecture decisions, and important defects.

Do not record formatting, typo-only changes, routine styling, temporary diagnostics, or debug output. `PROJECT_STATE` contains current facts, `ARCHITECTURE` contains the current design, `DECISIONS` records durable rationale, `ROADMAP` contains phases, `NEXT_STEPS` contains only the few immediate priorities, and Git history remains the detailed chronology.

Facts must be supported, in priority order, by current code, Git history, tests, and existing repository documentation. Never mark a feature complete solely from an old chat or an unmerged branch.

## Git

- Inspect `git status` before pulling or switching branches; use `git pull --ff-only` on a clean branch.
- Use one task branch per device. Test, commit, and push before changing computers.
- Do not use `git reset --hard`, `git clean`, or delete untracked files without explicit authorization.
- Stage only intended files. After pushing, fetch and verify local `HEAD` equals the upstream branch commit.
- If commit or push fails, report the exact failure and leave local changes intact.
