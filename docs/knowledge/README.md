# Shared project knowledge workflow

This package contains the reusable retrieval tool, tests, dependency lock and collaboration guidance. Runtime machine configuration is generated locally. Project records are curated separately according to the selected storage audience.

## Local setup

From the repository root in PowerShell:

```powershell
$skill = Join-Path (Get-Location) '.agents/skills/feeldao-project-memory'
python -m venv "$skill/.venv"
& "$skill/.venv/Scripts/python.exe" -m pip install -r "$skill/requirements.lock.txt"
& "$skill/.venv/Scripts/python.exe" "$skill/scripts/configure.py" --project-root . --vault "$HOME/Documents/Obsidian Vault/FEELDAO OS" --download-model
& "$skill/.venv/Scripts/python.exe" "$skill/scripts/memory.py" sync
& "$skill/.venv/Scripts/python.exe" "$skill/scripts/memory.py" rag 'Which project decisions and verification records are relevant to this task?'
```

The explicit download option retrieves a pinned local ONNX model. Without it, configuration starts in keyword mode unless an existing model directory is supplied. The configurator preserves an existing local config unless `--force` is requested. Source records remain in their existing checkout; the vault receives generated mirrors and curated notes.

## Evidence and maintenance

GitHub committed source, local edits, historical task evidence and live acceptance are different evidence classes. Preserve repository/branch/SHA, source path and lines in citations. Stage only the reviewed file allowlist for publication. Generated mirrors, model weights, virtual environments and indexes can be regenerated locally; verify internal records for their chosen private audience.

Run `python -m unittest discover -s "$skill/scripts" -p 'test_*.py'` for isolated tests. Model and real-source acceptance are separate from fixture checks. Skill usage does not grant deployment, database or cross-conversation messaging authority.
