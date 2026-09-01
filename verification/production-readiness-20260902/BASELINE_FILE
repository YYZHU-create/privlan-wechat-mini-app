# ATELIER OS SaaS MVP Deployment

## Runtime Boundary

The merchant application runs from `admin/server.js`. Production requires a standard PostgreSQL service, an operator account, a license pepper, and a 32-byte Base64 master key. PGlite is test-only and is rejected outside `NODE_ENV=test`.

The MVP container does not provide WeChat automatic publishing, WeChat Pay, SMS, or COS. “Generate preview” creates development files and a temporary WeChat DevTools preview only.

## Production Configuration

1. Create environment values from `admin/.env.example`. Do not commit the completed file.
2. Set `DATABASE_URL`, `ATELIER_LICENSE_PEPPER`, `ATELIER_MASTER_KEY`, `ATELIER_OPS_EMAIL`, `ATELIER_OPS_PASSWORD`, `ATELIER_APPOINTMENT_GATEWAY_TOKEN`, and the independent `ATELIER_OPENID_HASH_KEY`.
3. Keep `PRIVLAN_DISABLE_GIT_SYNC=1` for tenant runtime processes.
4. Run migrations in one controlled process with `ATELIER_AUTO_MIGRATE=1`, then set it back to `0` for horizontally scaled application instances.
5. Keep `PRIVLAN_LEGACY_FALLBACK=0` after the verified PRIVLAN import.
6. Configure the three appointment cloud functions with the public HTTPS `ATELIER_API_BASE_URL`, the matching gateway token, and `ATELIER_APPOINTMENT_BACKEND=postgres`. Secrets remain cloud/server environment values and are never generated into the mini-program.

`GET /health` returns only application name, database status, and version. A missing or unavailable production database returns HTTP `503`.

## Docker Compose

Create a local untracked `.env` beside `docker-compose.yml` with the required values, then run:

```powershell
docker compose config
docker compose up -d --build
docker compose exec app node migrate-legacy.js
```

The compose file persists PostgreSQL and Workspace media in named volumes. It does not claim to provide a production ingress, TLS termination, KMS, centralized logs, or off-site backups; those remain deployment-provider responsibilities.

## Backup And Restore

The production scripts use PostgreSQL native custom-format backups and verify SHA-256 before restore:

```powershell
$env:DATABASE_URL = "postgresql://..."
./scripts/backup-postgres.ps1 -OutputDirectory D:\atelier-backups
./scripts/restore-postgres.ps1 -BackupFile D:\atelier-backups\atelier-os-YYYYMMDDTHHMMSSZ.dump -ConfirmRestore
```

Store backup files and manifests outside the application host. Test restores against a disposable database before using them in an incident. Workspace media under `admin/data` requires a separate volume snapshot coordinated with the database backup.

## Legacy PRIVLAN Import

Run `admin/migrate-legacy.js` only after the external file backup and SHA-256 manifest succeed. The importer requires uncommitted `PRIVLAN_LEGACY_OWNER_LOGIN` and `PRIVLAN_LEGACY_OWNER_PASSWORD`, uses a source hash to prevent duplicate imports, and leaves the legacy JSON files unchanged.

Historical appointment exports use a separate adapter. Dry-run is the default and does not write the database:

```powershell
cd admin
node import-legacy-appointments.js --source .\legacy-appointments.json --public-store-id store_public_x --report .\legacy-appointment-report.json
node import-legacy-appointments.js --source .\legacy-appointments.json --public-store-id store_public_x --apply --report .\legacy-appointment-report.json
```

The normalized version-1 JSON contains `services`, `advisors`, optional `businessHours`, and `appointments`. The adapter hashes the exact source bytes, records successful imports, and leaves the source file unchanged. A report from real production history is not included in this repository.
