# Product Completeness Function Matrix

Status vocabulary: REAL_END_TO_END, PARTIAL, UI_ONLY, BACKEND_ONLY, LEGACY_ONLY, DEAD, PLACEHOLDER, HIDDEN_FUTURE.

| Area | Visible entry | API / service | PostgreSQL or real generator | UAT status |
|---|---|---|---|---|
| Merchant auth / session | Merchant login | `/auth/*` → SaaS service | users, memberships, merchant_sessions | REAL_END_TO_END |
| Profile / avatar | Account | `/v1/profile*` → SaaS service | users.avatar_url + isolated data root | REAL_END_TO_END |
| Workspace config | Editor / settings | `/api/config` | workspace_configs.document | REAL_END_TO_END |
| Preview generation | Preview command bar | `/api/sync`, `/api/preview` | workspace config + real generated files | REAL_END_TO_END |
| Templates | Settings → Business templates | `/v1/business-templates*` | version-checked config preview; Save persists | REAL_END_TO_END |
| Flexible navigation | Settings → Bottom navigation | `/api/config`, sync generator | tabBar.schemaVersion=2 and generated custom tab bar | REAL_END_TO_END |
| Products / media | Sidebar | merchant routes + workspace media | workspace config / scoped media tables | PARTIAL (catalog data remains config-backed) |
| Customers / appointments | Sidebar | customer and appointment APIs | Customer Identity, appointments, membership, points migrations | REAL_END_TO_END |
| AI customer service | AI service | rules / BYOK APIs | workspace config + encrypted merchant connection | REAL_END_TO_END |
| Platform AI | No visible entry | `platform` explicitly rejected | none | HIDDEN_FUTURE |
| Operator overview / tenants / plans | Operator navigation | SaaS operator routes | PostgreSQL control plane | REAL_END_TO_END |
| Operator licenses / audit | Operator navigation | SaaS operator routes | PostgreSQL | REAL_END_TO_END |
| Operator publishing / flags / support / incidents / impersonation | Hidden in SaaS/UAT | legacy routes blocked in SaaS | no authoritative SaaS source | HIDDEN_FUTURE |
| Onboarding | Overview first-run card | workspace config save | onboarding fields in workspace config | REAL_END_TO_END |
| Lead form | Not shown | no real submit/store/read path | none | HIDDEN_FUTURE |
