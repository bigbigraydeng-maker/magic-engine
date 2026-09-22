-- ============================================================================
-- client_knowledge_confirmation_requests 的约束探针（issue #1646）
--
-- 为什么要这个文件：读 SQL 读得通不等于跑起来是那个行为。本仓库的既有纪律
-- 是「migration 必须在本机 PG 沙盘真跑一遍，再写几条直接打约束的探针」，不
-- 靠看建表语句下结论。
--
-- 用法（沙盘库由 scripts/db-replay-and-verify.sh 重放出来）：
--   export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
--   export LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8
--   DB=me_kb1646_verify bash scripts/db-replay-and-verify.sh
--   psql -d me_kb1646_verify -f scripts/knowledge-confirmation-probes.sql
--
-- 整个脚本跑在一个事务里，最后 ROLLBACK —— 不在沙盘里留任何脏数据。
-- 每条探针打印一行 PASS/FAIL，最后一行汇总。
-- ============================================================================

\set ON_ERROR_STOP off

BEGIN;

CREATE TEMP TABLE probe_results(name text, passed boolean, detail text);

INSERT INTO public.clients (id, name)
VALUES ('11111111-1111-1111-1111-111111111111', 'Probe Client')
ON CONFLICT (id) DO NOTHING;

-- 「这条 SQL 应该被数据库拒绝，而且要拒绝在指定那条约束上」
CREATE OR REPLACE FUNCTION pg_temp.expect_failure(probe_name text, stmt text, expect_fragment text)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE err text;
BEGIN
  BEGIN
    EXECUTE stmt;
    INSERT INTO probe_results VALUES (probe_name, false, '这条本该被数据库拒绝，结果写进去了');
    RETURN;
  EXCEPTION WHEN others THEN
    err := SQLERRM;
  END;
  IF position(expect_fragment in err) > 0 THEN
    INSERT INTO probe_results VALUES (probe_name, true, left(err, 90));
  ELSE
    INSERT INTO probe_results VALUES (probe_name, false, '被拒绝了，但理由不对：' || left(err, 90));
  END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.expect_success(probe_name text, stmt text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE stmt;
  INSERT INTO probe_results VALUES (probe_name, true, 'ok');
EXCEPTION WHEN others THEN
  INSERT INTO probe_results VALUES (probe_name, false, left(SQLERRM, 90));
END;
$fn$;

-- ── 1. 原始令牌写不进去：只有 64 位十六进制才通过 ──────────────────────────
SELECT pg_temp.expect_failure(
  '01 原始令牌（不是 sha256 十六进制）被拒',
  $q$INSERT INTO public.client_knowledge_confirmation_requests
       (client_id, confirmer_email, token_hash, fact_fingerprints, expires_at, created_by_email)
     VALUES ('11111111-1111-1111-1111-111111111111','owner@x.com',
             'Zm9vYmFyLXJhdy10b2tlbi1ub3QtYS1oYXNo',
             '[{"fact_id":"f1","fingerprint":"fp"}]'::jsonb, now() + interval '7 days', 'fde@magicengine.cloud')$q$,
  'token_hash_is_sha256_hex');

-- ── 2. 发起人不能等于收件人（大小写/空格都算同一个人）────────────────────
SELECT pg_temp.expect_failure(
  '02 发起人=收件人 被拒（忽略大小写与空格）',
  $q$INSERT INTO public.client_knowledge_confirmation_requests
       (client_id, confirmer_email, token_hash, fact_fingerprints, expires_at, created_by_email)
     VALUES ('11111111-1111-1111-1111-111111111111','  Owner@X.com ',
             'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
             '[{"fact_id":"f1","fingerprint":"fp"}]'::jsonb, now() + interval '7 days', 'owner@x.com')$q$,
  'sender_is_not_confirmer');

-- ── 3. 有效期必须在未来 ────────────────────────────────────────────────────
SELECT pg_temp.expect_failure(
  '03 有效期不在未来 被拒',
  $q$INSERT INTO public.client_knowledge_confirmation_requests
       (client_id, confirmer_email, token_hash, fact_fingerprints, expires_at, created_by_email)
     VALUES ('11111111-1111-1111-1111-111111111111','owner@x.com',
             'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
             '[{"fact_id":"f1","fingerprint":"fp"}]'::jsonb, now() - interval '1 hour', 'fde@magicengine.cloud')$q$,
  'expiry_in_future');

-- ── 4. 空批次被拒 ──────────────────────────────────────────────────────────
SELECT pg_temp.expect_failure(
  '04 空批次 被拒',
  $q$INSERT INTO public.client_knowledge_confirmation_requests
       (client_id, confirmer_email, token_hash, fact_fingerprints, expires_at, created_by_email)
     VALUES ('11111111-1111-1111-1111-111111111111','owner@x.com',
             'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
             '[]'::jsonb, now() + interval '7 days', 'fde@magicengine.cloud')$q$,
  'batch_not_empty');

-- ── 5. 终态必须有 confirmed_at ────────────────────────────────────────────
SELECT pg_temp.expect_failure(
  '05 status=confirmed 却没有 confirmed_at 被拒',
  $q$INSERT INTO public.client_knowledge_confirmation_requests
       (client_id, confirmer_email, token_hash, fact_fingerprints, expires_at, created_by_email, status)
     VALUES ('11111111-1111-1111-1111-111111111111','owner@x.com',
             'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
             '[{"fact_id":"f1","fingerprint":"fp"}]'::jsonb, now() + interval '7 days', 'fde@magicengine.cloud', 'confirmed')$q$,
  'confirmed_at_pairing');

-- ── 6. 对照组：合法请求写得进去（证明上面几条不是因为别的原因失败）────────
SELECT pg_temp.expect_success(
  '06 对照组：合法请求写得进去',
  $q$INSERT INTO public.client_knowledge_confirmation_requests
       (id, client_id, confirmer_email, token_hash, fact_fingerprints, expires_at, created_by_email)
     VALUES ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','owner@x.com',
             'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
             '[{"fact_id":"f1","fingerprint":"fp"}]'::jsonb, now() + interval '7 days', 'fde@magicengine.cloud')$q$);

