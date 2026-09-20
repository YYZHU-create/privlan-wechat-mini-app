#!/usr/bin/env bash
set -euo pipefail

image_tag="${1:?image tag is required}"
scan_container="${SCAN_CONTAINER:-feeldao-image-scan-${GITHUB_RUN_ID:-local-$$}}"
archive_file="$(mktemp)"
path_list="$(mktemp)"
history_file="$(mktemp)"

cleanup() {
  rm -f "$archive_file" "$path_list" "$history_file"
  docker rm -f "$scan_container" >/dev/null 2>&1 || true
}
trap cleanup EXIT

test "$(docker image inspect --format '{{.Config.User}}' "$image_tag")" = "node"
docker image inspect "$image_tag" --format '{{json .Config.ExposedPorts}}' | grep -q '9000/tcp'
docker image inspect "$image_tag" --format '{{json .Config.Healthcheck}}' | grep -q '/health'
docker create --name "$scan_container" "$image_tag" >/dev/null

if ! docker export "$scan_container" >"$archive_file"; then
  echo "IMAGE_SENSITIVE_FILE_SCAN=ERROR"
  exit 1
fi
if ! tar -tf "$archive_file" >"$path_list"; then
  echo "IMAGE_SENSITIVE_FILE_SCAN=ERROR"
  exit 1
fi
if grep -E '(^|/)(\.env($|\.)|runtime-secrets\.json|[^/]+\.pem|[^/]+\.key|[^/]+\.(bak|backup|dump)|\.git)(/|$)' "$path_list"; then
  echo "IMAGE_SENSITIVE_FILE_SCAN=FAIL"
  exit 1
else
  grep_status=$?
  if [ "$grep_status" -ne 1 ]; then
    echo "IMAGE_SENSITIVE_FILE_SCAN=ERROR"
    exit 1
  fi
fi

if ! docker history --no-trunc "$image_tag" >"$history_file"; then
  echo "DOCKER_HISTORY_SECRET_SCAN=ERROR"
  exit 1
fi
if grep -Eqi '(password|secret|token|database_url)' "$history_file"; then
  echo "DOCKER_HISTORY_SECRET_SCAN=FAIL"
  exit 1
else
  grep_status=$?
  if [ "$grep_status" -ne 1 ]; then
    echo "DOCKER_HISTORY_SECRET_SCAN=ERROR"
    exit 1
  fi
fi

echo "IMAGE_SENSITIVE_FILE_SCAN=PASS"
echo "DOCKER_HISTORY_SECRET_SCAN=PASS"
