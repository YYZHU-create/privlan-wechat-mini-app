# SaaS Tenancy Context

## Scope model

Feeldao OS uses `tenantId`, `workspaceId`, and `storeId` as the core business scope. Membership and role determine access within that scope; subscriptions and licenses determine entitlement and operational status. Operator overrides and audit visibility are separate from merchant scope.

## Domain permissions

Customer, appointment, measurement, commerce, and workflow records remain owned by their domain services while inheriting authenticated tenant/workspace scope. Cross-tenant or cross-workspace references are denied; a client-supplied identifier cannot widen scope.

## Current evidence

Current repository services and SQL migrations carry tenant/workspace/store scope through merchant, customer, appointment, workflow, AI-template, and media paths. The repository architecture baseline protects users, memberships, tenants, workspaces, and merchant sessions as long-lived identity boundaries.

## Open boundary

The durable relationship among Membership, Role, Subscription, License, feature flags, and operator overrides needs one current acceptance record. Historical design text is not sufficient to claim complete production implementation.