-- ── 7. 令牌哈希全局唯一 ────────────────────────────────────────────────────
SELECT pg_temp.expect_failure(
  '07 同一个令牌哈希用在第二条请求上 被拒',
  $q$INSERT INTO public.client_knowledge_confirmation_requests
       (client_id, confirmer_email, token_hash, fact_fingerprints, expires_at, created_by_email)
     VALUES ('11111111-1111-1111-1111-111111111111','owner2@x.com',
             'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
             '[{"fact_id":"f2","fingerprint":"fp"}]'::jsonb, now() + interval '7 days', 'fde@magicengine.cloud')$q$,
  'uq_client_knowledge_confirmation_requests_token');

-- ── 8. 单次使用：WHERE status='pending' 的条件更新只有第一次改得到行 ───────
DO $$
DECLARE n1 int; n2 int;
BEGIN
  WITH claimed AS (
    UPDATE public.client_knowledge_confirmation_requests
       SET status = 'confirmed', confirmed_at = now(), outcome = '{"confirmed_fact_ids":["f1"]}'::jsonb
     WHERE id = '22222222-2222-2222-2222-222222222222' AND status = 'pending'
     RETURNING id
  ) SELECT count(*) INTO n1 FROM claimed;

  WITH claimed AS (
    UPDATE public.client_knowledge_confirmation_requests
       SET status = 'confirmed', confirmed_at = now()
     WHERE id = '22222222-2222-2222-2222-222222222222' AND status = 'pending'
     RETURNING id
  ) SELECT count(*) INTO n2 FROM claimed;

  INSERT INTO probe_results VALUES (
    '08 单次使用：第一次改到 1 行、第二次改到 0 行',
    n1 = 1 AND n2 = 0,
    format('第一次 %s 行，第二次 %s 行', n1, n2));
END $$;

-- ── 9. 终态不许再改状态（append-only 触发器）──────────────────────────────
SELECT pg_temp.expect_failure(
  '09 已确认的请求改回 pending 被拒',
  $q$UPDATE public.client_knowledge_confirmation_requests
        SET status = 'pending', confirmed_at = NULL
      WHERE id = '22222222-2222-2222-2222-222222222222'$q$,
  'cannot change state again');

