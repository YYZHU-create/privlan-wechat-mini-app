# Security and Integrations Context

## Durable security boundaries

Historical and repository evidence supports the following boundaries:

- deterministic business tools remain separate from free-form AI output;
- FAQ fallback remains available when model access is unavailable;
- SSRF protection is required for server-side fetches;
- provider keys are protected and never exposed to frontend or generated mini-program output;
- errors are redacted before crossing public boundaries;
- customer, appointment, and measurement data follow tenant/workspace/role permissions;
- integration adapters must not bypass authenticated actor or tenant/workspace scope.

## Current status

The repository contains an OpenAI-compatible gateway, merchant BYOK/platform quota concepts, FAQ fallback, and deterministic sensitive actions. Production adapters and a single current security acceptance record remain incomplete.

## Open work

Create a focused security acceptance record covering SSRF, key storage, error redaction, AI fallback, deterministic actions, and customer/appointment/measurement permissions using non-secret fixtures. Do not copy key material or provider responses containing secrets into project context.
