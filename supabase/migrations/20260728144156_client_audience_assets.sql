-- 受众资产台账 —— Audience Asset Engine (P18.E.2)
--
-- WHY NOW
-- -------
-- P18.E.0 已经能按标准模板给任意客户建出整套意向阶梯池（CTS 生产验证：
-- 暖池单 lead NZ$6.65 vs 冷启动 NZ$11.12，低 40%）。但建完就断了：
-- 没有任何地方记着「这个池属于哪个客户、在阶梯的哪一级、是谁的账户拥有、
-- 里面的人是自然来的还是买来的」。
--
-- 没有这张表，两件事做不了：
--   1. 归属交割 —— PM 拍板「池子归中介」是红线。客户离场时要能导出他的
--      全部池子清单。靠人肉记不住，靠解析受众名字会静默出错。
--   2. 自我学习 —— 学习需要历史。历史需要一个稳定的主键把「同一个池子」
--      在时间轴上串起来。
--
-- 为什么不靠受众名字
-- ------------------
-- 名字（`ROMAN · L1 · video-50 · 365d`）是给人看的标签，不是主键：
-- 跨账户会重名、UI 里随手改名会漂移、改完没有任何地方报错 —— 台账会静默
-- 指向错的池子。所以这里存 Meta 的 audience_id，名字只作快照留档。
--
-- 快照为什么不在这张表
-- --------------------
-- 池子大小是时间序列，`flywheel_metrics` 就是干这个的，不重造：
--   flywheel     = 'ads'
--   metric_key   = 'ads.audience.size'
--   source_ref   = {audience_id, ladder_stage, layer, scope}
-- 本表只存「这个池子是什么」，不存「它每天多大」。
--
-- 相关：docs/superpowers/specs/2026-07-28-audience-asset-engine.md
--       src/lib/meta/audience-ladder.ts（建池器，写入方）

CREATE TABLE IF NOT EXISTS client_audience_assets (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- Meta 的 custom audience id —— 全局唯一，这是真正的主键语义。
  audience_id           TEXT NOT NULL,

  -- 建立当时的显示名。只作留档，**不可**用来反查身份（见顶部说明）。
  name_at_creation      TEXT,

  -- 分层：L0 母池 / L1 内容池 / L2 站点池 / L3 名单池 / L4 相似池。
  layer                 TEXT NOT NULL CHECK (layer IN ('L0', 'L1', 'L2', 'L3', 'L4')),

  -- 意向阶梯的哪一级。新增值必须同步 audience-ladder.ts 的 LadderStage
  -- 类型，否则代码和库会各说各话。
  -- 已知缺口：走 Messenger 的客户没有 lead form，'intent' 这一级目前无对应
  -- 物，需要另外定义（见 spec §4.2）。
  ladder_stage          TEXT NOT NULL CHECK (ladder_stage IN (
                          'page_engaged', 'page_messaged', 'page_video',
                          'viewed', 'viewed_deep', 'intent', 'converted'
                        )),

  -- 细分范围：'page-msg' / 'video-50' / 'remuera' 等。区级池靠它区分。
  scope                 TEXT NOT NULL,

  -- 池子里的人从哪来。付费投放会稀释「内容即分层」（Advantage+ 装进来的
  -- 是「平台认为便宜的人」，不是「对这个区感兴趣的人」），两种来源的池子
  -- 质量不可混为一谈，所以必须分开记。
  source_type           TEXT NOT NULL DEFAULT 'organic'
                          CHECK (source_type IN ('organic', 'paid', 'mixed')),

  -- 数据源 Page。池子跟着 Page 走 —— 中介换东家时，建在分行主页上的池子
  -- 会留给前东家，这一列是排查那种情况的依据。
  source_page_id        TEXT,

  -- 归属：池子实际存在哪个广告账户下。
  owner_ad_account_id   TEXT NOT NULL,
  -- 过渡态用：池子建在 ME 账户、共享给客户自己的业务组合。填了才算真的
  -- 交到客户手上；为空 = 还在 ME 这边，尚未交割。
  shared_to_business_id TEXT,
  shared_at             TIMESTAMPTZ,

  retention_days        INTEGER NOT NULL CHECK (retention_days > 0 AND retention_days <= 365),

  -- 该池只用于排除、永不作为投放目标（如「已转化」）。误投等于花钱找
  -- 已经成交的人。
  is_exclusion          BOOLEAN NOT NULL DEFAULT FALSE,

  -- 最近一次读到的规模。Meta 给的是区间不是精确值，所以存两端。
  -- 明细历史在 flywheel_metrics，这里只为月报免去 join。
  last_size_lower       INTEGER,
  last_size_upper       INTEGER,
  last_sized_at         TIMESTAMPTZ,

  -- 池子退役（删除 / 停用）后不删行，保留台账连续性。
  retired_at            TIMESTAMPTZ,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 一个 Meta 受众只登记一次。重跑建池器时靠它做 upsert，不产生重复行。
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_audience_assets_audience
  ON client_audience_assets(audience_id);

-- 台账主视图：某客户还活着的池子，按阶梯深度排。
CREATE INDEX IF NOT EXISTS idx_client_audience_assets_client
  ON client_audience_assets(client_id, retired_at, ladder_stage);

-- 归属交割用：查某客户哪些池子还没交出去（shared_to_business_id IS NULL）。
CREATE INDEX IF NOT EXISTS idx_client_audience_assets_handover
  ON client_audience_assets(client_id, shared_to_business_id);

ALTER TABLE client_audience_assets ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service_role_full" ON client_audience_assets FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON TABLE client_audience_assets IS
  'Audience Asset Engine (P18.E) 受众资产台账。存「池子是什么 + 归谁」；'
  '规模的时间序列在 flywheel_metrics 的 ads.audience.* 下，不在本表。';

COMMENT ON COLUMN client_audience_assets.audience_id IS
  'Meta custom audience id。台账的真实身份键 —— 不可靠受众名字反查。';

COMMENT ON COLUMN client_audience_assets.source_type IS
  'organic / paid / mixed。付费流量会稀释内容分层，两种来源的池子质量不同。';

COMMENT ON COLUMN client_audience_assets.shared_to_business_id IS
  '已共享到客户自己业务组合的 id。为空 = 尚未交割到客户手上。';

COMMENT ON COLUMN client_audience_assets.is_exclusion IS
  'TRUE 表示该池只用于排除，永不作为投放目标（如已转化人群）。';
