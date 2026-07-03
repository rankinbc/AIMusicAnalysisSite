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
[ -f .env ] && set -a && . ./.env && set +a

COMPOSE="${COMPOSE:-docker compose -f compose.prod.yml --env-file .env}"
BUCKET="${BUCKET:-${R2_BUCKET:-spectr}}"
S3_ENDPOINT_URL="${S3_ENDPOINT_URL:-${R2_ENDPOINT:-}}"
AWS_KEY="${AWS_KEY:-${R2_BACKUP_ACCESS_KEY:-}}"
AWS_SECRET="${AWS_SECRET:-${R2_BACKUP_SECRET_KEY:-}}"
DOCKER_NET="${DOCKER_NET:-}"   # dev only; prod R2 is public egress
RETENTION_DAYS="${RETENTION_DAYS:-30}"
PGUSER="${PGUSER:-spectr}"
PGDB="${PGDB:-spectr}"

alert() {
  echo "!! backup FAILED: $1" >&2
  if [ -n "${NTFY_URL:-}" ]; then
    curl -fsS -m 10 -H "Title: SPECTR backup failed" -d "$1" "$NTFY_URL" || true
  fi
}
trap 'alert "backup.sh aborted at line $LINENO"' ERR

[ -n "$S3_ENDPOINT_URL" ] || { alert "no S3 endpoint configured"; exit 1; }
[ -n "$AWS_KEY" ] || { alert "no backup credentials (R2_BACKUP_*)"; exit 1; }

STAMP="$(date -u +%Y%m%d-%H%M%S)"
KEY="backups/spectr-${STAMP}.sql.gz"
TMP="$(mktemp /tmp/spectr-backup.XXXXXX.sql.gz)"
trap 'rm -f "$TMP"' EXIT

echo "==> pg_dump → $TMP"
# --clean --if-exists: the restore script replays into a fresh scratch DB
# and a future disaster-restore replays over a rebuilt cluster.
$COMPOSE exec -T postgres pg_dump -U "$PGUSER" --no-owner --clean --if-exists "$PGDB" \
  | gzip > "$TMP"
BYTES=$(wc -c < "$TMP")
# An empty/near-empty dump means pg_dump quietly did nothing useful.
[ "$BYTES" -gt 10240 ] || { alert "dump suspiciously small (${BYTES}B)"; exit 1; }

echo "==> upload s3://$BUCKET/$KEY (${BYTES}B)"
# Streamed via stdin — no volume mount (Windows Git Bash mangles -v paths,
# and the dev-stack test runs there).
docker run --rm -i ${DOCKER_NET:+--network $DOCKER_NET} \
  -e AWS_ACCESS_KEY_ID="$AWS_KEY" -e AWS_SECRET_ACCESS_KEY="$AWS_SECRET" \
  amazon/aws-cli --endpoint-url "$S3_ENDPOINT_URL" \
  s3 cp - "s3://$BUCKET/$KEY" --expected-size "$BYTES" < "$TMP"

# Belt-and-braces prune: the R2 lifecycle rule (runbook checklist) is the
# primary retention control, but "lifecycle rule never configured" is the
# classic silent backup-bloat gotcha — prune here too.
echo "==> pruning objects older than ${RETENTION_DAYS}d"
CUTOFF="$(date -u -d "-${RETENTION_DAYS} days" +%Y%m%d)"
docker run --rm ${DOCKER_NET:+--network $DOCKER_NET} \
  -e AWS_ACCESS_KEY_ID="$AWS_KEY" -e AWS_SECRET_ACCESS_KEY="$AWS_SECRET" \
  amazon/aws-cli --endpoint-url "$S3_ENDPOINT_URL" \
  s3 ls "s3://$BUCKET/backups/" \
  | awk '{print $4}' \
  | while read -r obj; do
      [ -n "$obj" ] || continue
      d="$(printf '%s' "$obj" | sed -n 's/^spectr-\([0-9]\{8\}\)-.*/\1/p')"
      if [ -n "$d" ] && [ "$d" -lt "$CUTOFF" ]; then
        echo "    prune $obj"
        docker run --rm ${DOCKER_NET:+--network $DOCKER_NET} \
          -e AWS_ACCESS_KEY_ID="$AWS_KEY" -e AWS_SECRET_ACCESS_KEY="$AWS_SECRET" \
          amazon/aws-cli --endpoint-url "$S3_ENDPOINT_URL" \
          s3 rm "s3://$BUCKET/backups/$obj"
      fi
    done

echo "==> backup done: s3://$BUCKET/$KEY"
