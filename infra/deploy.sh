#!/usr/bin/env bash
# Story 10.1 (AC3/AC4) — the VPS deploy/rollback driver. Lives at
# /opt/spectr/deploy.sh next to compose.prod.yml, .env (chmod 600), and
# .deploy-state (this script's tag pins).
#
#   ./deploy.sh <image-tag>   pin + pull + up + /healthz verify
#                             (auto-rolls back to the previous tag on a
#                             failed health check — NFR29)
#   ./deploy.sh rollback      one command back to the previous image set
#
# CI invokes `./deploy.sh $GITHUB_SHA` over SSH after pushing images.
set -euo pipefail

cd "$(dirname "$0")"
STATE_FILE=".deploy-state"
COMPOSE="docker compose -f compose.prod.yml --env-file .env"
HEALTH_URL="${HEALTH_URL:-http://localhost/healthz}"

current_tag() { grep -oP '(?<=^CURRENT_TAG=).*' "$STATE_FILE" 2>/dev/null || true; }
previous_tag() { grep -oP '(?<=^PREVIOUS_TAG=).*' "$STATE_FILE" 2>/dev/null || true; }

write_state() { printf 'CURRENT_TAG=%s\nPREVIOUS_TAG=%s\n' "$1" "$2" > "$STATE_FILE"; }

apply_tag() {
  local tag="$1"
  echo "==> deploying image tag: $tag"
  IMAGE_TAG="$tag" $COMPOSE pull
  IMAGE_TAG="$tag" $COMPOSE up -d --remove-orphans
}

verify_health() {
  echo "==> waiting for /healthz"
  for i in $(seq 1 30); do
    if curl -fsS --max-time 5 "$HEALTH_URL" > /dev/null 2>&1; then
      echo "==> healthy"
      return 0
    fi
    sleep 5
  done
  echo "!! /healthz never came up" >&2
  return 1
}

case "${1:-}" in
  rollback)
    prev="$(previous_tag)"
    [ -n "$prev" ] || { echo "!! no previous tag recorded" >&2; exit 1; }
    echo "==> rolling back to $prev"
    apply_tag "$prev"
    verify_health || { echo "!! rollback target ALSO unhealthy — manual intervention" >&2; exit 1; }
    # Swap pins so a second rollback goes forward again.
    write_state "$prev" "$(current_tag)"
    ;;
  "")
    echo "usage: deploy.sh <image-tag> | rollback" >&2; exit 2 ;;
  *)
    tag="$1"
    prev="$(current_tag)"
    apply_tag "$tag"
    if verify_health; then
      write_state "$tag" "${prev:-$tag}"
    else
      if [ -n "$prev" ] && [ "$prev" != "$tag" ]; then
        echo "!! deploy unhealthy — auto-rolling back to $prev" >&2
        apply_tag "$prev"
        verify_health || echo "!! previous tag also unhealthy" >&2
      fi
      exit 1
    fi
    ;;
esac
echo "==> done"
