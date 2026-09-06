# Merchant Admin Context

## Durable model

The merchant editor is a compatibility application that manages tenant/workspace/store-scoped configuration, products, media, appointments, customers, and generated mini-program inputs. Historical UI work used a three-pane editor: navigation/sections, a central phone-sized preview canvas, and a right-side property panel.

## Configuration and editor contracts

- `designSystem` describes the selected visual/system defaults; `overrideKeys` identifies values intentionally overridden at a more specific scope.
- Global/workspace defaults and user or page overrides must remain distinguishable. Restore-default removes the selected override and resolves the inherited value; it must not silently erase unrelated settings.
- Layout, media references, and page order must survive save, sync, reload, and generation.
- The save guard must prevent stale or incomplete editor state from overwriting a newer snapshot. A local backup/snapshot is a recovery aid, not a production source of truth.
- The editor state machine distinguishes `unsaved`, `saving`, `saved`, `syncing`, and `sync_failed`; UI feedback must not report `saved` before the durable write is confirmed.
- Sidebar behavior includes expanded/collapsed state, responsive drawer behavior, and state persistence.
- Client-provided scope identifiers are not authorization; server scope comes from the authenticated merchant session. Operator surfaces remain separate from merchant editing surfaces.

## Historical configuration pitfall

A historical config corruption incident converted Chinese/non-ASCII values to ASCII `?` during an incompatible serialization/encoding path. The durable guard is UTF-8 end-to-end serialization plus round-trip fixtures for non-ASCII values, explicit save validation, and backup-before-replace behavior. The current production guard is `NOT_VERIFIED`.

Legacy config compatibility must preserve old field shapes while normalizing them at a compatibility boundary; do not silently reinterpret missing or overridden values.

## Evidence status

Historical multi-viewport and editor evidence exists, but current end-to-end UI closure is `NOT_VERIFIED`. The save/sync state machine, corruption guard, and full legacy-config migration behavior remain open implementation contracts. Relevant source areas include `admin/public/app.js`, merchant routes, and platform scope services.

## Future update rule

Add only stable editor contracts, verified behavior, or open gates. Keep one-off screenshots and transient browser diagnostics out of this file.
