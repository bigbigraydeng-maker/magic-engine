-- listing_briefs —— 每套房一份「档案」:当初以为什么 vs 实际发生了什么
--
-- 🔴 尚未 apply,等 PM 拍板。文件在仓里 ≠ 库里建好了。
--    apply 之后请把这一行改成「✅ 已 apply(日期, PM 显式 go apply)」,
--    并用 SQL 核对 supabase_migrations.schema_migrations 里确实有这个版本号。
--
-- WHY
-- ---
-- 20260730145332_listings.sql 让「一套房」成了对象,能横切聚合了。但光有事实
-- (suburb / price_band / 成交了没)学不到东西 —— 事实只告诉你结果,不告诉你
-- **当初为什么那么打**。同一套房卖掉了,是因为 buyer segment 判断对了,还是
-- 因为降价了?没有「当时的判断」这一栏,永远说不清。
--
-- 所以这张表的核心不是「记录一套房的资料」,而是**把判断和结果放在同一行里**:
--   · buyer_segments / angle_ranking / hesitations / market_snapshot / facts
--       = 投放之前我们**以为**的(AI 做功课 + 人校正后定稿)
--   · outcomes / verdict
--       = 跑完之后**实际**发生的(下一批做回填流程,本次只建字段)
-- 学习 = 这两栏的对照。少任何一栏,这张表都退化成又一个「资料页」。
--
-- 为什么照 master_briefs 的模式(version + status + 溯源三件套)
-- ------------------------------------------------------------
-- master_briefs 已经跑了三个月,证明「AI 出 draft → 人校正 → activate 生效 →
-- 旧版本留档」这条链在 ME 里站得住。这里原样复用,不发明新玩法:
--   status  draft / active / superseded
--   version 每套房自己从 1 开始递增(不是全局)
--   generated_by / model_used / input_tokens 溯源
-- 差别只有一处:master_briefs 用 'archived',这里用 'superseded' —— 语义是
-- 「被更新的版本顶掉了」,不是「归档不用了」。
--
-- 结构化 vs 自由文本的取舍
-- ------------------------
-- 唯一标准还是**能不能跨房子聚合**:
--   buyer_segments / angle_ranking.angle / hesitations → 全部走枚举,因为要问
--     「投资客这条线在 200 万档的房子上是不是普遍更贵」这种跨 20 套房的问题
--   rationale / notes / vendor_motivation → 自由文本,只给人看,不参与聚合
-- 没有把「卖点」做成自由文本 tag —— 自由文本 tag 攒到第 20 套房就是 60 个近义词,
-- 一个都聚不起来。宁可枚举窄一点,不够了再加(加值必须同步前端 Record,
-- 见 CLAUDE.md enum 硬约束)。
--
-- 🔴 数字必须有出处
-- ----------------
-- market_snapshot 里每一项都带 source。ME 因为「编数字」出过两次事故
-- (CTS 编行程 / Oztop 编搜索量),地产的中位价和租金回报是**客户会拿去跟卖家
-- 谈的数**,编一个比不填危险得多。查不到就进 gaps,不许估。
-- sources 这一列存的是逐条来源标记(有出处 / AI 判断 / 缺),前端据此三态显示。

