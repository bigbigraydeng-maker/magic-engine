-- ============================================================================
-- Client Knowledge Base — step 4/6 (Issue #1646)：客户确认链接的存储层
--
-- 为什么需要这张表（不是"把令牌塞进 client_knowledge_facts 某一列"）：
--   双签的第二道闸是"客户本人确认"。客户的联系人**没有** dashboard 登录态
--   （design doc §9.4 / 板桥 1：客户员工不该为了点一次"对"去注册账号），
--   所以确认动作只能走"发到登记邮箱的一次性签名链接"。一次性链接天然是
--   一个**独立的生命周期对象**：它有自己的有效期、自己的单次使用状态、
--   自己绑定的那一批条目、自己的发起人。挂在事实行上放不下这些，也无法
--   表达"同一条事实先后发过两次确认链接"。
--
-- 🔴 只存哈希，绝不存原始令牌（design doc §9.14 B "库里只存随机令牌哈希"）：
--   原始令牌只在两个地方存在——收件人邮箱里的那条 URL，和内存里那一瞬间。
--   数据库被读走（备份泄露、只读账号被盗）不等于别人能替客户签字。
--   `token_hash_is_sha256_hex` 这条 CHECK 是这条规则的**结构化执法**：
--   任何试图直接写入原始令牌的代码路径（base64url 随机串几乎不可能刚好是
--   64 位十六进制）会被数据库当场拒绝，而不是悄悄存进去。
--
-- 🔴 为什么要记"发链接那一刻每条事实的指纹"（design doc §9.5）：
--   链接发出后、客户点确认前，FDE 可能改了其中一条的价格。如果不记下发
--   链接时的指纹，客户点的"确认"会盖在**他没看过的新内容**上——这正是双
--   签要防的事。指纹对不上 = 这条从本次确认里剔除，需要重发一条新链接。
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.client_knowledge_confirmation_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,

  -- 收件人 = 该客户在 client_knowledge_confirmers 里登记过的确认人邮箱。
  -- 这里存一份快照（而不是只存 confirmer 表的外键）是故意的：链接是发给
  -- "当时那个邮箱"的，事后撤销登记不应该让历史回执变得无法解释。**但**
  -- 消费链接时仍然要重新查一次登记表——快照只用于审计和发回执，不构成
  -- 授权依据。
  confirmer_email    text NOT NULL,

  -- sha256(raw token) 的十六进制小写。见文件头部为什么必须是哈希。
  token_hash         text NOT NULL,

  -- 这一批条目 + 发链接那一刻每条的内容指纹：
  --   [{ "fact_id": "<uuid>", "fingerprint": "<computeContentFingerprint()>" }, ...]
  -- 不做成子表：它是**不可变的快照**，从不被单独查询/更新，只在消费链接
  -- 时整体读出来比对一次。建子表只会多一张需要自己维护一致性的表。
  fact_fingerprints  jsonb NOT NULL,

  -- 🔴 `expired` / `superseded` 是这张表**预留**的两个终态，目前没有任何代码
  --    路径会真的把它们写进去（过期判定始终是运行时算的——见 gateRequest，
  --    从不落库；"重发新链接时把旧链接标记掉"也还没实现）。子牙复审
  --    2026-09-14 确认这不是安全缺口（旧的 pending 链接被消费时，身份/指纹/
  --    终态检查都还在），但如果将来有人指望这两个值真的会出现（比如做一个
  --    "待处理确认链接"列表页），会踩空——留这条注释，免得下次看代码的人
  --    以为"声明了 = 已经接上了"。
  status             text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','confirmed','rejected','expired','superseded')),

  expires_at         timestamptz NOT NULL,
  confirmed_at       timestamptz,

  -- 消费结果明细（哪些确认了 / 哪些被客户驳回 / 哪些因为指纹漂移被剔除）。
  -- 给回执邮件和事后排查用；不是授权依据。
  outcome            jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at         timestamptz NOT NULL DEFAULT now(),
  -- 触发发送的 ME 侧身份（登录态邮箱）。跟 confirmer_email 必须不是同一个
  -- 人——见下方 CHECK。
  created_by_email   text NOT NULL,

  -- 令牌必须是哈希，不是原文。见文件头部。
  CONSTRAINT token_hash_is_sha256_hex CHECK (token_hash ~ '^[0-9a-f]{64}$'),

  -- 有效期必须真的在未来，否则这条链接生下来就是废的，只会让客户点开看到
  -- "已过期"然后来问人——"忘了设有效期"和"故意设成 0"永远不能长得一样。
  CONSTRAINT confirmation_request_expiry_in_future CHECK (expires_at > created_at),

  -- 终态（客户真的点过按钮）必须留下时间戳；未终态不许挂一个 confirmed_at
  -- 误导排查。'expired'/'superseded' 是**系统**判定的状态，不是客户动作，
  -- 所以不要求 confirmed_at。
  CONSTRAINT confirmation_request_confirmed_at_pairing
    CHECK ((status IN ('confirmed','rejected')) = (confirmed_at IS NOT NULL)),

  -- 空批次的链接没有任何意义，只会让客户点开看到一张空白页。
  CONSTRAINT confirmation_request_batch_not_empty CHECK (
    jsonb_typeof(fact_fingerprints) = 'array' AND jsonb_array_length(fact_fingerprints) > 0
  ),

  -- 🔴 职责分离的第一道（写入层）闸：发链接的 ME 侧人员不能同时是收件人。
  --    比较标准跟 read.ts / confirmers.ts / facts 表的 approver_confirmer_differ
  --    完全一致——先 trim 再 lower，否则一个带尾随空格的邮箱能同时躲过所有
  --    比较（2026-09-14 狄仁杰攻击验证实测过的真实绕过手法）。
  CONSTRAINT confirmation_request_sender_is_not_confirmer CHECK (
    lower(trim(created_by_email)) <> lower(trim(confirmer_email))
  )
);

