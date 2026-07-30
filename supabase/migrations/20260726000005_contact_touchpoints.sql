-- 触点 —— 「这个人，在哪个渠道，什么时候，发生了什么」
--
-- 冷热分级的骨架就是这张表：热 / 温 / 冷 / 正在凉，全部从触点算出来，
-- 不靠人去某一列填状态。CTS 手工 CRM 塌掉的原因正是「阶段」要人再填一遍，
-- 128 行里 0 个填了，于是自动提醒退化成 122 条一模一样的红字。
--
-- 一行 = 一次接触。四个渠道共用：
--   meta_lead_form  Facebook 即时表单提交
--   phone           电话（销售手打的跟进记录，或将来外呼 agent 的通话）
--   email           邮件往来
--   messenger       FB 私信
--   web_form        客户官网表单
--
-- summary 是人话（给人看），metadata 是结构化解析结果（给系统算）。
-- raw 保留原始文本 —— AI 解析可能出错，原话必须留着能回查。
--
-- 真实依据（2026-07-26 读完 CTS 353 条 FB lead 的 294 条跟进记录）：
--   56 人根本没联系上、23 人明确说别再打、21 人明说明年才走、7 人已被别家拿走。
--   这些全躺在一个 Excel 单元格的自由文本里，系统一条都用不上。

CREATE TABLE IF NOT EXISTS contact_touchpoints (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  contact_id   UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,

  channel      TEXT NOT NULL CHECK (channel IN
                 ('meta_lead_form', 'phone', 'email', 'messenger', 'web_form', 'whatsapp')),
  -- inbound  = 客户找我们
  -- outbound = 我们找客户（打过去、发过去）
  direction    TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),

  occurred_at  TIMESTAMPTZ NOT NULL,

  -- 人话一句，列表页直接显示。
  summary      TEXT,
  -- 原始文本。AI 解析可能读错，原话必须留着能回查 —— 这是给销售的信任基础。
  raw          TEXT,
  -- 结构化解析结果：意向、出行时间窗、竞品、约定回电时间、为什么没联系上……
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- 外部系统的 id（Meta lead id、邮件 message id、对话 id），用于幂等重跑。
  source       TEXT,
  source_ref   TEXT,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- 同一个来源的同一条记录只进一次，导入脚本可以放心重跑。
  CONSTRAINT contact_touchpoints_source_key UNIQUE (client_id, source, source_ref)
);

-- 主查询：这个人最近发生了什么（卡片展开时间线）。
CREATE INDEX IF NOT EXISTS contact_touchpoints_contact_time_idx
  ON contact_touchpoints (contact_id, occurred_at DESC);

-- 冷热分级扫描：这个客户下所有人的最近活动。
CREATE INDEX IF NOT EXISTS contact_touchpoints_client_time_idx
  ON contact_touchpoints (client_id, occurred_at DESC);

ALTER TABLE contact_touchpoints ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON contact_touchpoints FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON TABLE contact_touchpoints IS
  '跨渠道接触事件。冷热分级从这里算，不依赖任何人手工维护状态列。';
COMMENT ON COLUMN contact_touchpoints.raw IS
  '原始文本。AI 解析结果存 metadata，但原话永远保留 —— 解析错了要能回查。';
