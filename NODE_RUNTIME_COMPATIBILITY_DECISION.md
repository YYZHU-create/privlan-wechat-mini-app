# FEELDAO OS — Node Runtime Compatibility Decision

AUDIT_DATE=2026-09-11
SOURCE_REPOSITORY=YYZHU-create/privlan-wechat-mini-app
SOURCE_WORKTREE=.codex-worktrees/merchant-auth-runtime-hardening
SOURCE_BRANCH=codex/merchant-auth-runtime-hardening
SOURCE_HEAD=2b5465019ac186ec10ba4135175ce90ee76563c0
WORKTREE_NOTE=Existing unrelated worktree changes were preserved; this task changed only the runtime policy, setup guard, CI matrix, and their contract assertions.

## Evidence summary

### Version constraints inspected

| File | Observed constraint | Decision impact |
|---|---|---|
| `admin/package.json` | `engines.node=>=22 <25`; `packageManager=pnpm@11.7.0` | Allows the supported Node 22–24 range without changing pnpm. |
| `scripts/setup.sh` | accepts Node majors 22, 23, and 24 | Rejects Node 25 and other majors. |
| `.node-version` | `22` | Keep as the development/Docker baseline. |
| `Dockerfile` | `FROM node:22-bookworm-slim`; `EXPOSE 9000`; `CMD ["node", "server.js"]` | Keep Node 22 image for production reproducibility. |
| `.github/workflows/ci.yml` | test matrix `22` and exact `24.15.0`; pnpm `11.7.0`; Docker smoke on 22 | Both compatibility lanes install and test; Docker smoke remains Node 22. |

### Runtime verification

- Node `22.23.2`: `229` tests (`228` passed, `1` skipped, `0` failed); startup smoke `GET /health` returned HTTP `200` with `{"status":"ok"}` and no startup-log errors.
- Node `24.15.0`: `229` tests (`228` passed, `1` skipped, `0` failed); startup smoke `GET /health` returned HTTP `200` with `{"status":"ok"}` and no startup-log errors.
- Frozen install: PASS under both exact runtimes using pnpm 11.7.0.
- Dependency scan: no native `.node` modules, no lifecycle install hooks, no scanned deprecated Node API patterns; JavaScript syntax checks passed (`SYNTAX_FAILED=0`).
- Build: NOT_CONFIGURED; `pnpm run build` exits 1 because no `build` script exists. This is an existing project contract gap, not a Node 24 failure.
- Local Docker build: NOT_RUN because Docker CLI is unavailable on this host; hosted Docker smoke passed in GitHub Actions run `34568744507`.

## Decision

RECOMMENDED_NODE_RANGE=>=22 <25

REQUIRED_CHANGES=
1. Change only the runtime policy field in `admin/package.json` from `22.x` to `>=22 <25`; keep pnpm `11.7.0`.
2. Change `scripts/setup.sh` to accept Node majors 22, 23, and 24, and update its diagnostic text.
3. Add a CI compatibility matrix/lane for Node 24 (Node 22 remains the release/Docker lane; Node 23 may remain untested because it is non-LTS).
4. Keep `.node-version=22` and `Dockerfile` base `node:22-bookworm-slim` as the reproducible production baseline.
5. Decide separately whether to add a `build` script; the current container path starts `server.js` directly and the missing script is not evidence of Node incompatibility.

COMPATIBILITY_STATUS=PASS
RISK_LEVEL=MEDIUM

Rationale: Node 22.23.2 and the Meoo Builder target Node 24.15.0 pass the local application test and liveness smoke. Hosted CI and Docker smoke evidence remain outstanding because Docker is unavailable on this host.

DATABASE_CHANGE=NO
SECRET_CHANGE=NO
DEPLOYMENT=NO
CODE_CHANGE=NO

NEXT_ACTION=Keep the Node 22/24.15 CI matrix and Docker smoke attached to future runtime changes; no deployment action is implied by this gate.

## Implementation status (2026-09-11)

IMPLEMENTED=
- `admin/package.json`: `engines.node` is now `>=22 <25`; pnpm remains `11.7.0`.
- `scripts/setup.sh`: accepts Node majors 22, 23, and 24.
- `.github/workflows/ci.yml`: test matrix uses Node `22` and exact `24.15.0`; Docker smoke remains Node 22.
- `.node-version` remains `22`; `Dockerfile` remains `node:22-bookworm-slim`.
- Contract assertions were updated only where they encoded the former exact-22 policy.

CURRENT_VERIFICATION=
- Node `22.23.2`: install dependency set already present; full test suite PASS (exit 0); `/health` smoke HTTP 200.
- Node `24.15.0`: full test suite PASS (exit 0); `/health` smoke HTTP 200.
- GitHub Actions run `34568744507` on commit `cb11916dbc3a18467d7a2761685c6a106dd9c61a` passed Node 22, exact Node 24.15.0, and Docker smoke jobs.
- Docker image build, container start, `/health` HTTP 200, port 9000, startup log check, and cleanup all passed on the hosted Linux runner.
- `COMPATIBILITY_STATUS=PASS`.

## Audit artifacts

- `.codex-audit/node-runtime-compatibility-implementation-20260911/MODIFIED_FILE` — post-change package copy.
- `.codex-audit/node-runtime-compatibility-implementation-20260911/DIFF_FILE` — scoped implementation diff.
- `.codex-audit/node-runtime-compatibility-implementation-20260911/VERIFICATION.txt` — exact baseline, modified, rollback, Node 22/24, health, and Docker evidence.
- `.codex-audit/node-runtime-compatibility-implementation-20260911/ROLLBACK.sh` — executable rollback tested against a separate copy; source remains on the new contract.
- `.codex-audit/node-runtime-compatibility-implementation-20260911/node-runtime-smoke.js` — local startup/health probe used by both Node versions.
