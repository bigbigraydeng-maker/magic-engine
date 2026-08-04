-- ---------------------------------------------------------------------------
-- 「今天该联系谁」缺的两个出口（PM 2026-08-03）
--
-- PM 问的是「能不能手动切换用户的分组」。答案是**不给**这个开关 —— 手动维护
-- 的状态列必烂，CTS 那份手工 CRM 就是死在这一点上（128 行里「阶段」列 0 个
-- 填了）。批次必须继续由系统从往来记录算出来。
--
-- 但他的直觉是对的：销售现在没有任何办法表达下面这两件事，只能眼看着一个
-- 明明处理完的人天天出现在名单上。所以给的是**事实输入**，不是分类开关：
--
--   snooze_until          「这人三个月后再说」→ 到期自己回名单
--   crm_segment_feedback  「这批分错了」→ 记下来改规则，**不改这个人**
--
-- 两者的区别很重要：前者改变系统看到的事实（于是重算结果变了），后者根本
-- 不参与计算 —— 它是给我们看的，用来改判据。
-- ---------------------------------------------------------------------------

-- ── 推迟 ────────────────────────────────────────────────────────────────────
--
-- 放在 contacts 上而不是 conversations 上：看板的单位是**人**，一个人可能
-- 同时有私信和邮件两条线，「三个月后再说」说的是这个人，不是某一条对话。
-- （conversations.snooze_until 是另一件事：某一条对话先搁一搁。）
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS snooze_until TIMESTAMPTZ;

COMMENT ON COLUMN contacts.snooze_until IS
  '推迟到这个时间之前不出现在「今天该联系谁」里。到点自动回来 —— 不需要任何人记得把他放回去。NULL = 没被推迟。';

-- 看板每次刷新都要按它过滤，且绝大多数人是 NULL —— 用部分索引，只收有值的那些。
CREATE INDEX IF NOT EXISTS contacts_snoozed_idx
  ON contacts (client_id, snooze_until)
  WHERE snooze_until IS NOT NULL;

-- ── 「这批分错了」 ──────────────────────────────────────────────────────────
--
-- 刻意**不**做成「把这个人挪到另一批」。分错是判据的问题，不是这一个人的
-- 问题 —— 挪一个人只是把错误藏起来，下一批新进来的人还会照样分错。
-- 这张表是给我们看的：同一个批次被报了多少次、销售说的理由是什么，
-- 累积到一定量就该去改 lib/crm/segments 里的规则。
CREATE TABLE IF NOT EXISTS crm_segment_feedback (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  contact_id  UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,

  -- 报错时这个人被分到哪一批（lib/crm/segments 里的 Segment）。
  segment     TEXT NOT NULL,
  -- 系统给出的理由 —— 存一份快照，因为规则改了之后就复现不出来了。
  reason      TEXT,
  -- 销售自己说的哪儿不对。可空：他可能只是点了「分错了」没打字，
  -- 那也是有用的信号，不能因为要求填理由就把这个动作变贵。
  note        TEXT,

  reported_by TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 主查询：哪一批被报得最多。
CREATE INDEX IF NOT EXISTS crm_segment_feedback_segment_idx
  ON crm_segment_feedback (client_id, segment, created_at DESC);

-- ── RLS ────────────────────────────────────────────────────────────────────
--
-- service-role 模板。**`TO service_role` 不能漏** —— 漏掉等于对匿名访客
-- 敞开读写（2026-08-03 实测泄露过 118 条策略）。见 docs/DECISIONS.md。
ALTER TABLE crm_segment_feedback ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON crm_segment_feedback
    FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON TABLE crm_segment_feedback IS
  '销售报「这批分错了」。不改任何人的分组 —— 只用来发现判据哪里不对，然后改规则。';
