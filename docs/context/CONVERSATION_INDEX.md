# Conversation Index

This index is a cleanup reference only. It does not rename, archive, delete, or mutate Codex conversations.

## ACTIVE

CONVERSATION_ID=01a0621b-8dc6-7513-aade-b5d7084cf452
CONVERSATION_TITLE=[Production] Feeldao OS — Deployment, Domain & Auth Gates [BLOCKED]
MODULE=Production / Auth / Domain
ROLE=Current execution gate
STATUS=BLOCKED
UNIQUE_KNOWLEDGE_REMAINING=YES
CANONICAL_DESTINATION=docs/context/modules/production.md; docs/context/modules/auth.md; docs/context/CURRENT_STATE.md
RECOMMENDED_ACTION=KEEP
REASON=Production identity is confirmed only partially; authenticated readiness and route/domain gates remain open.

CONVERSATION_ID=01a03324-39b5-7ac1-8eda-261bbdf46dc0
CONVERSATION_TITLE=[Database] Meoo B1 — Schema Parity & T2 Cutover Gate [BLOCKED]
MODULE=Database / Meoo
ROLE=Current execution gate
STATUS=BLOCKED
UNIQUE_KNOWLEDGE_REMAINING=YES
CANONICAL_DESTINATION=docs/context/modules/database-meoo.md; docs/context/CURRENT_STATE.md
RECOMMENDED_ACTION=KEEP
REASON=Latest read-stability evidence blocks safe T2 resume and cutover.

## REFERENCE

CONVERSATION_ID=01a00406-d14c-7200-acb0-1dda8c7f0d18
CONVERSATION_TITLE=[Product] Template Center — Architecture Decision [DECIDED]
MODULE=Template Center
ROLE=Durable architecture decision
STATUS=DECIDED
UNIQUE_KNOWLEDGE_REMAINING=YES
CANONICAL_DESTINATION=docs/context/DECISIONS.md; docs/context/modules/template-center.md
RECOMMENDED_ACTION=KEEP
REASON=Architecture is decided while implementation remains unverified.

CONVERSATION_ID=01a03c6a-629a-7151-a23b-e3cb3c0ccff0
CONVERSATION_TITLE=[UI] Product Media & FAQ — Verified Fixes / Open Audit
MODULE=Product Media / UI
ROLE=Historical evidence and open audit
STATUS=OPEN
UNIQUE_KNOWLEDGE_REMAINING=YES
CANONICAL_DESTINATION=docs/context/modules/product-media.md; docs/context/modules/merchant-admin.md
RECOMMENDED_ACTION=KEEP_AS_REFERENCE
REASON=Media normalization, generator parity, and package behavior remain open; do not continue implementation in this mixed thread.

## MANUAL_REVIEW

CONVERSATION_ID=01a0666c-dfff-79e1-840c-7420f11b7a77
CONVERSATION_TITLE=[Operator Console] V2 RC Review — Evidence Incomplete [REVIEW]
MODULE=Operator Console
ROLE=Release candidate review
STATUS=REVIEW
UNIQUE_KNOWLEDGE_REMAINING=UNKNOWN
CANONICAL_DESTINATION=docs/context/modules/operator-console.md
RECOMMENDED_ACTION=MANUAL_REVIEW
REASON=The recommended title is not confirmed as applied; historical evidence remains incomplete.

CONVERSATION_ID=01a03878-3078-7533-9eb3-56842eb73617
CONVERSATION_TITLE=[Audit] Native Mini-App Baseline — Package Incomplete [REVIEW]
MODULE=Audit / Native Mini-App
ROLE=Baseline audit
STATUS=REVIEW
UNIQUE_KNOWLEDGE_REMAINING=UNKNOWN
CANONICAL_DESTINATION=docs/context/production.md; docs/context/modules/product-media.md
RECOMMENDED_ACTION=MANUAL_REVIEW
REASON=Package and evidence completeness remain unconfirmed.

