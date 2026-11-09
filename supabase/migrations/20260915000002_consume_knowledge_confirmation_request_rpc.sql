-- ============================================================================
-- Client Knowledge Base — issue #1646 复审修复：客户确认的"半失败"漂移
--
-- 子牙 + 魏征两份独立复审都抓到同一个真问题：`consumeConfirmationRequest`
-- 原来是"先 UPDATE 确认请求表把状态改成 confirmed/rejected，再逐条 UPDATE
-- client_knowledge_facts"——两步分开的 JS 语句，中间任何一次网络抖动/连接
-- 中断都会让请求表已经落成终态，但事实表只写了一部分。此时：
--   · 客户看到的提示是"没有保存成功，请重新点开链接"；
--   · 重新点开链接却看到"这批内容已经确认过了"——两句话互相矛盾；
--   · 没有任何代码会去比对 outcome.confirmed_fact_ids 和
--     client_knowledge_facts.client_confirmed_at 是否对得上，这个不一致会
--     一直躺在库里直到有人手工去查。
--
-- 修法：把"claim 请求 + 写每条事实"收进同一个 Postgres 函数，一次调用 =
-- 一个事务。函数内任何一步失败，Postgres 自动整体回滚——请求表留在
-- pending，一条事实都不会被部分写上，跟没发生过这次提交一样，客户重新点
-- 链接就能真的重试，不会撞上"已确认"的假墙。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.consume_knowledge_confirmation_request(
  p_request_id     UUID,
  p_client_id      UUID,
  p_confirmer_email TEXT,
  p_final_status   TEXT,
  p_confirmed_at    TIMESTAMPTZ,
  p_outcome         JSONB,
  -- [{ "fact_id": "<uuid>", "fingerprint": "<computeContentFingerprint() 值>" }, ...]
  p_confirmed       JSONB,
  -- [{ "fact_id": "<uuid>", "note": "<客户写的原因，可为 null>" }, ...]
  p_rejected        JSONB
)
RETURNS TABLE (claimed BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claimed_id UUID;
  v_item       JSONB;
BEGIN
  IF p_final_status NOT IN ('confirmed', 'rejected') THEN
    RAISE EXCEPTION 'consume_knowledge_confirmation_request: p_final_status must be confirmed or rejected (got %)', p_final_status;
  END IF;

  -- 单次使用的核心保证：只有 pending 状态才能被 claim。并发下两个提交同时
  -- 跑到这里，Postgres 的行锁保证只有一个能把 v_claimed_id 拿到非空值。
  UPDATE client_knowledge_confirmation_requests
     SET status       = p_final_status,
         confirmed_at = p_confirmed_at,
         outcome      = p_outcome
   WHERE id = p_request_id
     AND status = 'pending'
  RETURNING id INTO v_claimed_id;

  IF v_claimed_id IS NULL THEN
    -- 已经被别人（或另一个浏览器标签）抢先提交过——不写任何事实，原样返回。
    RETURN QUERY SELECT FALSE;
    RETURN;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_confirmed, '[]'::jsonb))
  LOOP
    UPDATE client_knowledge_facts
       SET client_confirmed_by_email    = p_confirmer_email,
           client_confirmed_at          = p_confirmed_at,
           client_confirmed_fingerprint = (v_item->>'fingerprint'),
           -- 客户这次说"对"，把上一轮"需要修改"的留言清掉，免得记录自相矛盾。
           client_rejection_note        = NULL
     WHERE id = (v_item->>'fact_id')::UUID
       AND client_id = p_client_id
       AND status = 'approved'
       -- 已经确认过的不再重复写——双提交时第二次是空操作，不是覆盖。
       AND client_confirmed_at IS NULL;
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_rejected, '[]'::jsonb))
  LOOP
    UPDATE client_knowledge_facts
       SET client_rejection_note = COALESCE(NULLIF(v_item->>'note', ''), '客户表示需要修改，未写原因')
     WHERE id = (v_item->>'fact_id')::UUID
       AND client_id = p_client_id
       AND status = 'approved';
  END LOOP;

  RETURN QUERY SELECT TRUE;
END;
$$;

COMMENT ON FUNCTION public.consume_knowledge_confirmation_request(UUID, UUID, TEXT, TEXT, TIMESTAMPTZ, JSONB, JSONB, JSONB) IS
  'Issue #1646 复审修复 — 原子化"claim 确认请求 + 写每条事实的客户确认结果"，
   替换掉 JS 里分两步写的旧路径。任何一步失败，Postgres 把整个函数调用当一个
   事务回滚：请求表留在 pending，事实表一条都不会被部分写上，不会再出现
   "已确认但没写全"的中间态。';

-- 🔴 REVOKE 必须显式带 anon/authenticated——Supabase 建库时给 public schema
-- 下的新函数默认授予 anon/authenticated EXECUTE（ALTER DEFAULT PRIVILEGES），
-- 只写 `FROM PUBLIC` 收不掉这两条独立授权（2026-09-03 #1325 的教训，见
-- 20260903000001_ticket1325_revoke_security_definer_execute.sql）。
REVOKE EXECUTE ON FUNCTION public.consume_knowledge_confirmation_request(UUID, UUID, TEXT, TEXT, TIMESTAMPTZ, JSONB, JSONB, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_knowledge_confirmation_request(UUID, UUID, TEXT, TEXT, TIMESTAMPTZ, JSONB, JSONB, JSONB)
  TO service_role;
