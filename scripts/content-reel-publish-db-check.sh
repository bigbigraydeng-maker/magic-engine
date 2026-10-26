#!/bin/bash
# =============================================================================
# Real-Postgres verification for the content Reel publish data layer (PR-A).
#
#   1. replay every migration into a throwaway DB + repo security invariants
#      (scripts/db-replay-and-verify.sh)            [skipped when DB_PREPARED=1]
#   2. behaviour probes (scripts/content-reel-publish-probes.sql, rolled back)
#   3. rollback script on an empty data set (inside a transaction, rolled back)
#   4. two-session concurrency: double authorise, claim vs cancel,
#      same video hash on two different posts
#   5. rollback pre-checks (in-flight attempt / live switch on) and rollback with
#      data present (tables must be kept)
#
# Usage (local brew postgresql@17):  bash scripts/content-reel-publish-db-check.sh
# Any failed assertion exits non-zero. KEEP_DB=1 keeps the database afterwards.
# DB_PREPARED=1 runs steps 2–5 against an already-migrated $DB (mutation runs).
# =============================================================================
set -euo pipefail
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
export LC_ALL="${LC_ALL:-en_US.UTF-8}" LANG="${LANG:-en_US.UTF-8}"
export DB="${DB:-me_content_reel_check}"

if [ "${KEEP_DB:-0}" != "1" ]; then
  trap 'dropdb --if-exists "$DB" 2>/dev/null || true' EXIT
fi

fail() { echo "❌ $*"; exit 1; }
Q() { psql -v ON_ERROR_STOP=1 -X -q -At -d "$DB" "$@"; }

if [ "${DB_PREPARED:-0}" = "1" ]; then
  echo "==> 1/5 replay skipped (DB_PREPARED=1, using $DB)"
else
  echo "==> 1/5 replay migrations + security invariants"
  bash scripts/db-replay-and-verify.sh
fi

echo "==> 2/5 behaviour probes"
if ! psql -X -q -d "$DB" -f scripts/content-reel-publish-probes.sql; then
  fail "behaviour probes failed (see FAIL rows above)"
fi

echo "==> 3/5 rollback on empty data (in a transaction, then ROLLBACK)"
out=$(psql -v ON_ERROR_STOP=1 -X -q -At -d "$DB" \
  -c "BEGIN" \
  -f scripts/content-reel-publish-rollback.sql \
  -c "SELECT to_regclass('public.content_reel_publish_attempts') IS NULL
           AND to_regclass('public.content_reel_video_copies') IS NULL
           AND to_regclass('public.content_reel_live_switch_events') IS NULL
           AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname LIKE 'content_reel_%' OR proname IN ('set_content_reel_live_enabled','clients_content_reel_live_guard'))
           AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'clients_content_reel_live_guard')
           AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='clients' AND column_name='content_reel_live_enabled')
           AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='content_posts' AND column_name='import_source_url')" \
  -c "ROLLBACK" 2>&1)
echo "$out" | grep -qx 't' || fail "rollback on empty data did not remove every object: $out"
echo "    PASS rollback (empty) removes tables, functions, triggers, columns"

echo "==> 4/5 concurrency"
HASH_AB=abababababababababababababababababababababababababababababababab
HASH_CD=cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd
Q <<SQL
INSERT INTO public.clients (id, name) VALUES ('c2000000-0000-0000-0000-000000000001', 'Concurrency Client');
INSERT INTO public.content_posts (id, client_id, title, route, platforms, status, source_video_url) VALUES
  ('a2000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000001', 'CC1', 'route_a', '{}', 'approved', 'https://x/cc1.mp4'),
  ('a2000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000001', 'CC2', 'route_a', '{}', 'approved', 'https://x/cc2.mp4'),
  ('a2000000-0000-0000-0000-000000000003', 'c2000000-0000-0000-0000-000000000001', 'CC3', 'route_a', '{}', 'approved', 'https://x/cc3.mp4');
SELECT public.content_reel_video_copy_start('b2000000-0000-0000-0000-000000000001','c2000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001','https://x/cc1.mp4','cf/c2/cc1.mp4','e1000000-0000-0000-0000-000000000001','agent');
SELECT public.content_reel_video_copy_finish('b2000000-0000-0000-0000-000000000001','ready','$HASH_AB',1000,NULL);
SELECT public.content_reel_video_copy_start('b2000000-0000-0000-0000-000000000002','c2000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000002','https://x/cc2.mp4','cf/c2/cc2.mp4','e1000000-0000-0000-0000-000000000001','agent');
SELECT public.content_reel_video_copy_finish('b2000000-0000-0000-0000-000000000002','ready','$HASH_CD',1000,NULL);
SELECT public.content_reel_video_copy_start('b2000000-0000-0000-0000-000000000003','c2000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000003','https://x/cc3.mp4','cf/c2/cc3.mp4','e1000000-0000-0000-0000-000000000001','agent');
SELECT public.content_reel_video_copy_finish('b2000000-0000-0000-0000-000000000003','ready','$HASH_CD',1000,NULL);
SQL

auth_sql() { # $1 attempt id, $2 post suffix, $3 hash, $4 form hash char
  printf "SELECT public.content_reel_authorize('%s','c2000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-00000000000%s','b2000000-0000-0000-0000-00000000000%s',NULL,'live','%s','ui_click','e1000000-0000-0000-0000-000000000001','staff@example.com','human','{}','%s','1616575215312482')" \
    "$1" "$2" "$2" "$(printf "$4%.0s" $(seq 1 64))" "$3"
}

