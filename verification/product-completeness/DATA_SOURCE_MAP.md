# Product Completeness Data Source Map

## SaaS mode

`SAAS_MODE = DATABASE_URL is configured`. Visible merchant and operator features read and write PostgreSQL. Legacy local JSON is not a fallback for a failed SaaS route.

| Data | Authoritative source | Legacy / generated use |
|---|---|---|
| Merchant identity and session | users, memberships, merchant_sessions | browser cookies only |
| Workspace config | workspace_configs.document | generated mini-program files are derived artifacts |
| Profile | users.display_name, users.avatar_url | avatar bytes in `ATELIER_DATA_ROOT/user-avatars` |
| Customers | customers + customer_events | legacy cloud mirrors are integration-only |
| Appointments | appointments and appointment_* tables | Feishu mirror is non-authoritative |
| Membership / points | membership_* and customer_points_* | none |
| AI policy / BYOK | merchant_ai_policies and merchant_ai_connections | no platform fallback |
| Operator license / subscription / audit | license_*, subscriptions, audit_events | no saas-state fallback |
| Preview QR / project files | generated preview directory | does not become source-of-truth config |

## Legacy local mode

`LEGACY_LOCAL_MODE` is explicit and intended only for local demonstrations. It may use `admin/config.json` and `admin/saas-state.json`; SaaS requests never fall through to this mode.

## Hidden future modules

Platform AI, publishing executor, feature flags, support tickets, incidents and impersonation are not visible in SaaS/UAT and are rejected rather than simulated.
