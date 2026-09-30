# Required Project Context

`docs/context/` is the long-lived Feeldao OS engineering memory.

Before starting a Feeldao OS task, read:

1. `docs/context/PROJECT_CONTEXT.md`
2. `docs/context/CURRENT_STATE.md`
3. `docs/context/DECISIONS.md`
4. `docs/context/KNOWN_ISSUES.md`

Then read only the relevant module context under `docs/context/modules/`.

`CURRENT_STATE.md` is authoritative for current state. Do not treat historical conversation text as more authoritative than newer verified repository or platform evidence.

At task completion, update only durable facts, decisions, and known issues. Keep temporary debugging logs, speculative conclusions, secrets, and credentials out of canonical context.

## GitHub Synchronization and Release Traceability

GitHub is the canonical source of truth for repository-managed project files. Codex worktree edits remain local until committed and pushed; a push does not deploy to Meoo.

For each completed task that changes repository-managed files:

1. Finish the task-specific validation, then inspect the full status and diff.
2. Stage only files that belong to the task. Keep credentials, secrets, runtime dumps, local deployment metadata, temporary logs, rollback copies, generated build contexts, and unrelated files out of commits.
3. Create a task-scoped commit on the intended branch and push it to the configured GitHub remote without rewriting shared history.
4. Read back the remote ref and verify that it contains the pushed commit SHA.
5. Report the branch, commit SHA, remote ref/SHA, push result, validation result, and any intentionally local changes.

Read-only work, explicitly local-only experiments, failed or inconclusive changes, user-forbidden publication, and unresolved branch conflicts are exceptions. If synchronization cannot safely complete, report `GITHUB_SYNC=BLOCKED` with the specific blocker; do not silently treat local changes as synchronized. Never use `git add .` blindly, force-push, or overwrite newer remote work.

For a Meoo release, record the exact source commit SHA and the build-context/artifact digest. The source commit must be verifiable from a GitHub remote ref, and the build input must identify that same source commit. Deploy the candidate to Staging and complete the applicable acceptance before promoting it to Production. Prefer promoting the Staging-accepted artifact itself; if a new artifact is built, record its identity and repeat the required acceptance. A successful application deployment does not establish that a database migration ran; schema changes remain versioned in repository migrations and use the authorized migration procedure.

For future Meoo releases, follow `docs/runbooks/release-provenance.md`: capture the frozen build-context manifest before submission, then retain the exact deployment invocation, observed Release record, and runtime acceptance as separate evidence. A local receipt does not establish a platform-internal Release-to-artifact binding when Meoo does not expose one.

## Meoo Documentation Evidence

Before Meoo platform integration, connection, deployment, or API work, review the relevant current official documentation. Separate what is `DOCUMENTED`, `PROJECT IMPLEMENTED`, and `RUNTIME VERIFIED`; documentation alone does not prove project configuration or live runtime behavior. Cite the relevant official documentation in findings or implementation notes.
