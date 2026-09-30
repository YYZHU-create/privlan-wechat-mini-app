# Future Meoo release provenance

Meoo's tenant-visible Release list can show an active version while `commitId` is empty. The project therefore preserves its own evidence chain for **new** releases. This procedure does not retroactively assign a source commit to historical releases.

## Before submitting a release

1. Use a clean Git checkout at the intended GitHub commit. Verify the commit is available on the GitHub remote. Keep the exact build context outside the source checkout and do not modify it after hashing.
2. Ensure `runtime-build.json` in the build context declares that commit, the target project, and the intended environment.
3. Generate the manifest outside the build context:

```sh
node scripts/release-provenance.js prepare \
  --repo /path/to/clean-checkout \
  --build-context /path/to/frozen-build-context \
  --project PROJECT_ID --environment staging \
  --output /path/to/evidence/pre-release-manifest.json
node scripts/release-provenance.js verify \
  --manifest /path/to/evidence/pre-release-manifest.json \
  --build-context /path/to/frozen-build-context
```

The manifest records every packaged file's relative path, byte length, and SHA-256, plus a deterministic digest of the complete directory. Preparation fails for a dirty source checkout, mismatched runtime identity, symbolic links, or common credential filenames. Review the build context for other sensitive material before release; a hash is not a substitute for that review. Preserve the manifest and build context unchanged.

## Submit and observe

After the separately authorized Meoo deployment, save the **single invocation's** sanitized command, start/end UTC times, exit status, and CLI output in the task's evidence directory. Do not infer a release from a successful command alone. Capture the read-only list for the exact target project:

```sh
meoo --json releases list --project PROJECT_ID > /path/to/evidence/release-list.json
node scripts/release-provenance.js finalize \
  --manifest /path/to/evidence/pre-release-manifest.json \
  --release-list /path/to/evidence/release-list.json \
  --release VERSION \
  --output /path/to/evidence/release-receipt.json
```

`finalize` checks that the selected version is uniquely `SUCCESS/ACTIVE` and rejects a non-empty conflicting `commitId`. It records hashes of both evidence inputs. **The CLI list does not identify the project inside its JSON and does not expose a Release-to-artifact binding.** Keep the exact CLI command, its exit status, and the deployment invocation together with the receipt. The receipt deliberately leaves `platformReleaseToArtifactBinding=NOT_VERIFIED` until a platform record directly proves it.

## Acceptance and retention

- Perform the authorized runtime identity and health acceptance on the active target. Record the actual source commit and artifact/build/config identity fields separately; mark missing fields `NOT_VERIFIED`.
- Where an authenticated GET can read public static files, compare their SHA-256 with the manifest. File equality proves observed content equality, not the platform's internal release binding.
- Preserve the source commit, manifest, deployment transcript, CLI release capture, receipt, and runtime acceptance together. Keep credentials, tokens, cookies, raw configuration, and temporary logs with sensitive values out of GitHub.
- Do not promote a release merely because the local receipt exists. Production gates, database compatibility, rollback, and separate authorization still apply.

Evidence classes: `DOCUMENTED` means the current [Meoo CLI documentation](https://docs.meoo.com/meoo-cli) describes a capability; `PROJECT IMPLEMENTED` means this repository captures it; `RUNTIME VERIFIED` requires observation in the actual target release. The project manifest is `PROJECT IMPLEMENTED`, not a Meoo-provided immutable release attestation.
