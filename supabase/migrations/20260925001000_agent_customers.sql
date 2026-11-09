-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ ⚠️ 本文件只随 PR 提交，**不在 PR 内 apply**。apply 需 PM 显式 go。          ║
-- ║                                                                          ║
-- ║ agent_customers — 旅行社（Agent / trade contact）送来的终端客户。          ║
-- ║ 把 contacts 表里 kind='trade' 的 Agent 和他代订的终端客户关联起来，        ║
-- ║ 供「同行渠道」页面按 Agent / 按阶段两个视角读取。                          ║
-- ║                                                                          ║
-- ║ ⚠️ stage 字段**刻意没加 CHECK 约束**：这 7 个阶段（new / quoting /        ║
-- ║    quoted / confirmed / deposit_paid / completed / lost）是旅游行业专属，  ║
-- ║    不硬写进平台层。合法值由 src/lib/crm/agent-customer-stages.ts 的常量   ║
-- ║    白名单管住，以后接非旅游客户时只改那个文件，不用改表、不用跑 migration。 ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS public.agent_customers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,

  -- 哪个 Agent（指向 contacts 表里 kind='trade' 的那个人）
  agent_contact_id  uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,

  -- 终端客户信息（从邮件正文 AI 提取）
  customer_name     text,
  pax               integer,
  trip_type         text,
  travel_dates      text,
  specific_needs    text,

  -- 进度管理（合法值见 src/lib/crm/agent-customer-stages.ts，刻意不加 CHECK）
  stage             text NOT NULL DEFAULT 'new',

  -- 最后一次联系
  last_contact_at      timestamptz,
  last_contact_summary text,

  -- 关联到邮件线程（可选，方便跳转看完整对话）
  conversation_id   uuid REFERENCES public.conversations(id),

  notes             text,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- 一个 Agent 送来的客户按最后联系时间排
CREATE INDEX IF NOT EXISTS agent_customers_agent_idx
  ON public.agent_customers (agent_contact_id, last_contact_at DESC);

-- 按 client 查全部 agent 客户
CREATE INDEX IF NOT EXISTS agent_customers_client_idx
  ON public.agent_customers (client_id, last_contact_at DESC);

ALTER TABLE public.agent_customers ENABLE ROW LEVEL SECURITY;

DO $do$
BEGIN
  CREATE POLICY agent_customers_service_role ON public.agent_customers
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $do$;

COMMENT ON TABLE public.agent_customers IS '旅行社（Agent / trade contact）送来的终端客户：客户信息 + 进度阶段 + 最后联系，供「同行渠道」页面读取。';
COMMENT ON COLUMN public.agent_customers.agent_contact_id IS '指向 contacts 表里 kind=''trade'' 的 Agent。';
COMMENT ON COLUMN public.agent_customers.stage IS '进度阶段。刻意不加 CHECK 约束：合法值由 src/lib/crm/agent-customer-stages.ts 的常量白名单管住，方便以后接非旅游客户时不用改表。';
COMMENT ON COLUMN public.agent_customers.conversation_id IS '关联的邮件线程（可选），方便从客户卡片跳转看完整对话。';
COMMENT ON COLUMN public.agent_customers.last_contact_summary IS '最近一封邮件摘要，由 AI 提取写入。';

NOTIFY pgrst, 'reload schema';
