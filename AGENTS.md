# Repository Guidance

## Project

This repository contains the PRIVLAN WeChat Mini Program, WeChat Cloud functions, a local Node/Express operations tool, platform contracts, and production design assets.

## Verification

- Admin tests: `cd admin && npm ci && npm test`
- Focused admin AI test: `cd admin && npm run test:ai`
- Tracked JavaScript syntax: run `node --check` for every file returned by `git ls-files "*.js"`.
- Use WeChat DevTools for page routing, permissions, cloud-function calls, subscriptions, WebView domains, and device-only behavior.

## Boundaries

- `pages/`, `components/`, and `custom-tab-bar/` are the Mini Program UI.
- `cloudfunctions/` is the trusted server boundary for identity, appointments, reminders, measurements, and service data.
- `admin/` owns local generation, synchronization, operations, and QA tooling.
- `platform/` documents cross-system contracts; keep implementations compatible with them.

## Security And Production Rules

- Never commit `.env`, API keys, Feishu secrets/tokens, AI gateway credentials, private keys, customer data, or `project.private.config.json`.
- Do not accept a client-supplied `openId`; derive identity in trusted cloud code.
- Production must use `AUTH_MODE=wechat`; test auth codes must not remain enabled.
- Appointment creation must preserve idempotency, capacity locks, audit records, and reconciliation behavior.
- Treat generated previews and development QR codes as non-production artifacts.

## Git

- Inspect `git status` before pulling or switching branches; use `git pull --ff-only` on a clean branch.
- Use one task branch per device and push before changing computers.
- Do not use `git reset --hard`, `git clean`, or remove untracked files without explicit user authorization.
- Keep generated dependencies, logs, caches, local configuration, and secrets out of Git.
