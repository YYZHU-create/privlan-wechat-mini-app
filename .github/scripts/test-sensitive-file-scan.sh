#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
scanner="$root/.github/scripts/sensitive-file-scan.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

mkdir -p "$tmp/bin" "$tmp/fixtures/clean" "$tmp/fixtures/prohibited"
printf 'clean\n' >"$tmp/fixtures/clean/app.js"
printf 'credential placeholder\n' >"$tmp/fixtures/prohibited/.env"
tar -cf "$tmp/clean.tar" -C "$tmp/fixtures/clean" .
tar -cf "$tmp/prohibited.tar" -C "$tmp/fixtures/prohibited" .
printf 'clean history\n' >"$tmp/clean-history"
printf 'RUN echo token=fake\n' >"$tmp/secret-history"

cat >"$tmp/bin/docker" <<'DOCKER_MOCK'
#!/usr/bin/env bash
set -eu
case "${1:-}" in
  image)
    case "$*" in
      *Config.User*) printf 'node\n' ;;
      *Config.ExposedPorts*) printf '{"9000/tcp":{}}\n' ;;
      *Config.Healthcheck*) printf '{"Test":["CMD-SHELL","/health"]}\n' ;;
      *) exit 2 ;;
    esac
    ;;
  create) printf 'test-container\n' ;;
  export)
    if [ "${FAKE_EXPORT_ERROR:-0}" = 1 ]; then exit 42; fi
    cat "$FAKE_ARCHIVE"
    ;;
  history)
    if [ "${FAKE_HISTORY_ERROR:-0}" = 1 ]; then exit 43; fi
    cat "$FAKE_HISTORY"
    ;;
  rm) : ;;
  *) exit 2 ;;
esac
DOCKER_MOCK
chmod +x "$tmp/bin/docker"

run_case() {
  local name="$1" expected_status="$2" archive="$3" history="$4" export_error="${5:-0}" history_error="${6:-0}"
  set +e
  output="$(PATH="$tmp/bin:$PATH" FAKE_ARCHIVE="$archive" FAKE_HISTORY="$history" FAKE_EXPORT_ERROR="$export_error" FAKE_HISTORY_ERROR="$history_error" bash "$scanner" "fixture:$name" 2>&1)"
  status=$?
  set -e
  if [ "$status" -ne "$expected_status" ]; then
    printf 'case=%s expected_exit=%s actual_exit=%s\n%s\n' "$name" "$expected_status" "$status" "$output" >&2
    return 1
  fi
  printf 'SENSITIVE_SCAN_CASE_%s=PASS\n' "$(printf '%s' "$name" | tr '[:lower:]-' '[:upper:]_')"
}

run_case clean 0 "$tmp/clean.tar" "$tmp/clean-history"
run_case prohibited_path 1 "$tmp/prohibited.tar" "$tmp/clean-history"
run_case prohibited_history 1 "$tmp/clean.tar" "$tmp/secret-history"
run_case export_error 1 "$tmp/clean.tar" "$tmp/clean-history" 1
run_case history_error 1 "$tmp/clean.tar" "$tmp/clean-history" 0 1
