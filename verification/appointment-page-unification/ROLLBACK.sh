#!/usr/bin/env sh
set -eu

ROOT="${1:-C:/Users/Administrator/WorkBuddy/2026-08-23-merchant-os-sprint-2}"
BACKUP_ROOT="${2:-C:/Users/Administrator/AppData/Local/AtelierOS/Backups/appointment-page-unification/code-before-20260824-151624}"

test -f "$BACKUP_ROOT/app.js"
test -f "$BACKUP_ROOT/styles.css"
test -f "$BACKUP_ROOT/editor-panel-redesign.test.js"
mkdir -p "$ROOT/admin/public" "$ROOT/admin/test"
cp "$BACKUP_ROOT/app.js" "$ROOT/admin/public/app.js"
cp "$BACKUP_ROOT/styles.css" "$ROOT/admin/public/styles.css"
cp "$BACKUP_ROOT/editor-panel-redesign.test.js" "$ROOT/admin/test/editor-panel-redesign.test.js"
printf '%s\n' 'Appointment page unification source rollback applied.'
