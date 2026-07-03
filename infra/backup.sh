#!/usr/bin/env bash
# Story 10.2 (AR31/AC1) — nightly Postgres backup → R2 backups/ prefix.
# Runs from host cron on the VPS (see docs/runbook.md "Backups"):
#   15 03 * * *  cd /opt/spectr && ./backup.sh >> backup.log 2>&1
#
# Requirements: docker only (aws-cli runs dockerized). Reads R2_BACKUP_*
# (+ optional NTFY_URL) from .env — a token scoped to backups/ ONLY: dumps
# contain the ENTIRE database, so the worker/BFF tokens must not read them.
#
# Dev-stack test mode (minio):
#   COMPOSE="docker compose -f docker/docker-compose.yml" \
#   S3_ENDPOINT_URL=http://minio:9000 DOCKER_NET=docker_default \
#   AWS_KEY=minioadmin AWS_SECRET=minioadmin BUCKET=spectr \
#   bash infra/backup.sh
set -euo pipefail

cd "$(dirname "$0")"

# NEVER source the compose-format .env wholesale: unquoted values like
# `RESEND_FROM=SPECTR <noreply@dom>` are shell syntax errors that abort
# sourcing mid-file and silently drop every var below them (review F1).
# Extract only the keys this script needs, literally.
if [ -f .env ]; then
  while IFS='=' read -r k v; do
    case "$k" in
      R2_BACKUP_ACCESS_KEY|R2_BACKUP_SECRET_KEY|R2_ENDPOINT|R2_BUCKET|NTFY_URL|AGE_HOURS_MAX|RETENTION_DAYS)
        export "$k=$v" ;;
    esac
  done < .env
fi

COMPOSE="${COMPOSE:-docker compose -f compose.prod.yml --env-file .env}"
BUCKET="${BUCKET:-${R2_BUCKET:-spectr}}"
S3_ENDPOINT_URL="${S3_ENDPOINT_URL:-${R2_ENDPOINT:-}}"
export AWS_ACCESS_KEY_ID="${AWS_KEY:-${R2_BACKUP_ACCESS_KEY:-}}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET:-${R2_BACKUP_SECRET_KEY:-}}"
DOCKER_NET="${DOCKER_NET:-}"   # dev only; prod R2 is public egress
RETENTION_DAYS="${RETENTION_DAYS:-30}"
PGUSER="${PGUSER:-spectr}"
PGDB="${PGDB:-spectr}"

# Secrets ride the ENVIRONMENT, never docker argv (visible in ps) — name-only
# -e makes docker read the exported values (review F6).
AWSCLI="docker run --rm ${DOCKER_NET:+--network $DOCKER_NET} \
  -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY \
  amazon/aws-cli --endpoint-url $S3_ENDPOINT_URL"

alert() {
  echo "!! backup FAILED: $1" >&2
  if [ -n "${NTFY_URL:-}" ]; then
    curl -fsS -m 10 -H "Title: SPECTR backup failed" -d "$1" "$NTFY_URL" || true
  fi
}
warn() {
  echo "?? backup warning: $1" >&2
  if [ -n "${NTFY_URL:-}" ]; then
    curl -fsS -m 10 -H "Title: SPECTR backup warning" -d "$1" "$NTFY_URL" || true
  fi
}
trap 'alert "backup.sh aborted at line $LINENO"' ERR

[ -n "$S3_ENDPOINT_URL" ] || { alert "no S3 endpoint configured"; exit 1; }
[ -n "$AWS_ACCESS_KEY_ID" ] || { alert "no backup credentials (R2_BACKUP_*)"; exit 1; }

STAMP="$(date -u +%Y%m%d-%H%M%S)"
KEY="backups/spectr-${STAMP}.sql.gz"
TMP="$(mktemp /tmp/spectr-backup.XXXXXX.sql.gz)"
trap 'rm -f "$TMP"' EXIT

echo "==> pg_dump → $TMP"
# --clean --if-exists: the restore script replays into a fresh scratch DB
# and a future disaster-restore replays over a rebuilt cluster.
# shellcheck disable=SC2086  # $COMPOSE is a deliberate multi-word command
$COMPOSE exec -T postgres pg_dump -U "$PGUSER" --no-owner --clean --if-exists "$PGDB" \
  | gzip > "$TMP"
BYTES=$(wc -c < "$TMP")
# An empty/near-empty dump means pg_dump quietly did nothing useful.
[ "$BYTES" -gt 10240 ] || { alert "dump suspiciously small (${BYTES}B)"; exit 1; }

echo "==> upload s3://$BUCKET/$KEY (${BYTES}B)"
# Streamed via stdin — no volume mount (Windows Git Bash mangles -v paths,
# and the dev-stack test runs there).
docker run --rm -i ${DOCKER_NET:+--network $DOCKER_NET} \
  -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY \
  amazon/aws-cli --endpoint-url "$S3_ENDPOINT_URL" \
  s3 cp - "s3://$BUCKET/$KEY" --expected-size "$BYTES" < "$TMP"

# Belt-and-braces prune: the R2 lifecycle rule (runbook checklist) is the
# primary retention control. A prune blip AFTER a successful upload is a
# WARNING, not "backup FAILED" (the backup exists — review F9).
echo "==> pruning objects older than ${RETENTION_DAYS}d"
set +e
(
  set -e
  CUTOFF="$(date -u -d "-${RETENTION_DAYS} days" +%Y%m%d)"
  # shellcheck disable=SC2086
  $AWSCLI s3 ls "s3://$BUCKET/backups/" \
    | awk '{print $4}' \
    | { grep -E '^spectr-[0-9]{8}-[0-9]{6}\.sql\.gz$' || true; } \
    | while read -r obj; do
        d="$(printf '%s' "$obj" | sed -n 's/^spectr-\([0-9]\{8\}\)-.*/\1/p')"
        if [ -n "$d" ] && [ "$d" -lt "$CUTOFF" ]; then
          echo "    prune $obj"
          # shellcheck disable=SC2086
          $AWSCLI s3 rm "s3://$BUCKET/backups/$obj"
        fi
      done
)
PRUNE_RC=$?
set -e
[ "$PRUNE_RC" -eq 0 ] || warn "prune step failed (backup itself SUCCEEDED: $KEY)"

echo "==> backup done: s3://$BUCKET/$KEY"
