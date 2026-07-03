#!/usr/bin/env bash
# Story 10.2 (AC2) — weekly restore PROOF. Fetches the newest dump from R2,
# restores it into a THROWAWAY postgres:16 container (never near prod), and
# asserts the schema + data actually came back. Cron (runbook):
#   30 04 * * 0  cd /opt/spectr && ./restore-test.sh >> restore-test.log 2>&1
#
# Local mode (skip S3, prove a file): bash infra/restore-test.sh --dump x.sql.gz
set -euo pipefail

cd "$(dirname "$0")"
[ -f .env ] && set -a && . ./.env && set +a

BUCKET="${BUCKET:-${R2_BUCKET:-spectr}}"
S3_ENDPOINT_URL="${S3_ENDPOINT_URL:-${R2_ENDPOINT:-}}"
AWS_KEY="${AWS_KEY:-${R2_BACKUP_ACCESS_KEY:-}}"
AWS_SECRET="${AWS_SECRET:-${R2_BACKUP_SECRET_KEY:-}}"
DOCKER_NET="${DOCKER_NET:-}"
SCRATCH="spectr-restore-test"

alert() {
  echo "!! restore test FAILED: $1" >&2
  if [ -n "${NTFY_URL:-}" ]; then
    curl -fsS -m 10 -H "Title: SPECTR restore test failed" -d "$1" "$NTFY_URL" || true
  fi
}
cleanup() { docker rm -f "$SCRATCH" >/dev/null 2>&1 || true; rm -f "$DUMP_TMP" 2>/dev/null || true; }
trap 'alert "restore-test.sh aborted at line $LINENO"; cleanup' ERR

DUMP_TMP=""
if [ "${1:-}" = "--dump" ]; then
  DUMP_FILE="$2"
else
  [ -n "$S3_ENDPOINT_URL" ] || { alert "no S3 endpoint configured"; exit 1; }
  echo "==> locating newest backup"
  NEWEST="$(docker run --rm ${DOCKER_NET:+--network $DOCKER_NET} \
    -e AWS_ACCESS_KEY_ID="$AWS_KEY" -e AWS_SECRET_ACCESS_KEY="$AWS_SECRET" \
    amazon/aws-cli --endpoint-url "$S3_ENDPOINT_URL" \
    s3 ls "s3://$BUCKET/backups/" | awk '{print $4}' | sort | tail -1)"
  [ -n "$NEWEST" ] || { alert "no backups found in s3://$BUCKET/backups/"; exit 1; }
  # Staleness gate: newest dump older than AGE_HOURS_MAX means the nightly
  # cron is silently broken — that IS a restore-test failure.
  STAMP="$(printf '%s' "$NEWEST" | sed -n 's/^spectr-\([0-9]\{8\}\)-\([0-9]\{6\}\)\.sql\.gz$/\1 \2/p')"
  if [ -n "$STAMP" ]; then
    D="${STAMP% *}"; T="${STAMP#* }"
    NEWEST_EPOCH="$(date -u -d "${D:0:4}-${D:4:2}-${D:6:2} ${T:0:2}:${T:2:2}:${T:4:2}" +%s)"
    AGE_H=$(( ( $(date -u +%s) - NEWEST_EPOCH ) / 3600 ))
    if [ "$AGE_H" -gt "${AGE_HOURS_MAX:-30}" ]; then
      alert "newest backup is ${AGE_H}h old (max ${AGE_HOURS_MAX:-30}h) — nightly cron broken?"
      exit 1
    fi
  fi
  echo "==> fetching $NEWEST"
  DUMP_TMP="$(mktemp /tmp/spectr-restore.XXXXXX.sql.gz)"
  docker run --rm ${DOCKER_NET:+--network $DOCKER_NET} \
    -e AWS_ACCESS_KEY_ID="$AWS_KEY" -e AWS_SECRET_ACCESS_KEY="$AWS_SECRET" \
    amazon/aws-cli --endpoint-url "$S3_ENDPOINT_URL" \
    s3 cp "s3://$BUCKET/backups/$NEWEST" - > "$DUMP_TMP"
  DUMP_FILE="$DUMP_TMP"
fi

echo "==> starting scratch postgres:16"
docker rm -f "$SCRATCH" >/dev/null 2>&1 || true
docker run -d --name "$SCRATCH" -e POSTGRES_PASSWORD=scratch -e POSTGRES_USER=spectr \
  -e POSTGRES_DB=spectr postgres:16-alpine >/dev/null
for _ in $(seq 1 30); do
  docker exec "$SCRATCH" pg_isready -U spectr >/dev/null 2>&1 && break
  sleep 2
done
docker exec "$SCRATCH" pg_isready -U spectr >/dev/null || { alert "scratch postgres never came up"; exit 1; }

echo "==> restoring"
gunzip -c "$DUMP_FILE" | docker exec -i "$SCRATCH" psql -q -U spectr -d spectr \
  -v ON_ERROR_STOP=0 >/dev/null

echo "==> sanity assertions"
MIGS="$(docker exec "$SCRATCH" psql -tA -U spectr -d spectr \
  -c 'SELECT count(*) FROM "__EFMigrationsHistory"')"
USERS_OK="$(docker exec "$SCRATCH" psql -tA -U spectr -d spectr \
  -c "SELECT count(*) >= 0 FROM users")"
TABLES="$(docker exec "$SCRATCH" psql -tA -U spectr -d spectr \
  -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"
echo "    migrations rows: $MIGS; tables: $TABLES; users queryable: $USERS_OK"
[ "${MIGS:-0}" -ge 1 ] || { alert "restored DB has no EF migration history"; exit 1; }
[ "${TABLES:-0}" -ge 20 ] || { alert "restored DB has only ${TABLES} tables"; exit 1; }
[ "$USERS_OK" = "t" ] || { alert "users table not queryable after restore"; exit 1; }

cleanup
echo "==> restore test PASSED (migrations=$MIGS tables=$TABLES)"