CONVERSATION_ID=019fd624-022e-7d42-bc86-5c578ab88da4
CONVERSATION_TITLE=后台编辑
MODULE=Mixed Merchant Admin / Config / Media / Auth / SaaS / QA
ROLE=Historical source
STATUS=ARCHIVE_READY
UNIQUE_KNOWLEDGE_REMAINING=NO
CANONICAL_DESTINATION=docs/context/modules/*; docs/context/KNOWN_ISSUES.md
RECOMMENDED_ACTION=ARCHIVE
REASON=The 13 previously uncovered durable knowledge items are migrated; remaining content is historical execution material.

## ARCHIVE_READY

- 019fd624-022e-7d42-bc86-5c578ab88da4 — 后台编辑 — all durable knowledge migrated; archive may be considered in a separate sidebar operation. Open implementation gates and unique mixed-thread evidence remain.

## DELETE_CANDIDATE

NONE declared by this migration. Deletion requires separate review and explicit authorization.

## Previously uncovered knowledge coverage

ITEM=designSystem / overrideKeys / restore-default semantics
DESTINATION=docs/context/modules/merchant-admin.md; docs/context/modules/template-center.md
COVERED=YES
SOURCE=后台编辑 historical editor evidence
CURRENT_VALIDITY=Historical contract; implementation NOT_VERIFIED

ITEM=Chinese config corruption root cause and guard
DESTINATION=docs/context/modules/merchant-admin.md; docs/context/KNOWN_ISSUES.md
COVERED=YES
SOURCE=后台编辑 historical config evidence
CURRENT_VALIDITY=Historical pitfall; guard NOT_VERIFIED

ITEM=legacy config migration compatibility
DESTINATION=docs/context/modules/merchant-admin.md; docs/context/modules/template-center.md
COVERED=YES
SOURCE=后台编辑 and Template Center decision evidence
CURRENT_VALIDITY=Open compatibility requirement

ITEM=Product Media normalization and generator contract
DESTINATION=docs/context/modules/product-media.md
COVERED=YES
SOURCE=Product Media canonical/reference and 后台编辑
CURRENT_VALIDITY=Open; revalidation required

ITEM=large media and package limits
DESTINATION=docs/context/modules/product-media.md
COVERED=YES
SOURCE=Product Media historical evidence
CURRENT_VALIDITY=Open; revalidation required

ITEM=Merchant Auth OTP and Session security limits
DESTINATION=docs/context/modules/auth.md
COVERED=YES
SOURCE=后台编辑 Auth evidence
CURRENT_VALIDITY=Durable design candidate; production NOT_VERIFIED

ITEM=Production SMS and formal auth constraints
DESTINATION=docs/context/modules/auth.md; docs/context/CURRENT_STATE.md
COVERED=YES
SOURCE=Production canonical and 后台编辑
CURRENT_VALIDITY=Open gate

ITEM=Subscription / License / Workspace scope
DESTINATION=docs/context/modules/saas-tenancy.md
COVERED=YES
SOURCE=Architecture baseline and 后台编辑
CURRENT_VALIDITY=Scope decision durable; full acceptance open

ITEM=QA test tenant pollution and isolation
DESTINATION=docs/context/modules/qa-test-data.md
COVERED=YES
SOURCE=后台编辑 historical QA evidence
CURRENT_VALIDITY=Open policy verification

ITEM=checkout / runtime / DB identity binding
DESTINATION=docs/context/modules/production.md; docs/context/DECISIONS.md
COVERED=YES
SOURCE=Production runbook and runtime diagnostics
CURRENT_VALIDITY=Durable evidence rule; live identity revalidation required

ITEM=AI fallback / SSRF / key protection
DESTINATION=docs/context/modules/security-integrations.md
COVERED=YES
SOURCE=后台编辑 security discussions and repository README
CURRENT_VALIDITY=Open acceptance record

ITEM=appointments / customer / measurement data permissions
DESTINATION=docs/context/modules/saas-tenancy.md; docs/context/modules/security-integrations.md
COVERED=YES
SOURCE=Architecture baseline and historical domain/security evidence
CURRENT_VALIDITY=Scope boundary durable; current acceptance open

ITEM=Merchant Admin save / sync state machine
DESTINATION=docs/context/modules/merchant-admin.md; docs/context/KNOWN_ISSUES.md
COVERED=YES
SOURCE=后台编辑 editor evidence
CURRENT_VALIDITY=Open implementation contract

## Migration coverage summary

PREVIOUSLY_UNCOVERED_TOTAL=13
PREVIOUSLY_UNCOVERED_NOW_COVERED=13
UNCOVERED_KNOWLEDGE=0
STALE_FACTS_MARKED_AS_CURRENT=0
UNSUPPORTED_PASS_CLAIMS=0
UNRESOLVED_SOURCE_CONFLICTS=0
## Classification rules

- `ACTIVE`: unfinished execution or current gate.
- `REFERENCE`: durable decision, evidence, or audit value.
- `ARCHIVE_READY`: all durable knowledge migrated, no unfinished execution, and no unique evidence remains.
- `DELETE_CANDIDATE`: no unique knowledge, no open task, no unique evidence, and complete replacement by a more reliable source.
- `MANUAL_REVIEW`: unique evidence or completeness cannot be confirmed.

SIDEBAR_CLEANUP_READY=YES
