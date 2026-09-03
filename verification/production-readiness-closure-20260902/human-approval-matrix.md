# HUMAN APPROVAL MATRIX

1. Dedicated Production Meoo project creation/approval — required because staging asmhysidbg5g must remain separate. Non-secret decision; Codex must not create or reuse it silently.
2. Production Secret Manager binding and secret entry — required for runtime/auth/database/AI/storage secrets. Values are secret; Codex must not see or receive them in chat.
3. Durable production media storage selection and bucket/container creation — required because current runtime filesystem is not an accepted durable production media target. Bucket identity is non-secret; access credentials remain secret and invisible to Codex.
4. Off-site backup destination and retention owner — required for independent recovery. Destination identity is non-secret; access credentials remain secret and invisible to Codex.
5. Monitoring and alert destination — required for operational response. Channel identity is non-secret; tokens/credentials remain secret and invisible to Codex.
6. Production hostname, DNS ownership, TLS/edge provider — required before public traffic. Names are non-secret; DNS/API credentials remain secret and invisible to Codex.
7. Remote Git push of the exact production RC — required because origin/main does not contain b8afbe2e595ddb572eb41a05c559bfc4b9f54454. Push approval is human-controlled.
8. Production schema deployment/data migration/public traffic switch — separate explicit authorization; not executed in this task.
