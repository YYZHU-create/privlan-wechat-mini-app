#!/usr/bin/env bash
set -euo pipefail

root="${1:?isolated worktree copy path required}"
registry="$root/docs/prompts/ATELIER_OS_AI_Development_Prompt_Registry.md"
sprint="$root/docs/prompts/sprint-3a-workflow-runtime.md"

grep -Fqx '# ATELIER OS AI Development Prompt Registry' "$registry"
grep -Fqx '# ATELIER OS Sprint 3A Workflow Runtime Core' "$sprint"
rm -- "$registry" "$sprint"
printf '%s\n' 'ROLLBACK=PASS; Prompt files restored to absent state'