CREATE TABLE IF NOT EXISTS listing_briefs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 归属的那套房。删房子连带删它的档案(档案脱离房子没有意义)。
  listing_id  UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,

  -- 每套房自己的版本号,从 1 起。不是全局序号 —— 「这套房改到第 3 版」比
  -- 「全库第 187 号档案」对运营有意义得多。
  version     SMALLINT NOT NULL DEFAULT 1,

  --   draft       AI 刚生成 / 人还在改,不生效
  --   active      校正完、已生效,给投放和内容用的就是这一版
  --   superseded  被后来的版本顶掉了。**留着**,因为「当初以为什么」的历史
  --               正是学习要对照的东西,删了等于把判断记录抹掉。
  status      TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'active', 'superseded')),

  -- ── 结构化层:能跨房子聚合的部分 ────────────────────────────────────────

  -- 谁会买这套房。枚举:
  --   first_home  首置    investor   投资客   wfh_family  在家办公的家庭
  --   upsizer     换大房  downsizer  换小房   overseas    海外买家
  -- 取值校验在 lib/listings/brief-constants.ts,数据库这层不加 CHECK ——
  -- 数组元素级 CHECK 在 PG 里要写成表达式约束,可读性极差且改起来要 PM 再拍一次板。
  -- 闸门放在应用层(所有写入路径都过 brief-schema.ts),数据库这层只保证是个数组。
  buyer_segments  TEXT[],

  -- 卖点排序。有序数组 [{angle, rank, rationale}]:
  --   angle 走枚举(见 brief-constants.ts 的 LISTING_ANGLES)
  --   rank  1 = 最该打的那条
  --   rationale 自由文本,说清为什么排这个位置(人校正时最常改的就是这一栏)
  -- 为什么是排序而不是打分:实际投放只能选一条主打,排序直接可执行,分数还要再翻译一次。
  angle_ranking   JSONB,

  -- 买家会犹豫什么。枚举:
  --   market_falling 怕还在跌   commute 通勤    terrace_vs_house 联排还是独立屋
  --   suburb_reputation 区不好  parking 车位    under_construction 期房没建好
  --   body_corp 管理费
  -- 这一栏是内容和广告最直接的输入 —— 广告文案就是逐条回应这些犹豫。
  hesitations     TEXT[],

  -- 同一个项目多个户型分开打:[{label, size_sqm, config, target_segments[]}]
  -- 例:2 房 78 平打首置、3 房 105 平打换大房 —— 混在一起打两边都打不准。
  unit_variants   JSONB,

  -- ── 市场快照:AI 查的,每一项都必须带 source ──────────────────────────
  -- {median_price:{value,source}, yoy_change_pct:{...}, rental_yield:{...},
  --  area_avg_yield:{...}, comparables:[{address, price, sold_on, source}]}
  -- 🔴 没有 source 的数字不许进这一列(应用层会挡),查不到就进 gaps。
  market_snapshot JSONB,

  -- ── 事实层:这套房本身的硬信息 ──────────────────────────────────────
  -- {price_method, completion_status, school_zone, nearby[], vendor_motivation}
  -- 这些多半来自房源页 / 中介自己知道,不是推断出来的。
  facts           JSONB,

  -- 还缺什么。自由文本(不做枚举 —— 缺口的形状事先列不全),
  -- 但它是**功能性**的:UI 上「缺」这一态就是照它渲染,人看到才知道该去补什么。
  gaps            TEXT[],

  -- ── 溯源 ────────────────────────────────────────────────────────────
  -- 逐条来源标记 [{field, kind, url, note}],kind ∈ cited / inferred / missing。
  -- 前端三态显示(有出处 / AI 判断 / 缺)靠的就是这一列。
  -- 这是本表跟「又一个资料页」的分界线:每一条信息都能问「这是谁说的」。
  sources         JSONB,
  generated_by    TEXT,           -- 'claude' / 'manual'
  model_used      TEXT,
  input_tokens    INTEGER,

  -- ── 结果回填(本次只建字段,回填流程下一批做)─────────────────────────
  -- {actual_segments[], winning_angle, cost_per_qualified, notes}
  -- 实际进来的是谁 / 哪条卖点真的转化了 / 一个够格的 lead 花了多少钱。
  -- 现在留空是正常的;等回填流程上线,这一栏跟上面的判断栏一对照,才有得学。
  outcomes        JSONB,

  --   pending    还没跑完 / 还没回填
  --   confirmed  当初的判断被验证了
  --   partly     对了一半
  --   reversed   跟当初想的相反 —— **最有价值的一档**,别嫌难看
  verdict         TEXT NOT NULL DEFAULT 'pending'
                    CHECK (verdict IN ('confirmed', 'partly', 'reversed', 'pending')),

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 「这套房现在生效的是哪一版 / 有没有草稿」—— 页面每次打开都要问。
CREATE INDEX IF NOT EXISTS idx_listing_briefs_listing_status
  ON listing_briefs(listing_id, status);

-- 「这套房改到第几版了」+ 算下一个 version 号。
CREATE INDEX IF NOT EXISTS idx_listing_briefs_listing_version
  ON listing_briefs(listing_id, version DESC);

-- 一套房同时只能有一个生效版本。这是硬约束而不是靠应用层自觉:
-- activate 的两步(旧的置 superseded + 新的置 active)之间如果有并发,
-- 没这个索引就会出现两个 active,而「生效的是哪一版」是投放的输入,不能有歧义。
CREATE UNIQUE INDEX IF NOT EXISTS idx_listing_briefs_one_active
  ON listing_briefs(listing_id)
  WHERE status = 'active';

-- RLS:service-role 模板(CLAUDE.md 强约束)。ME 不走 end-user RLS,
-- 一律 supabaseAdmin + 应用层 requireListingAccess 鉴权。
ALTER TABLE listing_briefs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON listing_briefs FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON TABLE listing_briefs IS
  '每套房一份档案:结构化的「当初以为什么」(buyer_segments / angle_ranking / hesitations / market_snapshot) + 「实际发生了什么」(outcomes / verdict)。学习来自两栏对照,不是来自任何一栏本身。';
