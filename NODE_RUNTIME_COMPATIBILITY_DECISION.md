# FEELDAO OS — Node Runtime Compatibility Decision

AUDIT_DATE=2026-09-13
SOURCE=origin/main (refreshed before change)

## Contract

RECOMMENDED_NODE_RANGE=>=22 <25
PNPM_VERSION=11.7.0
NODE_VERSION_BASELINE=22 (.node-version and Docker)
DOCKER_BASE=node:22-bookworm-slim
PORT=9000
HEALTH_ROUTE=/health

`scripts/setup.sh` is the project-owned Meoo image-build bootstrap. It accepts only Node majors 22, 23, and 24 and exits non-zero for every other major. This preserves a fail-closed `>=22 <25` contract while allowing the Meoo Builder's observed Node 24.15.0 host. The production image remains Node 22 for reproducibility.

## Requirement origin

NODE22_REQUIREMENT_ORIGIN=CONSERVATIVE_SETUP_GUARD_AND_PRODUCTION_DOCKER_BASELINE
NODE22_REQUIREMENT_TECHNICAL_JUSTIFICATION=No native .node modules or lifecycle install hooks were found; the application and pinned pnpm 11.7.0 are compatible with Node 24 in isolated tests. Node 22 remains the Docker/development baseline for runtime parity.
NODE22_REQUIREMENT_STILL_VALID=PARTIAL

## Implementation

- `admin/package.json` engines changed from `22.x` to `>=22 <25`; pnpm remains pinned.
- `scripts/setup.sh` accepts majors 22–24 and rejects Node 25+ or older majors.
- CI test job is a matrix for Node 22 and exact Node 24.15.0; Docker smoke remains on Node 22.
- `.node-version` and `Dockerfile` are unchanged.
- Existing runtime contract tests were updated only to assert the new range; no behavior/security assertions were removed.
- Production, Staging, database, Storage, Secret, and deployment state were not touched.

## Verification

NODE24_LOCAL=Node v24.19.0; pnpm 11.7.0 frozen install and full suite PASS (248 tests, 247 passed, 1 skipped, 0 failed); startup /health HTTP 200.
NODE22_LOCAL=Node v22.23.2 via isolated `node@22.23.2`; full suite PASS (248 tests, 247 passed, 1 skipped, 0 failed); startup /health HTTP 200.
BUILD_STATUS=NOT_CONFIGURED (no build script exists; no build gate added)
DOCKER_LOCAL=NOT_RUN (Docker CLI unavailable on this host; CI Docker smoke remains required)

## Builder resolution

MEOO_BUILDER_NODE_VERSION_SOURCE=Observed Meoo remote image builder host (v24.15.0) plus project setup.sh guard.
MEOO_BUILDER_NODE_VERSION_CONFIGURABLE=NOT_EXPOSED_BY_CLI
SUPPORTED_NODE_PINNING_METHOD=Project setup guard for build acceptance; Docker base pin for runtime image. No undocumented Meoo flag is used.
SELECTED_SOLUTION=Allow the supported Node 22–24 contract in setup.sh and package engines while retaining Node 22 Docker baseline.

NODE24_UPGRADE_SAFE=YES (isolated application evidence; hosted CI/Docker evidence is a separate gate)
NODE24_UPGRADE_SELECTED=NO (production image remains Node 22)

NEXT_GATE=G2C4_NODE_RUNTIME_DELTA_PREFLIGHT
RISK_LEVEL=MEDIUM until hosted Node 22/24 CI and Docker smoke complete; source guard and both local runtime lanes are passing.

DATABASE_CHANGE=NO
SECRET_CHANGE=NO
DEPLOYMENT=NO
PRODUCTION_MUTATION=NO
