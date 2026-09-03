# ATELIER OS Production DNS / TLS / Ingress Plan

Status: prepared; awaiting approved production hostname and provider target.

- Primary: app.<approved-production-domain> (placeholder only; no DNS change made).
- API: same origin unless an approved separation is required.
- Operator: /ops/ on same origin, protected by operator auth and strict cookies.
- HTTPS only; HTTP redirects at the edge.
- Automated certificate issuance and renewal through the selected Meoo/platform edge or approved ingress provider.
- Secure cookies require HTTPS in production.
- Edge controls: request body limits, upload size limit, auth and AI rate limits, forwarded-header trust constrained to the platform edge, security headers, operator route protection.
- No public DNS or TLS changes were executed.

Current code evidence: 110 MB media JSON parser limit, 80 MB decoded media limit, 2 MB ordinary JSON limit, auth/redeem/password rate limiters, CSRF, secure cookies, nosniff, frame and referrer headers.