TMP=$(mktemp -d)
Q -c "BEGIN" -c "$(auth_sql d2000000-0000-0000-0000-000000000001 1 $HASH_AB 1)" -c "SELECT pg_sleep(2)" -c "COMMIT" > "$TMP/a1" &
sleep 0.5
Q -c "$(auth_sql d2000000-0000-0000-0000-000000000002 1 $HASH_AB 2)" > "$TMP/b1"
wait
grep -q '"ok": true' "$TMP/a1" || fail "session A authorise did not succeed: $(cat "$TMP/a1")"
grep -Eq '"code": "(post_state_changed|active_attempt_exists)"' "$TMP/b1" || fail "concurrent authorise was not refused: $(cat "$TMP/b1")"
[ "$(Q -c "SELECT count(*) FROM public.content_reel_publish_attempts WHERE content_post_id='a2000000-0000-0000-0000-000000000001'")" = "1" ] \
  || fail "concurrent authorise produced more than one attempt"
echo "    PASS concurrent authorise on one post: one wins, the other gets $(grep -Eo '"code": "[a-z_]+"' "$TMP/b1")"

Q -c "BEGIN" -c "SELECT public.content_reel_transition('d2000000-0000-0000-0000-000000000001', ARRAY['authorized'], 'claimed', '{\"touch_last_step\":true}')" -c "SELECT pg_sleep(2)" -c "COMMIT" > "$TMP/a2" &
sleep 0.5
Q -c "SELECT public.content_reel_transition('d2000000-0000-0000-0000-000000000001', ARRAY['authorized'], 'cancelled', '{}')" > "$TMP/b2"
wait
grep -q '"ok": true' "$TMP/a2" || fail "claim did not succeed: $(cat "$TMP/a2")"
grep -q '"code": "transition_lost"' "$TMP/b2" || fail "cancel racing a claim was not refused: $(cat "$TMP/b2")"
[ "$(Q -c "SELECT state FROM public.content_reel_publish_attempts WHERE id='d2000000-0000-0000-0000-000000000001'")" = "claimed" ] \
  || fail "claim vs cancel left a wrong state"
echo "    PASS claim vs cancel: claim wins, cancel gets transition_lost"

Q -c "BEGIN" -c "$(auth_sql d2000000-0000-0000-0000-000000000003 2 $HASH_CD 3)" -c "SELECT pg_sleep(2)" -c "COMMIT" > "$TMP/a3" &
sleep 0.5
Q -c "$(auth_sql d2000000-0000-0000-0000-000000000004 3 $HASH_CD 4)" > "$TMP/b3"
wait
grep -q '"ok": true' "$TMP/a3" || fail "same-hash session A did not succeed: $(cat "$TMP/a3")"
grep -q '"code": "duplicate_content_hash"' "$TMP/b3" || fail "same video hash on another post was not serialised (M4): $(cat "$TMP/b3")"
[ "$(Q -c "SELECT count(*) FROM public.content_reel_publish_attempts WHERE video_sha256='$HASH_CD'")" = "1" ] \
  || fail "same-hash concurrent authorise produced two attempts"
echo "    PASS same video hash on two posts at once: one wins, the other gets duplicate_content_hash"
rm -rf "$TMP"

echo "==> 5/5 rollback pre-checks and rollback with data present"
out=$(psql -v ON_ERROR_STOP=1 -X -q -At -d "$DB" -1 -f scripts/content-reel-publish-rollback.sql 2>&1 || true)
echo "$out" | grep -q 'attempts still in flight' || fail "rollback did not refuse while attempts are in flight: $out"
[ "$(Q -c "SELECT count(*) FROM pg_proc WHERE proname='content_reel_transition'")" = "1" ] || fail "refused rollback still dropped functions"
echo "    PASS rollback refuses while an attempt is in flight (nothing dropped)"

Q -c "SELECT public.content_reel_transition('d2000000-0000-0000-0000-000000000001', ARRAY['claimed'], 'preflight_failed', '{}')" > /dev/null
Q -c "SELECT public.content_reel_transition('d2000000-0000-0000-0000-000000000003', ARRAY['authorized'], 'cancelled', '{}')" > /dev/null
Q -c "SELECT public.set_content_reel_live_enabled('c2000000-0000-0000-0000-000000000001', false, true, 'e1000000-0000-0000-0000-000000000001', 'staff@example.com', 'check')" > /dev/null
out=$(psql -v ON_ERROR_STOP=1 -X -q -At -d "$DB" -1 -f scripts/content-reel-publish-rollback.sql 2>&1 || true)
echo "$out" | grep -q 'content_reel_live_enabled=true' || fail "rollback did not refuse while a live switch is on: $out"
echo "    PASS rollback refuses while a client live switch is on"
Q -c "SELECT public.set_content_reel_live_enabled('c2000000-0000-0000-0000-000000000001', true, false, 'e1000000-0000-0000-0000-000000000001', 'staff@example.com', 'check')" > /dev/null

psql -v ON_ERROR_STOP=1 -X -q -d "$DB" -1 -f scripts/content-reel-publish-rollback.sql
[ "$(Q -c "SELECT to_regclass('public.content_reel_publish_attempts') IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'content_reel_transition')
             AND (SELECT count(*) FROM public.content_reel_publish_attempts) = 2
             AND (SELECT count(*) FROM public.content_reel_live_switch_events) = 2")" = "t" ] \
  || fail "rollback with data did not keep tables / drop RPCs"
echo "    PASS rollback (with data) keeps tables and rows, drops RPCs"

echo ""
echo "✅ content Reel publish data layer: replay + probes + rollback + concurrency all passed"
