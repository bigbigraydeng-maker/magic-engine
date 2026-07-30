-- 客户主体（人）+ 身份合并键 —— 四渠道共用的地基。
--
-- WHY NOW
-- -------
-- 2026-07-26 拍板：私信 / 邮件 / 网站表单 / 外呼 都要回流 ME。四个渠道给的
-- 身份完全不同：
--   Messenger  → Facebook PSID（可能附带客户自己打的电话/邮箱）
--   邮件       → 邮箱地址
--   网站表单   → 邮箱 + 电话（已是 E.164）
--   外呼       → 电话
-- 不先把「同一个人」定下来，就会得到四份半截画像，冷热分级也就是废的。
--
-- 真实案例（info@ 信箱 2026-07-26 实测）：一位客户邮箱 hemitekoha@hotmail.com、
-- 显示名 Chris Brown、正文自称 Christine、订的是儿子 Isaac Brown 的团。
-- 靠姓名合并必错 —— 所以合并键只认电话和邮箱，姓名只用来显示。
--
-- 关系
-- ----
--   contacts            一个真人（client 维度）
--   contact_identities  这个人在各渠道的身份，合并就发生在这张表
--
-- 不动 voice_* 和 leads：voice_contacts/voice_leads 是外呼模块自己的模型
-- （tenant 维度、目前 0 行、外呼尚未开启），leads 是网站表单原始提交。
-- 它们如何并入 contacts 是下一步，不在本次改动内，避免一次动太多。

-- ---------------------------------------------------------------------------
-- contacts —— 人
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contacts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- 显示用。客户在不同渠道用不同名字是常态，这里存最近一次见到的。
  display_name      TEXT,
  -- 规范化后的主要联系方式。合并逻辑读 contact_identities，这两列只是
  -- 为了列表页不用每次 join。
  primary_phone     TEXT,
  primary_email     TEXT,

  -- 合规：客户明确说过别再联系，任何渠道都不许再发。
  do_not_contact    BOOLEAN NOT NULL DEFAULT FALSE,
  do_not_contact_reason TEXT,

  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS contacts_client_last_seen_idx
  ON contacts (client_id, last_seen_at DESC);

-- ---------------------------------------------------------------------------
-- contact_identities —— 合并键
--
-- 一行 = 「这个渠道的这个标识属于这个人」。渠道适配器写入时先查这张表，
-- 命中就复用 contact，没命中就新建。
--
-- value 存规范化后的值（电话 E.164、邮箱小写去空格），规范化在应用层做，
-- 因为各渠道原始格式不同（Meta 导出是 "p:+6421..."，Sheet 是人手打的）。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contact_identities (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id    UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  -- 冗余一份便于按 client 直接查，且保证唯一约束不跨客户。
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- 'phone' | 'email' | 'fb_psid'
  -- phone / email 能跨渠道合并；fb_psid 只在 Messenger 内有效，
  -- 一个只在 FB 上聊过、从没留过电话邮箱的人就是合并不了 —— 这是事实，
  -- 不假装合上（假装合上比合不上危险）。
  kind          TEXT NOT NULL CHECK (kind IN ('phone', 'email', 'fb_psid')),
  value         TEXT NOT NULL,

  -- 第一次是从哪个渠道看到这个身份的，纯记录用。
  first_source  TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- 同一个客户下，同一个标识只能属于一个人。
  CONSTRAINT contact_identities_client_kind_value_key UNIQUE (client_id, kind, value)
);

CREATE INDEX IF NOT EXISTS contact_identities_contact_idx
  ON contact_identities (contact_id);

-- ---------------------------------------------------------------------------
-- RLS —— ME 一律 service-role + Bearer API 访问（CLAUDE.md 强约束）
-- ---------------------------------------------------------------------------
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON contacts FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE contact_identities ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON contact_identities FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 把 Messenger 那套升级成「渠道通用」
--
-- 今天上线的 messenger_conversations / _messages / _briefs / _outbound_log
-- 结构本身是对的，只是名字和假设绑死在 Messenger 上。邮件线程是同一个东西
-- （一个人 + 一串来回 + 一张 AI 卡 + 要回信），外呼也是。
--
-- 现在四张表都是 0 行，改名零成本；等有数据再改就要迁移。
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS messenger_conversations  RENAME TO conversations;
ALTER TABLE IF EXISTS messenger_messages       RENAME TO conversation_messages;
ALTER TABLE IF EXISTS messenger_briefs         RENAME TO conversation_briefs;
ALTER TABLE IF EXISTS messenger_outbound_log   RENAME TO conversation_outbound_log;

-- 渠道。默认 messenger 让已上线的同步代码不改也能继续跑。
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'messenger'
    CHECK (channel IN ('messenger', 'email', 'voice', 'whatsapp'));

-- 归属到人。可空：Messenger 上没留过联系方式的人认不出来，这时就是 NULL，
-- 等他哪天留了电话或邮箱再回填。
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;

-- 邮件线程有主题，Messenger 没有。
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS subject TEXT;

-- 结局。缺了它所有分析都没有分母 —— 「我们回得快」接不到「所以成了几单」。
--   open      还在谈
--   won       成交
--   lost      没成
--   not_a_lead 不是客户（打错、垃圾、同行）
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'won', 'lost', 'not_a_lead'));
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ;
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS status_note TEXT;

-- 谁在跟。两个 CTS 邮箱共用一个列表，没有这个会撞车、重复回同一个客户。
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS owner_email TEXT;

-- 人工设定的回访时间。此前只有 AI 能设 follow_up_due_at，人不能改、不能推迟。
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS snooze_until TIMESTAMPTZ;

-- page_id 是 Messenger 专有的（邮件没有主页）。放宽成可空，
-- 邮件/外呼渠道写 NULL。
ALTER TABLE conversations ALTER COLUMN page_id DROP NOT NULL;

-- 工作台主查询：这个客户下、还在谈的、谁先谁后。
CREATE INDEX IF NOT EXISTS conversations_client_channel_status_idx
  ON conversations (client_id, channel, status, last_message_at DESC);

CREATE INDEX IF NOT EXISTS conversations_contact_idx
  ON conversations (contact_id);

COMMENT ON TABLE conversations IS
  '所有渠道的客户对话（Messenger / 邮件 / 外呼 / WhatsApp）。一条对话 = 一个人在一个渠道上的一串来回。';
COMMENT ON COLUMN conversations.contact_id IS
  '归属的真人。NULL = 该渠道身份还合并不到任何人（例如只在 FB 聊过、从未留电话邮箱）。';
