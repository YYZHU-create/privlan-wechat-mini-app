# Template Center Context

## Architecture decision

Template Center is a durable architecture distinct from legacy Global Settings. `DECIDED` means the architecture boundary is chosen; it does not mean the feature is fully implemented.

## Required lifecycle semantics

Future implementation must define and preserve:

- workspace/global defaults versus user or page overrides;
- `designSystem` and `overrideKeys` compatibility semantics;
- config version;
- immutable or auditable snapshots;
- preview without mutation;
- apply with an explicit target scope;
- restore that removes the selected override and resolves inheritance;
- legacy configuration compatibility and migration behavior.

The old Global Settings approach must not be treated as the final Template Center implementation or as equivalent merely because both store configuration.

## Current status

- Architecture: `DECIDED`
- Implementation and migration parity: `NOT_VERIFIED`
- Legacy Global Settings equivalence: `NO`
- Preview/apply/restore acceptance: `NOT_VERIFIED`
