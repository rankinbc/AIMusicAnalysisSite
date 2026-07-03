#!/usr/bin/env bash
# Story 10.1 (AC3/AC4) — the VPS deploy/rollback driver. Lives at
# /opt/spectr/deploy.sh next to compose.prod.yml, .env (chmod 600), and
# .deploy-state (this script's tag pins).
#
#   ./deploy.sh <image-tag>   pin + pull + up + health verify
#                             (auto-rolls back to the previous tag on a
#                             failed health check — NFR29)
#   ./deploy.sh rollback      one command back to the previous image set
#   ./deploy.sh redeploy      re-apply the CURRENT tag (secret rotation:
#                             edit .env, then ./deploy.sh redeploy)
#
# CI invokes `./deploy.sh $GITHUB_SHA` over SSH after pushing images.
set -euo pipefail

cd "$(dirname "$0")"
[ -f .env ] || { echo "!! missing /opt/spectr/.env — see docs/runbook.md first-time setup" >&2; exit 1; }

# Serialize concurrent deploys (two quick merges must not interleave).
exec 9>".deploy.lock"
flock 9

STATE_FILE=".deploy-state"
COMPOSE="docker compose -f compose.prod.yml --env-file .env"
HEALTH_RETRIES="${HEALTH_RETRIES:-60}"   # ×5 s — first boot needs migrations + ACME

current_tag() { sed -n 's/^CURRENT_TAG=//p' "$STATE_FILE" 2>/dev/null || true; }
previous_tag() { sed -n 's/^PREVIOUS_TAG=//p' "$STATE_FILE" 2>/dev/null || true; }
write_state() { printf 'CURRENT_TAG=%s\nPREVIOUS_TAG=%s\n' "$1" "$2" > "$STATE_FILE"; }

apply_tag() {
  local tag="$1"
  echo "==> deploying image tag: $tag"
  IMAGE_TAG="$tag" $COMPOSE pull
  IMAGE_TAG="$tag" $COMPOSE up -d --remove-orphans
}

verify_health() {
  # Review-hardened: probe the BFF DIRECTLY inside the compose network —
  # curling the edge would 308/empty-200 without ever reaching the app
  # (Host mismatch + auto-HTTPS), making the check a permanent false
  # positive. `exec` needs no TLS, no DNS, no published port.
  echo "==> waiting for bff /healthz (${HEALTH_RETRIES}x5s budget)"
  for _ in $(seq 1 "$HEALTH_RETRIES"); do
    if $COMPOSE exec -T bff curl -fsS --max-time 5 http://localhost:5000/healthz 2>/dev/null \
        | grep -q '"status":"ok"'; then
      echo "==> healthy"
      return 0
    fi
    sleep 5
  done
  echo "!! /healthz never reported ok" >&2
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
  redeploy)
    cur="$(current_tag)"
    [ -n "$cur" ] || { echo "!! no current tag recorded — deploy a tag first" >&2; exit 1; }
    apply_tag "$cur"
    verify_health || { echo "!! redeploy unhealthy" >&2; exit 1; }
    ;;
  "")
    echo "usage: deploy.sh <image-tag> | rollback | redeploy" >&2; exit 2 ;;
  *)
    tag="$1"
    prev="$(current_tag)"
    apply_tag "$tag"
    if verify_health; then
      # Same-tag redeploys must not erase the real rollback target.
      if [ "$prev" != "$tag" ]; then
        write_state "$tag" "${prev:-$tag}"
      fi
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
