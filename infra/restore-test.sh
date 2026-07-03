#!/usr/bin/env bash
# Story 10.2 (AC2) — weekly restore PROOF. Fetches the newest dump from R2,
# restores it into a THROWAWAY postgres:16 container (never near prod), and
# asserts the schema + data actually came back. Cron (runbook):
#   30 04 * * 0  cd /opt/spectr && ./restore-test.sh >> restore-test.log 2>&1
#
# Local mode (skip S3, prove a file): bash infra/restore-test.sh --dump x.sql.gz
set -euo pipefail

cd "$(dirname "$0")"

# Literal key extraction — never source the compose-format .env (see
# backup.sh review F1: unquoted `X=A <b@c>` values abort sourcing).
if [ -f .env ]; then
  while IFS='=' read -r k v; do
    case "$k" in
      R2_BACKUP_ACCESS_KEY|R2_BACKUP_SECRET_KEY|R2_ENDPOINT|R2_BUCKET|NTFY_URL|AGE_HOURS_MAX)
        export "$k=$v" ;;
    esac
  done < .env
fi

BUCKET="${BUCKET:-${R2_BUCKET:-spectr}}"
S3_ENDPOINT_URL="${S3_ENDPOINT_URL:-${R2_ENDPOINT:-}}"
export AWS_ACCESS_KEY_ID="${AWS_KEY:-${R2_BACKUP_ACCESS_KEY:-}}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET:-${R2_BACKUP_SECRET_KEY:-}}"
DOCKER_NET="${DOCKER_NET:-}"
COMPOSE="${COMPOSE:-docker compose -f compose.prod.yml --env-file .env}"
# Unique per run — overlapping weekly + manual runs must not kill each other.
SCRATCH="spectr-restore-test-$$"

AWSCLI="docker run --rm ${DOCKER_NET:+--network $DOCKER_NET} \
  -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY \
  amazon/aws-cli --endpoint-url $S3_ENDPOINT_URL"

alert() {
  echo "!! restore test FAILED: $1" >&2
  if [ -n "${NTFY_URL:-}" ]; then
    curl -fsS -m 10 -H "Title: SPECTR restore test failed" -d "$1" "$NTFY_URL" || true
  fi
}
DUMP_TMP=""
# Cleanup on EVERY exit path — an assertion-failure `exit 1` must not leave
# a container holding the full restored database for a week (review F3).
cleanup() { docker rm -f "$SCRATCH" >/dev/null 2>&1 || true; [ -n "$DUMP_TMP" ] && rm -f "$DUMP_TMP" 2>/dev/null || true; }
trap cleanup EXIT
trap 'alert "restore-test.sh aborted at line $LINENO"' ERR

if [ "${1:-}" = "--dump" ]; then
  DUMP_FILE="$2"
else
  [ -n "$S3_ENDPOINT_URL" ] || { alert "no S3 endpoint configured"; exit 1; }
  echo "==> locating newest backup"
  # shellcheck disable=SC2086
  NEWEST="$($AWSCLI s3 ls "s3://$BUCKET/backups/" | awk '{print $4}' \
    | { grep -E '^spectr-[0-9]{8}-[0-9]{6}\.sql\.gz$' || true; } | sort | tail -1)"
  [ -n "$NEWEST" ] || { alert "no well-formed backups found in s3://$BUCKET/backups/"; exit 1; }
  # Staleness gate: newest dump older than AGE_HOURS_MAX means the nightly
  # cron is silently broken — that IS a restore-test failure.
  STAMP="$(printf '%s' "$NEWEST" | sed -n 's/^spectr-\([0-9]\{8\}\)-\([0-9]\{6\}\)\.sql\.gz$/\1 \2/p')"
  [ -n "$STAMP" ] || { alert "cannot parse timestamp from $NEWEST"; exit 1; }
  D="${STAMP% *}"; T="${STAMP#* }"
  NEWEST_EPOCH="$(date -u -d "${D:0:4}-${D:4:2}-${D:6:2} ${T:0:2}:${T:2:2}:${T:4:2} UTC" +%s)"
  AGE_H=$(( ( $(date -u +%s) - NEWEST_EPOCH ) / 3600 ))
  if [ "$AGE_H" -gt "${AGE_HOURS_MAX:-30}" ]; then
    alert "newest backup is ${AGE_H}h old (max ${AGE_HOURS_MAX:-30}h) — nightly cron broken?"
    exit 1
  fi
  echo "==> fetching $NEWEST (age ${AGE_H}h)"
  DUMP_TMP="$(mktemp /tmp/spectr-restore.XXXXXX.sql.gz)"
  # shellcheck disable=SC2086
  $AWSCLI s3 cp "s3://$BUCKET/backups/$NEWEST" - > "$DUMP_TMP"
  DUMP_FILE="$DUMP_TMP"
fi

echo "==> starting scratch postgres:16 ($SCRATCH)"
docker run -d --name "$SCRATCH" -e POSTGRES_PASSWORD=scratch -e POSTGRES_USER=spectr \
  -e POSTGRES_DB=spectr postgres:16-alpine >/dev/null
for _ in $(seq 1 30); do
  docker exec "$SCRATCH" pg_isready -U spectr >/dev/null 2>&1 && break
  sleep 2
done
docker exec "$SCRATCH" pg_isready -U spectr >/dev/null || { alert "scratch postgres never came up"; exit 1; }

echo "==> restoring"
# ON_ERROR_STOP=1: a half-failed restore that still has 20 tables must NOT
# pass — this is a PROOF, not an attempt (review F4). Dumps are
# --clean --if-exists --no-owner and the scratch role is superuser, so no
# benign-error class exists to tolerate.
gunzip -c "$DUMP_FILE" | docker exec -i "$SCRATCH" psql -q -U spectr -d spectr \
  -v ON_ERROR_STOP=1 >/dev/null \
  || { alert "psql replay reported errors — restore NOT clean"; exit 1; }

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

# Decision 3: compare against the LIVE DB's applied migration count when the
# stack is reachable (best-effort — the scratch proof above stands alone).
# Tolerate live = restored + 1 (a deploy may have raced the dump).
set +e
# shellcheck disable=SC2086
LIVE_MIGS="$($COMPOSE exec -T postgres psql -tA -U spectr -d spectr \
  -c 'SELECT count(*) FROM "__EFMigrationsHistory"' 2>/dev/null)"
set -e
if [ -n "${LIVE_MIGS:-}" ]; then
  if [ "$LIVE_MIGS" -gt $(( MIGS + 1 )) ]; then
    alert "restored dump is schema-stale: live=$LIVE_MIGS restored=$MIGS migrations"
    exit 1
  fi
  echo "    live-DB migration parity: live=$LIVE_MIGS restored=$MIGS ✓"
else
  echo "    live DB unreachable — scratch-only proof (fine for --dump mode)"
fi

echo "==> restore test PASSED (migrations=$MIGS tables=$TABLES)"
