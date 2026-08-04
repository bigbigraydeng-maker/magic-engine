-- 地产漏斗 seed —— 7 格 + 2 个出口
--
-- ✅ 已 apply(2026-07-30, PM 显式 go apply)。库内版本号见文件名。
-- ✅ 已 apply:3 个中介客户 × 9 格 = 27 行已进库(SQL 已验证)。
--
-- WHY
-- ---
-- client_pipeline_stages 是「一客户一套」的可配置阶段模型,已上线(见
-- 20260728000001)。CTS 那 9 档是旅游的漏斗(报价 / 定金 / 全款 / 即将出行),
-- 地产完全不同:地产的胜负手是**到不到场**——约了看房、真的来了,是买家质量
-- 最强的两个信号,旅游漏斗里根本没有这两格。
--
-- 7 格主线 + 2 个出口(出口的做法照 CTS 现有客户:not_interested 终态 suppress、
-- no_response 不是终态、继续 nurture —— 没回不等于不要,只是这次没接上)。
--
-- stage_key 是稳定英文 slug(代码 / 审计 / 自动化引用,永不改);
-- label 是中文,运营可在 ME 后台改(GET/PATCH /api/clients/[id]/pipeline-stages,
-- 已存在)—— 不需要任何人去数据库改名字。
--
-- 目标客户
-- --------
-- 只 seed 真正的中介 / 开发商 client(已在生产库核对过 id):
--   19e025b7-555b-44fd-ba87-debc62a447a7  Park Homes
--   e7465ac7-4f3d-4d6a-afbe-d036ab419708  Roman HU
--   3a855a6f-4dbc-488d-96bf-b5e6a7558757  IB Real Estate
--
-- **刻意不 seed** 5a3fb2b7-72c3-471e-a5e7-1a528c0f776c('30 Kiteroa Rothesay Bay'):
-- 那行是「一套房被当成 client 建档」的历史错误,它应该变成一条 listings 行,
-- 不该拥有自己的漏斗。怎么迁移见 20260730000001_listings.sql 的注释。
--
-- 另外发现一行疑似重复档:e2d5d5d6-d0c5-4094-a147-3bfa984307d6 'Parkhomes'
-- (domain www.parhomes.nz,拼写少一个 k)。没 seed 它,也没删它 —— 删客户数据
-- 是不可逆操作,要 PM 单独授权。
--
-- 要给新的地产客户加漏斗:在下面 targets 的 VALUES 里加一行 UUID 即可,
-- 或者在 ME 后台配置页直接建(推荐,不用碰数据库)。
--
-- ON CONFLICT DO NOTHING:重跑安全;客户已经改过 label 的不会被这段盖回去。

WITH targets(client_id) AS (
  VALUES
    ('19e025b7-555b-44fd-ba87-debc62a447a7'::uuid),  -- Park Homes
    ('e7465ac7-4f3d-4d6a-afbe-d036ab419708'::uuid),  -- Roman HU
    ('3a855a6f-4dbc-488d-96bf-b5e6a7558757'::uuid)   -- IB Real Estate
),
stages(stage_key, label, sort_order, marketing_action, is_terminal) AS (
  VALUES
    -- 主线 7 格
    ('new',                 '新线索',   10, 'nurture',  FALSE),
    ('contacted',           '已联系',   20, 'nurture',  FALSE),
    -- 真买家 = 预算 / 时间 / 资格问清楚了。地产最贵的浪费就是带一堆看客去看房。
    ('qualified',           '真买家',   30, 'nurture',  FALSE),
    ('open_home_booked',    '约了看房', 40, 'nurture',  FALSE),
    -- 到场 = 买家质量最强的信号,广告优化的真正目标(不是表单数)。
    ('open_home_attended',  '到场了',   50, 'nurture',  FALSE),
    -- 出价了 = 进交易流程,停掉主动营销(照 CTS deposit_paid 的做法)。
    ('offer',               '出价了',   60, 'suppress', FALSE),
    ('purchased',           '成交',     70, 'won',      TRUE),
    -- 出口 2 格
    ('not_interested',      '不感兴趣', 80, 'suppress', TRUE),
    -- 没回 ≠ 不要。继续 nurture,不是终态(照 CTS 现有做法)。
    ('no_response',         '无下文',   90, 'nurture',  FALSE)
)
INSERT INTO client_pipeline_stages
  (client_id, stage_key, label, sort_order, marketing_action, is_terminal)
SELECT t.client_id, s.stage_key, s.label, s.sort_order, s.marketing_action, s.is_terminal
FROM targets t
CROSS JOIN stages s
ON CONFLICT (client_id, stage_key) DO NOTHING;