-- 令牌哈希全局唯一：消费链接时用 (id, token_hash) 双条件定位，唯一索引让
-- "同一个令牌被复用到另一个请求上"在库层面不可能发生。
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_knowledge_confirmation_requests_token
  ON public.client_knowledge_confirmation_requests (token_hash);

CREATE INDEX IF NOT EXISTS idx_client_knowledge_confirmation_requests_client
  ON public.client_knowledge_confirmation_requests (client_id, status, created_at DESC);

ALTER TABLE public.client_knowledge_confirmation_requests ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  -- 🔴 必须写 TO service_role。漏掉 = 对匿名访客敞开读写（本仓库 2026-08-03
  --    实测泄露 118 条策略的那类事故）。这张表尤其致命：它装的是"谁能替客户
  --    签字"的令牌哈希和批次内容。
  CREATE POLICY "service_role_full" ON public.client_knowledge_confirmation_requests
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 🔴 单次使用（design doc §9.14 B "仅当未使用才更新保证单次"）：
--    应用层用条件更新（WHERE status='pending'）保证并发下只有一个请求能消
--    费成功。这个触发器是它的兜底——终态一旦写下，任何把它改回 pending、
--    或者改成另一个终态的尝试一律拒绝。没有它，一个 bug（或一次手工 SQL）
--    能让一条已经用过的链接重新变得可用，而且看起来完全正常。
CREATE OR REPLACE FUNCTION public.client_knowledge_confirmation_requests_no_terminal_reopen()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.status <> 'pending' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION
      'client_knowledge_confirmation_requests: request % is already % and cannot change state again',
      OLD.id, OLD.status;
  END IF;
  -- 令牌哈希和批次内容是发出去那一刻钉死的事实，事后改动 = 让"客户确认的
  -- 是哪一版"这条审计线索失去意义。
  IF NEW.token_hash IS DISTINCT FROM OLD.token_hash
     OR NEW.fact_fingerprints IS DISTINCT FROM OLD.fact_fingerprints
     OR NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.confirmer_email IS DISTINCT FROM OLD.confirmer_email THEN
    RAISE EXCEPTION
      'client_knowledge_confirmation_requests: token/batch/recipient are immutable after the link is issued (id=%)',
      OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS client_knowledge_confirmation_requests_no_terminal_reopen_trigger
  ON public.client_knowledge_confirmation_requests;
CREATE TRIGGER client_knowledge_confirmation_requests_no_terminal_reopen_trigger
  BEFORE UPDATE ON public.client_knowledge_confirmation_requests
  FOR EACH ROW EXECUTE FUNCTION public.client_knowledge_confirmation_requests_no_terminal_reopen();
