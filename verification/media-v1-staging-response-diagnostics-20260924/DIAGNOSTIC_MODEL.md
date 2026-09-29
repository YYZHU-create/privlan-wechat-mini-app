# Diagnostic Model

The HTTP diagnostic channel uses state allocated inside the authenticated upload route and passed only to that request's `mediaService.upload` invocation. The service and repository update it synchronously at each relevant boundary; there is no process-global mutable tracker.

State fields: `lastCompletedPhase`, `currentOperation`, `failedOperation`, `lastFailedCompletedPhase`, and an in-memory `failureError` reference used only for allowlisted classification. On a failed operation, the first boundary and preceding completed phase are retained. The handler serializes only the closed response schema; it never serializes the error object.

Covered operations include request validation/reservation, asset create/confirm, journal `DB_ASSET_CREATED` write/readback, Storage existence check/PUT/verification, object/link writes, READY finalization, and exact-target compensation. Journal callbacks distinguish the initial PATCH from readback. That callback is instrumentation only and the HTTP path does not read journal state.

Activation requires runtime environment exactly `staging`, the normal authenticated merchant context and scope already installed by route middleware, and `X-FEELDAO-Media-Diagnostic: 1`. The header is an opt-in selector, not an authentication mechanism. The same route and service business operations run when diagnostics are disabled.
