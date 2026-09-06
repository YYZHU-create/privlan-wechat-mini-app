# Merchant Auth Context

## Boundary

Merchant authentication is distinct from Operator and Customer authentication. Merchant routes derive tenant/workspace/store scope from the authenticated session and enforce CSRF and authorization on mutations.

## Historical rules

Historical Merchant Auth design included email/password and OTP flows, five-minute expiry, single-use codes, failure lockout, resend throttling, HMAC/pepper protection, HttpOnly sessions, CSRF, workspace membership, and `403` for invalid scope.

These rules are durable candidates, but production implementation and current gateway readiness remain `NOT_VERIFIED` unless a newer authenticated acceptance record proves them.

## Current repository evidence

The repository contains merchant session handling, CSRF-related route checks, membership scope checks, and Meoo/Supabase session adapters. Production SMS, formal authentication readiness, session restoration, and workspace loading remain open gates.

## Secret rule

Never store passwords, OTP values, cookies, tokens, API keys, or database credentials in this context.
