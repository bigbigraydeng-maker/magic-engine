-- listings —— 「一套房」终于成为一个对象
--
-- ✅ 已 apply(2026-07-30, PM 显式 go apply)。库内版本号见文件名。
--
-- WHY
-- ---
-- 现在一套房是当成一个 client 建的档(clients 表里就有一行
-- '30 Kiteroa Rothesay Bay', id 5a3fb2b7-72c3-471e-a5e7-1a528c0f776c)。
-- 20 套房 = 20 个互不相关的客户,于是:
--   · 「哪个 suburb 的 lead 更容易成交」聚不起来(每套房各自一座孤岛)
--   · 「200 万档的房子该投多少钱」永远只有 1 个样本
--   · 中介本人(Roman / Park Homes)在系统里没有一条贯穿全部房子的线
-- 学习链条是「房子 → 内容 → 广告 → 买家质量 → 成交结果」,第一环缺对象,
-- 后面四环的数据就没有可聚合的维度。
--
-- 归属关系
-- --------
--   clients   = 付钱的中介 / 开发商(Roman HU / Park Homes / IB Real Estate)
--   listings  = 他手上的一套套房,client_id 指回他
-- 一个 listing 不是一个 client —— 这是本次要纠正的建模错误。
--
-- 字段取舍的唯一标准:**能不能支撑跨房子聚合学习**。
--   suburb / price_band / property_type / bedrooms → 聚合维度(横切 20 套房)
--   status / listed_on / delisted_on / sold_on / sold_price → 结果维度(分母 + 结局)
--   vendor_notes / external_ref → 运营需要,不参与学习
-- 没有堆「朝向 / 车位 / 装修年份」这类现在没人读的字段。
--
-- 存量数据怎么办(本次**不做**)
-- ----------------------------
-- 不迁移、不动 30 Kiteroa 那行 client。未来迁移思路(等 UI 到位、PM 再拍):
--   1. 给 Roman(或该房子真正的归属中介)建一条 listings 行,地址填 '30 Kiteroa Place'
--      / suburb 'Rothesay Bay',status 按当时实际填
--   2. 把挂在 5a3fb2b7 这个假 client 下的 contacts / campaign_briefs / 触点
--      改挂到中介 client_id + 新的 listing_id
--   3. 5a3fb2b7 那行 client 保留但停用(不删 —— 删客户数据是不可逆操作,要 PM 单独授权)
-- 迁移脚本必须是可 dry-run 的一次性脚本,不是自动 migration。

CREATE TABLE IF NOT EXISTS listings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 归属的中介 / 开发商客户。删客户则连带删他的房子。
  client_id      UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- 门牌 + 街道,如 '30 Kiteroa Place'。显示用,不做合并键(同一地址可能多次上市)。
  address_line   TEXT NOT NULL,
  -- 聚合维度 1:郊区。地产学习最强的横切维度(同一 suburb 的买家画像接近)。
  suburb         TEXT,
  city           TEXT,

  -- 聚合维度 2:房型。稳定英文 slug,前端负责翻中文。
  --   加新值必须同步前端 Record / switch(CLAUDE.md enum 硬约束),所以这里
  --   刻意留 'other' 兜底,不确定的先进 other,不要急着加值。
  property_type  TEXT CHECK (property_type IN
                   ('house', 'apartment', 'townhouse', 'section', 'new_build', 'other')),
  bedrooms       SMALLINT,

  -- 聚合维度 3:价格档。存 slug 不存具体数字 —— NZ 很多房子 "price by negotiation",
  -- 真实要价直到成交都不公开,存一个编出来的数字比存档位更糟。
  price_band     TEXT CHECK (price_band IN
                   ('under_1m', '1m_1_5m', '1_5m_2m', '2m_3m', '3m_plus', 'undisclosed')),

  -- 结果维度:这套房现在到哪一步了。
  --   prospect     还在谈 mandate,没上市
  --   live         在卖
  --   under_offer  有条件出价中
  --   sold         成交
  --   withdrawn    撤下(没卖掉 / 换中介)—— 这是负样本,学习必须留着
  status         TEXT NOT NULL DEFAULT 'prospect'
                   CHECK (status IN ('prospect', 'live', 'under_offer', 'sold', 'withdrawn')),

  listed_on      DATE,
  delisted_on    DATE,
  sold_on        DATE,
  -- 成交价。NUMERIC 不用 float —— 钱不能有浮点误差。
  sold_price     NUMERIC(12, 2),

  -- 卖家 / 内部备注(自由文本,不参与学习)。
  vendor_notes   TEXT,
  -- 客户自己系统里的编号(TradeMe listing id / 中介 CRM 编号),对账用。可空。
  external_ref   TEXT,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 主查询:这个中介现在手上有哪些房子,新的在前。
CREATE INDEX IF NOT EXISTS listings_client_status_idx
  ON listings (client_id, status, listed_on DESC NULLS LAST);
-- 跨房子聚合:某 suburb 的全部房子。
CREATE INDEX IF NOT EXISTS listings_client_suburb_idx
  ON listings (client_id, suburb);

ALTER TABLE listings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON listings FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON TABLE listings IS
  '一套房 = 一行,归属某个中介 / 开发商 client。跨房子聚合学习(suburb / price_band / property_type)的载体。一套房不再是一个 client。';
COMMENT ON COLUMN listings.price_band IS
  '价格档 slug。NZ 常见 price-by-negotiation,真实要价不公开,所以只存档位,绝不编数字。';
COMMENT ON COLUMN listings.status IS
  'withdrawn 是负样本,必须留着 —— 只看 sold 会把「投了钱但没卖掉」的房子从分母里抹掉。';

-- ---------------------------------------------------------------------------
-- 关联:campaign_briefs / contacts 各挂一个可空 listing_id
--
-- ⚠️ 仓库里**没有** campaigns 表 —— ME 的「一次战役」对象叫 campaign_briefs
--    (src/app/api/clients/[id]/campaign/** 全部读它)。所以 listing_id 加在
--    campaign_briefs 上。
--
-- 一律**可空**:存量 contacts(CTS 335 人)和 campaign_briefs 跟房子无关,
-- 也没有任何现有查询按 listing 过滤。可空 = 零破坏。
-- ON DELETE SET NULL:房子记录被删不该连带删掉人和战役。
-- ---------------------------------------------------------------------------
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS listing_id UUID REFERENCES listings(id) ON DELETE SET NULL;

ALTER TABLE campaign_briefs
  ADD COLUMN IF NOT EXISTS listing_id UUID REFERENCES listings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS contacts_listing_idx
  ON contacts (listing_id) WHERE listing_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS campaign_briefs_listing_idx
  ON campaign_briefs (listing_id) WHERE listing_id IS NOT NULL;

COMMENT ON COLUMN contacts.listing_id IS
  '这个人是哪套房带来的。NULL = 与具体房子无关(非地产客户 / 中介层面的线索)。';
COMMENT ON COLUMN campaign_briefs.listing_id IS
  '这次战役在推哪套房。NULL = 品牌层战役,不针对单套房。';
