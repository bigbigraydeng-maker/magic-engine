-- ============================================================================
-- Magic Engine Voice Agent · P0 schema
-- ============================================================================
-- Spec:   ~/Downloads/magic-engine-voice-agent-spec.md (v0.1 MVP)
-- Docs:   docs/voice-agent/{LOCAL_SETUP,SIP_SETUP,RUNBOOK}.md
-- Review: 子牙(架构拍板) + 魏征(架构挑刺) + 板桥(C端客户视角) 三审 2026-07-15
--
-- 定位：DAPE「E 执行」新战线 — AI 电话销售 + 电话客服。底层 OpenAI Realtime SIP。
--
-- 子牙拍板压掉 spec 两处（写进 CLAUDE.md 铁律）：
--   1. spec §7/§17 的「启用 RLS + auth.jwt 用户校验」违反 ME service_role 强约束
--      → 全表用 service_role_full 模板，租户隔离下沉到 repository 层强制 tenant scope
--      （2026-06-05 schema 漂移事故：CREATE POLICY 引用不存在的多租户对象 → apply
--       整事务回滚 → 13 处漂移 + 19 客户 cron 全瘫。本文件 grep 自查无
--       workspace_id / client_team / auth.uid / auth.jwt）
--   2. spec 把「租户」当全新主键 → voice_tenants.client_id 强制映射到 clients(id)
--      AI 读脑子(master_briefs)只用服务端解析出的 client_id，绝不从模型取（防跨客户泄漏）
--
-- 全表加 voice_ 前缀：现有 public.leads 已冲突（20260613000001_leads.sql），
-- contacts/calls/agents 同为高概率撞名词，一律隔离。
--
-- Backwards compatible: 全新表，无历史数据，无 breaking change。只 CREATE IF NOT EXISTS。
-- Non-destructive:      无 DROP，无 backfill。
--
-- ⚠️ 本 migration 写好但**不由 worker 自行 apply**（CLAUDE.md 强约束）。
--    待 PM 显式 `go apply`。今晚闭环用内存 store + mock provider 验证。
--
-- Rollback: 见文件末尾 DROP 清单。
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- shared trigger: touch updated_at
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.voice_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. voice_tenants — 语音租户，强制映射到 ME 权威客户 clients(id)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.voice_tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 🔑 魏征 #1：到 ME 权威客户的唯一映射。读 master_briefs/clients/leads 当脑子只用这个。
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','archived')),
  default_timezone TEXT NOT NULL DEFAULT 'Pacific/Auckland',
  default_language TEXT NOT NULL DEFAULT 'en-NZ',
  openai_vector_store_id TEXT,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_voice_tenants_client ON public.voice_tenants(client_id);
