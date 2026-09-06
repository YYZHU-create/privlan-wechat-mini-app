# Feeldao OS Context Guide

## Source of truth

This directory is the canonical, versioned project context for Feeldao OS. Codex conversations remain temporary execution, investigation, review, and acceptance workspaces.

## File responsibilities

- `PROJECT_CONTEXT.md`: stable product, architecture, boundaries, and engineering principles.
- `CURRENT_STATE.md`: highest-priority current state, including explicit `PASS`, `FAIL`, `NOT_VERIFIED`, `CONDITIONAL`, and `BLOCKED` values.
- `DECISIONS.md`: durable product and architecture decisions only.
- `KNOWN_ISSUES.md`: current open issues and gates only.
- `CONVERSATION_INDEX.md`: sidebar cleanup classification and canonical destinations.
- `modules/`: durable module contracts, compatibility rules, evidence-backed pitfalls, and open boundaries.

## Evidence precedence

1. Current repository, Git, and authenticated platform evidence.
2. Latest explicit user correction.
3. Latest canonical verified record.
4. Historical verified evidence.
5. Durable decision.
6. Reported information.
7. Historical diagnostics.
8. Superseded material.

When sources conflict, record the conflict and resolution explicitly. Never promote historical or speculative material to current `PASS`.

## Update rules

- Update `CURRENT_STATE.md` when actual current state changes.
- Update `DECISIONS.md` only for durable decisions.
- Update the relevant module file for durable engineering knowledge.
- Move resolved issues out of `KNOWN_ISSUES.md` or mark them closed with evidence.
- Keep secrets, credentials, cookies, tokens, transient logs, one-off ports, temporary SHAs, and chat transcripts out of canonical context.
- Record source dates and revalidation requirements for historical evidence.

## Conversation cleanup rule

A conversation is archive-ready only after its durable knowledge is migrated, open execution has a new clear entry point, and no unique evidence remains only in the conversation. This directory does not itself perform conversation rename, archive, or deletion.