-- ── 10. 终态之后仍可以补写 outcome（不改状态就不该被挡）────────────────────
SELECT pg_temp.expect_success(
  '10 终态之后补写 outcome 允许',
  $q$UPDATE public.client_knowledge_confirmation_requests
        SET outcome = '{"confirmed_fact_ids":["f1"],"stale_fact_ids":[]}'::jsonb
      WHERE id = '22222222-2222-2222-2222-222222222222'$q$);

-- ── 11/12. 令牌与批次发出之后不可改 ───────────────────────────────────────
SELECT pg_temp.expect_failure(
  '11 改令牌哈希 被拒',
  $q$UPDATE public.client_knowledge_confirmation_requests
        SET token_hash = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
      WHERE id = '22222222-2222-2222-2222-222222222222'$q$,
  'immutable after the link is issued');

SELECT pg_temp.expect_failure(
  '12 改批次内容 被拒',
  $q$UPDATE public.client_knowledge_confirmation_requests
        SET fact_fingerprints = '[{"fact_id":"f9","fingerprint":"other"}]'::jsonb
      WHERE id = '22222222-2222-2222-2222-222222222222'$q$,
  'immutable after the link is issued');

-- ── 13/14. RLS：anon / authenticated 一行都读不到 ─────────────────────────
DO $$
DECLARE visible int;
BEGIN
  SET LOCAL ROLE anon;
  SELECT count(*) INTO visible FROM public.client_knowledge_confirmation_requests;
  RESET ROLE;
  INSERT INTO probe_results VALUES ('13 anon 一行都读不到', visible = 0, format('看到 %s 行', visible));
EXCEPTION WHEN insufficient_privilege THEN
  RESET ROLE;
  INSERT INTO probe_results VALUES ('13 anon 一行都读不到', true, '连表级权限都没有（比 RLS 更严）');
END $$;

DO $$
DECLARE visible int;
BEGIN
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO visible FROM public.client_knowledge_confirmation_requests;
  RESET ROLE;
  INSERT INTO probe_results VALUES ('14 authenticated 一行都读不到', visible = 0, format('看到 %s 行', visible));
EXCEPTION WHEN insufficient_privilege THEN
  RESET ROLE;
  INSERT INTO probe_results VALUES ('14 authenticated 一行都读不到', true, '连表级权限都没有（比 RLS 更严）');
END $$;

-- ── 15. 对照组：表里确实有行。没有这一条，13/14 的「0 行」可能只是因为表是空的。
DO $$
DECLARE total int;
BEGIN
  SELECT count(*) INTO total FROM public.client_knowledge_confirmation_requests;
  INSERT INTO probe_results VALUES ('15 对照组：表里确实有行（所以 13/14 的 0 行是 RLS 挡的）', total > 0, format('共 %s 行', total));
END $$;

-- ── 16. 这张表真的开了 RLS，而且策略只给 service_role ─────────────────────
DO $$
DECLARE rls_on boolean; roles text;
BEGIN
  SELECT relrowsecurity INTO rls_on FROM pg_class WHERE oid = 'public.client_knowledge_confirmation_requests'::regclass;
  SELECT string_agg(array_to_string(polroles::regrole[], ','), ' | ') INTO roles
    FROM pg_policy WHERE polrelid = 'public.client_knowledge_confirmation_requests'::regclass;
  INSERT INTO probe_results VALUES (
    '16 RLS 已开启且策略只写给 service_role（漏写 TO 会变成对匿名访客敞开）',
    rls_on AND roles = 'service_role',
    format('rls=%s roles=%s', rls_on, roles));
END $$;

-- ── 结果 ───────────────────────────────────────────────────────────────────
SELECT CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS result, name, detail
  FROM probe_results ORDER BY name;
SELECT count(*) FILTER (WHERE passed) AS passed, count(*) FILTER (WHERE NOT passed) AS failed FROM probe_results;

ROLLBACK;
