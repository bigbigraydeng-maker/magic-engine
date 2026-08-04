-- 来源归因 —— 「这个人是哪条广告 / 哪条视频带来的」
--
-- ✅ 已 apply(2026-07-30, PM 显式 go apply)。库内版本号见文件名。
--
-- WHY
-- ---
-- contacts 现在只有 client_id / 联系方式 / stage,**一个来源字段都没有**。
-- 于是系统能看到「这个人成交了」,看不到「他是哪条广告、哪条视频带来的」——
-- 学习值为零:赢家拆不出来、输家也停不掉,每套新房子都从头猜。
--
-- 命名为什么用 attr_ 前缀而不是 source_
-- ------------------------------------
-- contact_touchpoints 上**已经**有 source / source_ref 两列,含义完全不同:
--   source      写入这条触点的系统('meta_lead_form' / 'messenger' / 'mailchimp' / 'me_manual')
--   source_ref  幂等键(UNIQUE(client_id, source, source_ref) 靠它去重)
-- 再叠一批 source_platform / source_ad_id 会让两套语义混在同一个前缀下,
-- 读代码的人分不清哪个是「哪个系统写的」哪个是「哪条广告带来的」。
-- 所以归因统一用 attr_ 前缀,contacts 和 contact_touchpoints **同一套命名**。
--
-- 字段基于 Meta 真能返回的东西(见 src/lib/crm/attribution.ts 头部的证据链):
--   attr_platform      渠道大类
--   attr_campaign_id   Meta campaign_id
--   attr_adset_id      Meta adset_id
--   attr_ad_id         Meta ad_id
--   attr_ad_name       Meta ad_name(人读的那一列,CSV 一定有)
--   attr_creative_ref  素材指纹 —— ME 自己的 reels_draft / 成片 id。
--                      Meta lead 导出**不给** creative id,所以这一列的真相源
--                      是 ME 的出片管道,不是 Meta。拿不到就 NULL,不编。
-- 刻意**没有** attr_campaign_name / attr_adset_name:名字在 Meta 里可以随时改,
-- 存一份就会跟广告后台不一致;要人读的名字用 attr_ad_id 回查。ad_name 例外,
-- 因为 CTS 那份存量 CSV 里只有 ad_name 没有 ad_id,不留它就等于丢掉全部存量归因。
--
-- 为什么不加 CHECK 约束
-- --------------------
-- attr_platform 是会长的清单(meta / google / email / web / organic_social / manual …)。
-- CHECK 一旦落库,加一个渠道就要再来一次 migration + PM 拍板,而漏同步就是写入
-- 直接报错(CLAUDE.md 记的 superseded 事故正是 enum 没同步)。真相源放在
-- TypeScript(ATTRIBUTION_PLATFORMS),写入前在应用层收敛,库里保持 TEXT。

-- ---------------------------------------------------------------------------
-- contacts —— first-touch(第一次是谁把他带来的)
--
-- first-touch 而不是 last-touch:地产买家从看到广告到成交要几周,中间会被
-- 邮件、私信、电话碰无数次。用 last-touch 会把功劳全记给「最后那封提醒邮件」,
-- 真正带来人的那条视频反而是零 —— 那样学出来的结论是反的。
--
-- 全部可空:存量 335 个 CTS 联系人没有归因,回填不了就是 NULL,如实留白。
-- ---------------------------------------------------------------------------
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS attr_platform      TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS attr_campaign_id   TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS attr_adset_id      TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS attr_ad_id         TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS attr_ad_name       TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS attr_creative_ref  TEXT;
-- 首次归因时间 = 第一次拿到「他从哪来」这条证据的时刻。
-- 跟 first_seen_at 不是一回事:一个人可能先匿名私信(first_seen_at 有了、
-- 归因还没有),后来才填了带 ad_id 的表单。
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS first_attributed_at TIMESTAMPTZ;

-- 反查:这条广告带来了哪些人 / 成交了几个。partial index —— 绝大多数存量行是 NULL。
CREATE INDEX IF NOT EXISTS contacts_attr_ad_idx
  ON contacts (client_id, attr_ad_id) WHERE attr_ad_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS contacts_attr_campaign_idx
  ON contacts (client_id, attr_campaign_id) WHERE attr_campaign_id IS NOT NULL;

COMMENT ON COLUMN contacts.attr_platform IS
  'first-touch 渠道大类。真相源在 src/lib/crm/attribution.ts 的 ATTRIBUTION_PLATFORMS,库里不加 CHECK。';
COMMENT ON COLUMN contacts.attr_creative_ref IS
  '素材指纹(ME 自己的 reels_draft / 成片 id)。Meta 的 lead 导出不给 creative id —— 这一列只能由 ME 出片管道回填,拿不到就 NULL。';
COMMENT ON COLUMN contacts.first_attributed_at IS
  '第一次拿到来源证据的时刻。first-touch 语义:一旦有值,后续触点不再覆盖。';

-- ---------------------------------------------------------------------------
-- contact_touchpoints —— 每条触点自己的来源
--
-- 为什么触点也要存一份、而不是「反正 contacts 上有 first-touch 就够了」:
--   1. 一个人可能被两条不同的广告分别捞到过(先 A 房子的广告、后 B 房子的)。
--      只存 contacts 上那一份,第二条广告的贡献永远看不见。
--   2. contacts 上的 first-touch 是从触点派生出来的结论。结论可以重算,
--      但只有原始事件保留了归因,才有得重算 —— 触点是不可变的真相源。
-- ---------------------------------------------------------------------------
ALTER TABLE contact_touchpoints ADD COLUMN IF NOT EXISTS attr_platform     TEXT;
ALTER TABLE contact_touchpoints ADD COLUMN IF NOT EXISTS attr_campaign_id  TEXT;
ALTER TABLE contact_touchpoints ADD COLUMN IF NOT EXISTS attr_adset_id     TEXT;
ALTER TABLE contact_touchpoints ADD COLUMN IF NOT EXISTS attr_ad_id        TEXT;
ALTER TABLE contact_touchpoints ADD COLUMN IF NOT EXISTS attr_ad_name      TEXT;
ALTER TABLE contact_touchpoints ADD COLUMN IF NOT EXISTS attr_creative_ref TEXT;

CREATE INDEX IF NOT EXISTS contact_touchpoints_attr_ad_idx
  ON contact_touchpoints (client_id, attr_ad_id) WHERE attr_ad_id IS NOT NULL;

COMMENT ON COLUMN contact_touchpoints.attr_platform IS
  '这条触点的来源渠道。跟同表的 source 列不是一回事:source = 哪个系统写的,attr_* = 哪条广告带来的。';