COMMENT ON COLUMN public.voice_tenants.client_id IS
  '映射到 ME 权威客户。AI 读脑子(master_briefs/clients/leads)只用服务端解析出的此列，绝不从模型 args 取（跨租户隔离红线）。';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. voice_agents
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.voice_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.voice_tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('sales','support','hybrid')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','disabled')),
  model TEXT NOT NULL DEFAULT 'gpt-realtime-2.1-mini',
  voice TEXT,
  reasoning_effort TEXT NOT NULL DEFAULT 'low',
  primary_language TEXT NOT NULL DEFAULT 'en-NZ',
  supported_languages TEXT[] NOT NULL DEFAULT ARRAY['en-NZ'],
  greeting TEXT NOT NULL,
  system_instructions TEXT NOT NULL,
  -- 板桥 #1: AI 身份披露硬约束。租户不可关。prompt compiler 强制注入。
  ai_disclosure_required BOOLEAN NOT NULL DEFAULT true,
  business_hours JSONB NOT NULL DEFAULT '{}'::jsonb,
  human_transfer_uri TEXT,
  -- 魏征 #4 / 板桥 #6: 转人工白名单 target→uri 映射（default/sales/support/manager）
  transfer_targets JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled_tools TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_voice_agents_tenant ON public.voice_agents(tenant_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 3. voice_phone_routes — 被叫/主叫号码 → tenant+agent 路由
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.voice_phone_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.voice_tenants(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES public.voice_agents(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('pstn','sip','whatsapp_call')),
  phone_number_e164 TEXT,
  sip_uri TEXT,
  provider_resource_id TEXT,
  direction TEXT NOT NULL DEFAULT 'inbound' CHECK (direction IN ('inbound','outbound','both')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  priority INTEGER NOT NULL DEFAULT 100,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS voice_phone_routes_number_unique
  ON public.voice_phone_routes(provider, phone_number_e164)
  WHERE phone_number_e164 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_voice_phone_routes_tenant ON public.voice_phone_routes(tenant_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 4. voice_contacts
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.voice_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.voice_tenants(id) ON DELETE CASCADE,
  phone_e164 TEXT,
  whatsapp_phone_e164 TEXT,
  email TEXT,
  first_name TEXT,
  last_name TEXT,
  preferred_language TEXT,
  consent_status TEXT NOT NULL DEFAULT 'unknown' CHECK (consent_status IN ('unknown','granted','denied','withdrawn')),
  do_not_call BOOLEAN NOT NULL DEFAULT false,
  -- 关联 ME 现有 leads（warm callback 名单源），可空
  me_lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_voice_contacts_tenant_phone ON public.voice_contacts(tenant_id, phone_e164);

-- ────────────────────────────────────────────────────────────────────────────
-- 5. voice_leads — 语音通话产生的销售线索（ME 权威）
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.voice_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.voice_tenants(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.voice_contacts(id) ON DELETE SET NULL,
  source TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'new',
  intent_level TEXT CHECK (intent_level IN ('low','medium','high','unknown')),
  service_interest TEXT,
  budget_min NUMERIC,
  budget_max NUMERIC,
  currency TEXT,
  preferred_area TEXT,
  timeline TEXT,
  next_action TEXT,
  assigned_to UUID,
  structured_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_contact_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_voice_leads_tenant ON public.voice_leads(tenant_id);
CREATE INDEX IF NOT EXISTS idx_voice_leads_contact ON public.voice_leads(contact_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 6. voice_calls — 通话主记录
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.voice_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.voice_tenants(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES public.voice_agents(id),
  contact_id UUID REFERENCES public.voice_contacts(id),
  lead_id UUID REFERENCES public.voice_leads(id),
  channel TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  provider TEXT NOT NULL,
  -- 魏征 #5: mock/real 数据打标，看板默认过滤模拟数据。mock provider 写 provider='mock' + is_simulated=true
  is_simulated BOOLEAN NOT NULL DEFAULT false,
  provider_call_id TEXT,
  openai_call_id TEXT UNIQUE,
  from_number TEXT,
  to_number TEXT,
  status TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN ('created','ringing','accepted','in_progress','transferring','transferred','completed','rejected','failed')),
  started_at TIMESTAMPTZ,
  answered_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  language_detected TEXT,
  recording_url TEXT,
  transcript_status TEXT NOT NULL DEFAULT 'pending',
  -- 魏征 #6: finalize 幂等兜底状态（独立 cron/轮询扫，worker 崩也能收尸）
  summary_status TEXT NOT NULL DEFAULT 'pending' CHECK (summary_status IN ('pending','running','done','failed')),
  summary TEXT,
  outcome TEXT,
  disposition TEXT,
  structured_outcome JSONB NOT NULL DEFAULT '{}'::jsonb,
  usage JSONB NOT NULL DEFAULT '{}'::jsonb,
  cost_estimate JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_voice_calls_tenant_time ON public.voice_calls(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_voice_calls_summary_status ON public.voice_calls(summary_status)
  WHERE summary_status IN ('pending','failed');
CREATE INDEX IF NOT EXISTS idx_voice_calls_real ON public.voice_calls(tenant_id, created_at DESC)
  WHERE is_simulated = false;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. voice_call_transcript_segments
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.voice_call_transcript_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.voice_tenants(id) ON DELETE CASCADE,
  call_id UUID NOT NULL REFERENCES public.voice_calls(id) ON DELETE CASCADE,
  sequence_no INTEGER NOT NULL,
  speaker TEXT NOT NULL CHECK (speaker IN ('user','assistant','system','human')),
  text TEXT NOT NULL,
  started_at_ms INTEGER,
  ended_at_ms INTEGER,
  source_event_id TEXT,
  is_final BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (call_id, sequence_no)
);
CREATE INDEX IF NOT EXISTS idx_voice_transcript_call ON public.voice_call_transcript_segments(call_id, sequence_no);

-- ────────────────────────────────────────────────────────────────────────────
-- 8. voice_agent_tool_calls
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.voice_agent_tool_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.voice_tenants(id) ON DELETE CASCADE,
  call_id UUID REFERENCES public.voice_calls(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES public.voice_agents(id),
  openai_tool_call_id TEXT,
  tool_name TEXT NOT NULL,
  arguments JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','running','completed','failed')),
  result JSONB,
  error TEXT,
  latency_ms INTEGER,
  requires_confirmation BOOLEAN NOT NULL DEFAULT false,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_voice_tool_calls_call ON public.voice_agent_tool_calls(call_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 9. voice_knowledge_documents
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.voice_knowledge_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.voice_tenants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL,
  storage_path TEXT,
  source_url TEXT,
  mime_type TEXT,
  checksum TEXT,
  openai_file_id TEXT,
  openai_vector_store_id TEXT,
  index_status TEXT NOT NULL DEFAULT 'pending' CHECK (index_status IN ('pending','indexing','ready','failed','disabled')),
  version INTEGER NOT NULL DEFAULT 1,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_voice_knowledge_tenant ON public.voice_knowledge_documents(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS voice_knowledge_checksum_unique
  ON public.voice_knowledge_documents(tenant_id, checksum)
  WHERE checksum IS NOT NULL AND index_status <> 'disabled';

-- ────────────────────────────────────────────────────────────────────────────
-- 10. voice_webhook_events — 验签 + 幂等（魏征 #7：处理动作幂等，非仅记录去重）
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.voice_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  signature_valid BOOLEAN NOT NULL,
  payload_hash TEXT NOT NULL,
  payload JSONB,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','processing','processed','failed','skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  processed_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, external_event_id)
);

-- ────────────────────────────────────────────────────────────────────────────
-- 11. voice_audit_logs
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.voice_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.voice_tenants(id) ON DELETE CASCADE,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user','agent','system','webhook')),
  actor_id TEXT,
  operation TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  before JSONB,
  changes JSONB,
  ip TEXT,
  request_id TEXT,
  call_id UUID REFERENCES public.voice_calls(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_voice_audit_tenant_time ON public.voice_audit_logs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_voice_audit_call ON public.voice_audit_logs(call_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 12. voice_outbound_suppression — 外呼抑制名单（do_not_call / 客户说别再联系）
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.voice_outbound_suppression (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.voice_tenants(id) ON DELETE CASCADE,
  phone_e164 TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, phone_e164)
);
CREATE INDEX IF NOT EXISTS idx_voice_suppression_tenant ON public.voice_outbound_suppression(tenant_id, phone_e164);

-- ────────────────────────────────────────────────────────────────────────────
-- 13. voice_callback_requests — schedule_callback 工具落点（MVP 不接日历）
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.voice_callback_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.voice_tenants(id) ON DELETE CASCADE,
  call_id UUID REFERENCES public.voice_calls(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.voice_contacts(id) ON DELETE SET NULL,
  preferred_date DATE,
  preferred_time_window TEXT,
  timezone TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_voice_callback_tenant_status ON public.voice_callback_requests(tenant_id, status);

-- ────────────────────────────────────────────────────────────────────────────
-- 14. voice_outbound_campaigns — 外呼战役骨架（P0 只建模型，逻辑二期）
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.voice_outbound_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.voice_tenants(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES public.voice_agents(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','completed')),
  script_approved BOOLEAN NOT NULL DEFAULT false,
  daily_start_local TIME,
  daily_end_local TIME,
  max_attempts_per_contact INTEGER NOT NULL DEFAULT 3,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_voice_campaigns_tenant ON public.voice_outbound_campaigns(tenant_id);

-- ────────────────────────────────────────────────────────────────────────────
-- updated_at triggers
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'voice_tenants','voice_agents','voice_phone_routes','voice_contacts','voice_leads',
    'voice_calls','voice_agent_tool_calls','voice_knowledge_documents','voice_webhook_events',
    'voice_callback_requests','voice_outbound_campaigns'
  ]) LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON public.%1$s;
       CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON public.%1$s
       FOR EACH ROW EXECUTE FUNCTION public.voice_touch_updated_at();', t);
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- RLS · service_role_full 模板（CLAUDE.md 强约束 · 禁 auth.uid/auth.jwt/workspace_id/client_team）
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'voice_tenants','voice_agents','voice_phone_routes','voice_contacts','voice_leads',
    'voice_calls','voice_call_transcript_segments','voice_agent_tool_calls',
    'voice_knowledge_documents','voice_webhook_events','voice_audit_logs',
    'voice_outbound_suppression','voice_callback_requests','voice_outbound_campaigns'
  ]) LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    BEGIN
      EXECUTE format('CREATE POLICY "service_role_full" ON public.%I FOR ALL USING (true);', t);
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    EXECUTE format('GRANT ALL ON public.%I TO service_role;', t);
  END LOOP;
END $$;

-- ============================================================================
-- Rollback (手动执行):
--   DROP TABLE public.voice_outbound_campaigns, public.voice_callback_requests,
--     public.voice_outbound_suppression, public.voice_audit_logs,
--     public.voice_webhook_events, public.voice_knowledge_documents,
--     public.voice_agent_tool_calls, public.voice_call_transcript_segments,
--     public.voice_calls, public.voice_leads, public.voice_contacts,
--     public.voice_phone_routes, public.voice_agents, public.voice_tenants CASCADE;
--   DROP FUNCTION IF EXISTS public.voice_touch_updated_at();
-- ============================================================================
