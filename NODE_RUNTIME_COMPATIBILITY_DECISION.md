# FEELDAO OS — Node Runtime Compatibility Decision

AUDIT_DATE=2026-09-13
SOURCE=origin/main (refreshed before change)

## Contract

RECOMMENDED_NODE_RANGE=>=22 <25
PNPM_VERSION=10.33.3
NODE_VERSION_BASELINE=22 (.node-version and Docker)
DOCKER_BASE=node:22-bookworm-slim
PORT=9000
HEALTH_ROUTE=/health

`scripts/setup.sh` is the project-owned Meoo image-build bootstrap. It accepts only Node majors 22, 23, and 24, then verifies the platform-supplied pnpm `10.33.3` before installing production dependencies. The local/CI Docker baseline remains Node 22; Meoo image builds use the platform Node 24.15.0 / pnpm 10.33.3 contract.

## Requirement origin

NODE22_REQUIREMENT_ORIGIN=CONSERVATIVE_SETUP_GUARD_AND_PRODUCTION_DOCKER_BASELINE
NODE22_REQUIREMENT_TECHNICAL_JUSTIFICATION=Node 22 remains the local and Docker compatibility baseline; Meoo supplies Node 24.15.0 and pnpm 10.33.3 for image builds.
NODE22_REQUIREMENT_STILL_VALID=PARTIAL

## Implementation

- `admin/package.json` engines use Node `>=22 <25` and pnpm `10.33.3` to match Meoo.
- `scripts/setup.sh` accepts majors 22–24 and rejects Node 25+ or older majors.
- CI test job is a matrix for Node 22 and exact Node 24.15.0 using pnpm 10.33.3; Docker smoke remains on Node 22.
- `.node-version` and `Dockerfile` are unchanged.
- Existing runtime contract tests were updated only to assert the new range; no behavior/security assertions were removed.
- Production, Staging, database, Storage, Secret, and deployment state were not touched.

## Verification

NODE24_LOCAL=Node v24.19.0; pnpm 10.33.3 compatibility install PASS after removing the old pnpm constraint in an isolated copy; full suite evidence remains from the prior 11.7.0 lane.
NODE22_LOCAL=Node v22.23.2; pnpm 10.33.3 package compatibility verified in an isolated copy.
BUILD_STATUS=NOT_CONFIGURED (no build script exists; no build gate added)
DOCKER_LOCAL=NOT_RUN (Docker CLI unavailable on this host; CI Docker smoke remains required)

## Builder resolution

MEOO_BUILDER_NODE_VERSION_SOURCE=Observed Meoo remote image builder host (v24.15.0) plus project setup.sh guard.
MEOO_BUILDER_NODE_VERSION_CONFIGURABLE=NOT_EXPOSED_BY_CLI
SUPPORTED_NODE_PINNING_METHOD=Project setup guard for build acceptance; Docker base pin for runtime image. No undocumented Meoo flag is used.
SELECTED_SOLUTION=Use the Meoo-supplied pnpm 10.33.3 without Corepack global-shim mutation, keep Node >=22 <25, and retain the Node 22 Docker baseline.

NODE24_UPGRADE_SAFE=YES (isolated application evidence; hosted CI/Docker evidence is a separate gate)
NODE24_UPGRADE_SELECTED=NO (production image remains Node 22)

HOSTED_CI_RUN=34745432106
HOSTED_CI_COMMIT=0e1b10f7b07ece3eb272bcbb1b168039ce3cd4b9
HOSTED_NODE22_CI=PASS
HOSTED_NODE24_24_15_0_CI=PASS
HOSTED_DOCKER_SMOKE=PASS
CI_STATUS=PASS

NEXT_GATE=G2C4_NODE_RUNTIME_DELTA_PREFLIGHT
RISK_LEVEL=LOW for this source-only runtime contract; hosted Node 22/24.15.0 CI and Docker smoke all pass.

DATABASE_CHANGE=NO
SECRET_CHANGE=NO
DEPLOYMENT=NO
PRODUCTION_MUTATION=NO
