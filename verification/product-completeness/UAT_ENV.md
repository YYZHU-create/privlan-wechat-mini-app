# UAT Environment

Required process variables (values are never stored here):
- `DATABASE_ENV=staging` or `uat`
- `ATELIER_REAL_POSTGRES_URL`
- `ATELIER_UAT_LOGIN`
- `ATELIER_UAT_PASSWORD` (optional; seed prints a generated password once when absent)
- `ATELIER_OPENID_HASH_KEY`

Commands:
- `npm run uat:seed`
- `ATELIER_AUTO_MIGRATE=0 npm test`
- `node --check uat-seed.js`

Reset is operator-controlled. Do not run against production and do not paste connection strings, passwords, tokens, OpenID values or hashes into reports.

Recorded non-sensitive metadata belongs in the UAT operator's secure run log: environment, host name, database name, SSL mode, snapshot time and migration SHA.
