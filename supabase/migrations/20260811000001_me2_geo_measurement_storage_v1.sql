-- ============================================================================
-- Magic Engine 2.0 · GEO Measurement Storage v1  (Issue #875 · WP03)
--
-- 不可变测量存储。五张新增表，对应 GEO 测量契约 §4 的四层证据模型：
--   QuerySet(版本化，锁死后不可改) → Batch(一次采集执行) → Observation → Evidence
--
-- 🔴 本迁移只**建表**。不跑测量、不写页面、不改任何历史行、不接任何调用方。
-- 🔴 PM 显式 go 之后才 apply，agent 严禁自行 apply_migration。
--    apply 是一次单独授权的运维动作，不是合并 PR 的副产品（WP00 §9.2）。
--
-- 新增：
--   0. geo_unknown_reason          — 「不知道」理由码的域（冻结三值）
--   1. geo_query_sets              — 版本化查询集（首次被采集即锁死）
--   2. geo_queries                 — 集合内的问题（锁后成员不可增删改）
--   3. geo_batches                 — 一次采集执行（终态落库，落库即不可变）
--   4. geo_observations            — 问题 × 引擎/模型 × 样本（永远不可变）
--   5. geo_evidence                — 原始响应逐字保留 + 引用来源（永远不可变）
--
-- **刻意不建**（WP00 §15 U4 / GEO 契约 §10 明令未决，不许在此悄悄拍板）：
--   · 页面台账 / 规范页面注册表 —— 页面关联只记**判定结果**，不建台账
--   · 经核实的自有域名 / 别名清单（GEO 契约 §10 M8 未决）
--   · 聚合指标表 —— 七个指标从不可变的观测与证据**算出来**，不落库。
--     落库就必然要更新，更新就违反不可变性。
--   · loop_run_id / verification_id / 统一 learning_record_id（WP00 §15 U4）
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 0. geo_unknown_reason —— 「不知道」的理由码
--
-- 🔴 为什么用 DOMAIN 而不是在二十来个列上各写一遍 CHECK：
--    这三个值是 WP02 冻结的 `GeoUnknownReason`（types.ts）。分散成二十份
--    字面量清单，迟早有一处漏改而无人发现 —— 而「未知理由」写错的后果，
--    正是下游把「不知道」读成别的意思，那是这整份契约要防的第一件事。
-- ────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE DOMAIN public.geo_unknown_reason AS text
    CHECK (VALUE IN ('not_recorded_by_source', 'not_applicable', 'source_ambiguous'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON DOMAIN public.geo_unknown_reason IS
  'GEO 契约 §3.4：缺失的维度必须显式记成「未知」并带理由码，不许省略、不许填默认值。三值与 WP02 的 GeoUnknownReason 逐字一致。';


-- ────────────────────────────────────────────────────────────────────────────
-- 1. geo_query_sets —— 版本化查询集（GEO 契约 §4.1）
--
-- 一旦这个版本被用于采集，问题文本永不可改。锁的动作不靠调用方自觉：
-- 第一条批次插进来的时候，触发器自己把 locked_at 写上（见 §6.4）。
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.geo_query_sets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 🔴 client_id 一律 NO ACTION（不写 ON DELETE）。
  --    仓库惯例是 ON DELETE CASCADE，这里**故意不跟**，理由是生产上实测过的：
  --    「外键级联动作是一条真实的 UPDATE / DELETE，会正常触发行级触发器」——
  --    client_assets 的 listing_id 写成 ON DELETE SET NULL，撞上「绑定后不可改挂」
  --    的触发器，结果任何一套绑过素材的房源都删不掉，报的还是一句前后不搭的错。
  --    （那次的修复迁移 20260805140000 目前只在 client/parkhomes-site 分支上，
  --      主线还没有 —— 所以这条教训在 main 上除了这里没有别处写着。）
  --    这五张表都挂着「不许删」的触发器，若这里写 CASCADE，删客户时
  --    级联的 DELETE 会被触发器抛回来，报出一句跟「删客户」毫不搭界的
  --    「geo_observations is append-only」。
  --    NO ACTION 的语义是诚实的：**客户有 GEO 历史就删不掉**，
  --    要删先显式归档 —— 而且报的是一句标准的外键引用错误，看得懂。
  client_id         uuid NOT NULL REFERENCES public.clients(id),

  query_set_version text NOT NULL,

  -- 非空即锁死。NULL → 一个时间戳的转换在整张表的生命周期里只允许发生一次。
  --
  -- 🔴 这一列**故意不配 locked_at_unknown_reason**，是本迁移里唯一一个不走
  --    「已知值 + 未知理由」那套的可空列。理由：上锁与否是**我们自己掌握的事实**
  --    （由下面 §6.4 的触发器写上），不存在「不知道锁没锁」这种状态。
  --    读取时的映射是钉死的：NULL ⇒ { known:false, reason:'not_applicable' }。
  --    ⚠️ 将来做「一致性清理」的人别顺手给它补一个 _unknown_reason 列 ——
  --       那会凭空造出一个语义上不存在的状态。（有一条测试盯着这条。）
  locked_at         timestamptz,

  created_by        text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_geo_query_sets_client_version UNIQUE (client_id, query_set_version)
);

-- 🔴 复合外键的落点。`id` 本身就是主键（全表唯一），所以 (id, client_id)
--    这个组合**不可能因历史数据冲突而失败**（照抄 Kernel v1 给 goals 建
--    idx_goals_client_id_id 时的同一条推理）。
CREATE UNIQUE INDEX IF NOT EXISTS idx_geo_query_sets_client_id_id
  ON public.geo_query_sets (client_id, id);

ALTER TABLE public.geo_query_sets ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  -- 🔴 必须写 TO service_role。漏掉 = 对匿名访客敞开读写（2026-08-03 实测泄露 118 条策略）。
  CREATE POLICY "service_role_full" ON public.geo_query_sets
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 2. geo_queries —— 集合里的单个问题
--
-- 🔴 client_id 是 NOT NULL 的，而且靠复合外键跟父集合**同租户**绑死 ——
--    不是「各自挂一条到 clients 的外键」那种假隔离（那拦不住 A 客户的问题
--    挂到 B 客户的查询集上）。
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.geo_queries (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             uuid NOT NULL REFERENCES public.clients(id),
  query_set_id          uuid NOT NULL,

  -- 单个问题的稳定语义键（GEO 契约 §3.1 第 2 项）。只有行 id 的话，
  -- 问题被原地改写就无声断链。
  query_key             text NOT NULL,
  question_text         text NOT NULL,

  locale                text,
  locale_unknown_reason public.geo_unknown_reason,

  market                text,
  market_unknown_reason public.geo_unknown_reason,

  -- 弃用靠停用标记，不靠删除（GEO 契约 §4.1）。锁死之后连它也不许改 ——
  -- 改了就是换了一套题，必须发新版本。
  is_active             boolean NOT NULL DEFAULT true,

  created_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_geo_queries_set_key UNIQUE (query_set_id, query_key),

  -- 🔴 跨客户结构性隔离：A 客户的问题在库层就挂不到 B 客户的查询集上，
  --    哪怕写入方是 service_role。单列外键只验证「父行存在」，验不了「同一个客户」。
  --    未锁死的集合可以整体删掉（还在拟题阶段），所以这条用 CASCADE；
  --    一旦锁死，父集合自己的触发器就不许删了，级联也就永远走不到。
  CONSTRAINT fk_geo_queries_set_same_client
    FOREIGN KEY (client_id, query_set_id)
    REFERENCES public.geo_query_sets (client_id, id) ON DELETE CASCADE,

  -- 已知与未知二选一，且必须选一个（GEO 契约 §3.4 第 3 条）。
  CONSTRAINT geo_queries_locale_known_xor_unknown
    CHECK (num_nonnulls(locale, locale_unknown_reason) = 1),
  CONSTRAINT geo_queries_market_known_xor_unknown
    CHECK (num_nonnulls(market, market_unknown_reason) = 1)
);

CREATE INDEX IF NOT EXISTS idx_geo_queries_set_active
  ON public.geo_queries (query_set_id) WHERE is_active;

ALTER TABLE public.geo_queries ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.geo_queries
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 3. geo_batches —— 一次采集执行（GEO 契约 §4.2）
--
-- 🔴 状态只有三个值，与 WP02 冻结的 `GeoBatch['status']` 逐字一致：
--    completed / partial / failed。**刻意没有 running。**
--    WP03 存的是测量真相，不是调度状态；「正在跑」属于既有的执行层
--    （Kernel / action_runs），不该在证据表里再造一份。
--    因此批次是**跑完（或跑挂）之后才作为终态插入**的，插入即不可变。
--    「部分完成是一等结论，不许四舍五入成完成」——所以 partial 不是失败的
--    委婉说法，它就是结论本身。
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.geo_batches (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                   uuid NOT NULL REFERENCES public.clients(id),
  query_set_id                uuid NOT NULL,

  started_at                  timestamptz NOT NULL,

  -- GeoBatch.completedAt 是 GeoMaybeUnknown<string> —— failed 的批次可能
  -- 根本说不出什么时候结束的，那就诚实记未知，不许拿 started_at 顶替。
  completed_at                timestamptz,
  completed_at_unknown_reason public.geo_unknown_reason,

  status                      text NOT NULL
                                CHECK (status IN ('completed', 'partial', 'failed')),

  -- 计划覆盖 vs 实际成功覆盖。两份都留着，§7.2 的「差在哪」才回答得了。
  -- 形状与 WP02 的 GeoCoverageDescriptor 一一对应。
  planned_coverage            jsonb NOT NULL,
  actual_coverage             jsonb NOT NULL,

  cost_usd                    numeric,
  cost_usd_unknown_reason     public.geo_unknown_reason,

  triggered_by                text,
  triggered_by_unknown_reason public.geo_unknown_reason,

  created_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fk_geo_batches_set_same_client
    FOREIGN KEY (client_id, query_set_id)
    REFERENCES public.geo_query_sets (client_id, id),

  CONSTRAINT geo_batches_completed_at_known_xor_unknown
    CHECK (num_nonnulls(completed_at, completed_at_unknown_reason) = 1),
  CONSTRAINT geo_batches_cost_known_xor_unknown
    CHECK (num_nonnulls(cost_usd, cost_usd_unknown_reason) = 1),
  CONSTRAINT geo_batches_triggered_by_known_xor_unknown
    CHECK (num_nonnulls(triggered_by, triggered_by_unknown_reason) = 1),

  -- 🔴 覆盖描述必须真的能回答 §7.2 那四个问题，所以八个键一个都不能少，
  --    而且类型要对得上 WP02 的 GeoCoverageDescriptor（五个数组 + 三个计数）。
  --    只写 jsonb_typeof = 'object' 拦不住「塞个 {} 当覆盖率」。
  --
  -- 🔴 每一项都套了 COALESCE，不是啰嗦：`jsonb_typeof(x -> '不存在的键')`
  --    返回的是 NULL，而 CHECK 约束**在表达式为 NULL 时是放行的**（只有 FALSE 才拒）。
  --    不套 COALESCE 的话，「八个键一个都没有」反而能顺利写进去 ——
  --    一条看起来很严格、实际上什么都拦不住的约束。
  CONSTRAINT geo_batches_planned_coverage_shape CHECK (
    jsonb_typeof(planned_coverage) = 'object'
    AND COALESCE(jsonb_typeof(planned_coverage -> 'engines'),   '') = 'array'
    AND COALESCE(jsonb_typeof(planned_coverage -> 'models'),    '') = 'array'
    AND COALESCE(jsonb_typeof(planned_coverage -> 'locales'),   '') = 'array'
    AND COALESCE(jsonb_typeof(planned_coverage -> 'markets'),   '') = 'array'
    AND COALESCE(jsonb_typeof(planned_coverage -> 'queryKeys'), '') = 'array'
    AND COALESCE(jsonb_typeof(planned_coverage -> 'attempted'), '') = 'number'
    AND COALESCE(jsonb_typeof(planned_coverage -> 'succeeded'), '') = 'number'
    AND COALESCE(jsonb_typeof(planned_coverage -> 'failed'),    '') = 'number'
  ),
  CONSTRAINT geo_batches_actual_coverage_shape CHECK (
    jsonb_typeof(actual_coverage) = 'object'
    AND COALESCE(jsonb_typeof(actual_coverage -> 'engines'),   '') = 'array'
    AND COALESCE(jsonb_typeof(actual_coverage -> 'models'),    '') = 'array'
    AND COALESCE(jsonb_typeof(actual_coverage -> 'locales'),   '') = 'array'
    AND COALESCE(jsonb_typeof(actual_coverage -> 'markets'),   '') = 'array'
    AND COALESCE(jsonb_typeof(actual_coverage -> 'queryKeys'), '') = 'array'
    AND COALESCE(jsonb_typeof(actual_coverage -> 'attempted'), '') = 'number'
    AND COALESCE(jsonb_typeof(actual_coverage -> 'succeeded'), '') = 'number'
    AND COALESCE(jsonb_typeof(actual_coverage -> 'failed'),    '') = 'number'
  ),

  -- 🔴 三个计数必须是**真正的计数**：非负整数。
  --    只判 jsonb_typeof = 'number' 是不够的 —— `-9`、`1.5`、`1e9` 都是合法的
  --    JSON number，照样写得进去。而批次落库即不可变，这种行**永远修不掉**，
  --    还会一路污染失败率与引擎覆盖率（两者都是 §6.1 第 3 条的可比性硬闸，
  --    阈值 0.2 / 0.8），最后让一次比较得出反的结论。
  --
  --    判据写成对 `->>` 文本形态做正则：不需要任何强制转换，所以**永远不会报类型错**；
  --    键缺失时 `->>` 返回 NULL，COALESCE 成 false —— 失败关闭，不是静默放行。
  CONSTRAINT geo_batches_planned_counts_are_counts CHECK (
    COALESCE((planned_coverage ->> 'attempted') ~ '^[0-9]+$', false)
    AND COALESCE((planned_coverage ->> 'succeeded') ~ '^[0-9]+$', false)
    AND COALESCE((planned_coverage ->> 'failed')    ~ '^[0-9]+$', false)
  ),
  CONSTRAINT geo_batches_actual_counts_are_counts CHECK (
    COALESCE((actual_coverage ->> 'attempted') ~ '^[0-9]+$', false)
    AND COALESCE((actual_coverage ->> 'succeeded') ~ '^[0-9]+$', false)
    AND COALESCE((actual_coverage ->> 'failed')    ~ '^[0-9]+$', false)
  ),

  -- 🔴 **实际**覆盖的三个数还得对得上：尝试了多少，就该等于成功多少 + 失败多少。
  --    `{"attempted":1,"succeeded":10,"failed":-9}` 这种行一旦落库就是永久的假账。
  --
  -- 🔴 这一条**只管 actual，不管 planned**。计划覆盖在下单那一刻
  --    succeeded / failed 本来就是 0（还没跑），attempted 却是整批的量 ——
  --    对 planned 也套这条等式会把每一次合法的计划都拦下来。
  --
  --    用 CASE 包住是为了让强制转换只在正则已经证明「全是数字」之后才发生：
  --    SQL 的 AND 不保证短路求值，裸写会撞出类型错误而不是约束冲突。
  --    ELSE false = 说不清楚就不许写。
  CONSTRAINT geo_batches_actual_counts_add_up CHECK (
    CASE
      WHEN (actual_coverage ->> 'attempted') ~ '^[0-9]+$'
       AND (actual_coverage ->> 'succeeded') ~ '^[0-9]+$'
       AND (actual_coverage ->> 'failed')    ~ '^[0-9]+$'
      THEN (actual_coverage ->> 'attempted')::numeric
         = (actual_coverage ->> 'succeeded')::numeric + (actual_coverage ->> 'failed')::numeric
      ELSE false
    END
  ),

  -- 🔴 花费必须是个真实金额。numeric 的 NaN / Infinity 坑在生产 PG 17.6
  --    实测过：`'NaN'::numeric >= 0` 是 true，只写 `>= 0` 拦不住它
  --    （判据与 action_run_steps.cost_actual_usd 逐条一致）。
  CONSTRAINT geo_batches_cost_is_a_real_amount CHECK (
    cost_usd IS NULL
    OR (cost_usd >= 0 AND cost_usd <> 'NaN'::numeric AND cost_usd < 'Infinity'::numeric)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_geo_batches_client_id_id
  ON public.geo_batches (client_id, id);
CREATE INDEX IF NOT EXISTS idx_geo_batches_client_started
  ON public.geo_batches (client_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_geo_batches_query_set
  ON public.geo_batches (query_set_id);

ALTER TABLE public.geo_batches ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.geo_batches
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 4. geo_observations —— 一个问题 × 一个引擎/模型 × 一次样本（GEO 契约 §4.3）
--
-- 🔴 采集身份写在**观测行上**，不是写在问题上（§3.4 第 1 条）。
--    只把 market 挂在问题上，重跑时换了市场就查不出来。
-- 🔴 失败也是观测。不落行会让「问了但失败了」和「根本没问」在库里长得
--    一模一样，覆盖率就永远算不准。
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.geo_observations (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                     uuid NOT NULL REFERENCES public.clients(id),
  batch_id                      uuid NOT NULL,

  -- ── 采集身份七项（§3.1）。第 7 项 sample 按 §3.2 拆成三件事 ──────────────
  query_set_version             text,
  query_set_version_unknown_reason public.geo_unknown_reason,
  query_key                     text,
  query_key_unknown_reason      public.geo_unknown_reason,
  engine_family                 text,
  engine_family_unknown_reason  public.geo_unknown_reason,
  model_version                 text,
  model_version_unknown_reason  public.geo_unknown_reason,
  locale                        text,
  locale_unknown_reason         public.geo_unknown_reason,
  market                        text,
  market_unknown_reason         public.geo_unknown_reason,

  -- 样本计划 / 数量：这一轮打算问几次（批次层的意图，逐条记在观测上以便重建）
  sample_planned_count          integer,
  sample_planned_count_unknown_reason public.geo_unknown_reason,
  -- 样本序号 / 复本身份：这一行是第几次
  sample_index                  integer,
  sample_index_unknown_reason   public.geo_unknown_reason,
  -- 影响输出的采样参数（温度 / 种子等）。拿不到就记未知，不许编。
  sampling_parameters           jsonb,
  sampling_parameters_unknown_reason public.geo_unknown_reason,

  -- ── 解释身份（§3.3）─────────────────────────────────────────────────────
  parser_version                text,
  parser_version_unknown_reason public.geo_unknown_reason,
  metric_rules_version          text,
  metric_rules_version_unknown_reason public.geo_unknown_reason,

  -- 🔴 置信度是**质量信号与阈值，不是身份维度**（§3.3 末段）。
  --    置信度低不会让一条观测变成「另一次观测」，只决定它够不够格进统计。
  confidence                    numeric,
  confidence_unknown_reason     public.geo_unknown_reason,

  observed_at                   timestamptz NOT NULL,

  -- ── 成败（§4.3）──────────────────────────────────────────────────────────
  outcome_ok                    boolean NOT NULL,
  error_code                    text,
  error_message                 text,
  error_message_unknown_reason  public.geo_unknown_reason,

  -- ── 存储层 lineage：重新解析的来源 ───────────────────────────────────────
  -- 🔴 只表达「这一条是从哪条原始观测重新解析出来的」，不表达别的。
  --    正常采集：NULL。重新解析：**新批次 + 新观测行**，这一列指回原观测，
  --    原观测与原证据一个字都不动（§4.4「重新解析产生新结果，绝不覆盖历史」）。
  --    WP03 不实现重新解析的执行器，只让这条血缘**表达得出来**。
  source_observation_id         uuid,

  created_at                    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fk_geo_observations_batch_same_client
    FOREIGN KEY (client_id, batch_id)
    REFERENCES public.geo_batches (client_id, id),

  -- 🔴 自引用的那条外键**不能写在这里**：它要指向 (id, client_id) 这个组合，
  --    而承载这个组合的唯一索引要等本表建完才建得出来。写在建表语句里会当场
  --    报「there is no unique constraint matching given keys」。见 §5b 补建。

  CONSTRAINT geo_obs_query_set_version_xor
    CHECK (num_nonnulls(query_set_version, query_set_version_unknown_reason) = 1),
  CONSTRAINT geo_obs_query_key_xor
    CHECK (num_nonnulls(query_key, query_key_unknown_reason) = 1),
  CONSTRAINT geo_obs_engine_family_xor
    CHECK (num_nonnulls(engine_family, engine_family_unknown_reason) = 1),
  CONSTRAINT geo_obs_model_version_xor
    CHECK (num_nonnulls(model_version, model_version_unknown_reason) = 1),
  CONSTRAINT geo_obs_locale_xor
    CHECK (num_nonnulls(locale, locale_unknown_reason) = 1),
  CONSTRAINT geo_obs_market_xor
    CHECK (num_nonnulls(market, market_unknown_reason) = 1),
  CONSTRAINT geo_obs_sample_planned_count_xor
    CHECK (num_nonnulls(sample_planned_count, sample_planned_count_unknown_reason) = 1),
  CONSTRAINT geo_obs_sample_index_xor
    CHECK (num_nonnulls(sample_index, sample_index_unknown_reason) = 1),
  CONSTRAINT geo_obs_sampling_parameters_xor
    CHECK (num_nonnulls(sampling_parameters, sampling_parameters_unknown_reason) = 1),
  CONSTRAINT geo_obs_parser_version_xor
    CHECK (num_nonnulls(parser_version, parser_version_unknown_reason) = 1),
  CONSTRAINT geo_obs_metric_rules_version_xor
    CHECK (num_nonnulls(metric_rules_version, metric_rules_version_unknown_reason) = 1),
  CONSTRAINT geo_obs_confidence_xor
    CHECK (num_nonnulls(confidence, confidence_unknown_reason) = 1),

  CONSTRAINT geo_obs_sample_counts_non_negative CHECK (
    (sample_planned_count IS NULL OR sample_planned_count >= 0)
    AND (sample_index IS NULL OR sample_index >= 0)
  ),
  CONSTRAINT geo_obs_sampling_parameters_is_object CHECK (
    sampling_parameters IS NULL OR jsonb_typeof(sampling_parameters) = 'object'
  ),

  -- 置信度是 [0,1] 的比率。NaN 在 numeric 里能绕过 `>= 0`，必须单独拦。
  CONSTRAINT geo_obs_confidence_is_a_ratio CHECK (
    confidence IS NULL
    OR (confidence >= 0 AND confidence <= 1 AND confidence <> 'NaN'::numeric)
  ),

  -- 失败必须有机器可读的码，成功不许有
  CONSTRAINT geo_obs_error_code_matches_outcome
    CHECK ((outcome_ok = false) = (error_code IS NOT NULL)),
  -- 失败时错误消息「已知/未知」二选一；成功时两个都必须为空
  CONSTRAINT geo_obs_error_message_present_on_failure
    CHECK (outcome_ok OR num_nonnulls(error_message, error_message_unknown_reason) = 1),
  CONSTRAINT geo_obs_error_message_absent_on_success
    CHECK (NOT outcome_ok OR (error_message IS NULL AND error_message_unknown_reason IS NULL)),

  -- 🔴 一条观测不许拿自己当重新解析的来源
  CONSTRAINT geo_obs_source_is_not_self
    CHECK (source_observation_id IS DISTINCT FROM id)
);

-- 🔴 复合外键的落点（自引用与 geo_evidence 都要用）
CREATE UNIQUE INDEX IF NOT EXISTS idx_geo_observations_client_id_id
  ON public.geo_observations (client_id, id);

-- ── 5b. 补上自引用外键（建表顺序所致，索引建好之后才加得上）────────────────
-- 🔴 自引用也必须同租户：重新解析不许跨客户认爹。
--    MATCH SIMPLE 语义下 source_observation_id 为 NULL 时本约束自动放过，
--    所以「正常采集的观测」（source 恒为 NULL）完全不受影响。
--    刻意不写 ON DELETE：原观测本来就删不掉（不可变触发器挡着），
--    这条外键只负责把「跨客户认爹」在结构上变成不可能。
DO $$ BEGIN
  ALTER TABLE public.geo_observations
    ADD CONSTRAINT fk_geo_observations_source_same_client
    FOREIGN KEY (client_id, source_observation_id)
    REFERENCES public.geo_observations (client_id, id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 🔴 同一个批次里，同一个（问题 × 引擎 × 模型 × 样本序号）只准有一行。
--
--    这条约束的用途是**撞出重复插入的 bug**，不是给 upsert 当靶子 ——
--    行业级归档那套 `UNIQUE + .upsert(onConflict)` 正好相反，它会把上一次
--    的行覆盖掉，那是本设计明令不走的路。
--
--    NULLS NOT DISTINCT（PG 15+，生产 17.6）是刻意的：默认语义下 NULL 互不相等，
--    于是只要任何一个维度是「未知」，重复插入就悄悄溜过去了 —— 而两条各维度
--    都相同、且都说不清自己是第几次的观测，本来就无法彼此区分。
--    重新解析不受影响：它走的是**新批次**，batch_id 不同。
--
-- 🔴 locale 与 market 必须在键里。一个批次的覆盖面本来就横跨多个语言与市场
--    （GeoCoverageDescriptor 的 locales[] / markets[]），少了这两列，
--    「同一个问题在 en-NZ 问一遍、在 zh-CN 再问一遍」会被当成重复插入**拒掉** ——
--    把一条防重复的约束变成一条阻断合法采集的约束。
--    query_set_version 不在键里：它由 batch_id 唯一决定（批次挂着查询集，且集合已锁死）。
--
-- 🔴 代价说清楚：写入方若连 sample_index 都说不出来，第二条同维度的观测会插不进去。
--    这是**响亮的报错**，不是静默丢行 —— 宁可让 WP04 当场炸，也不要把两条分不清彼此的
--    观测混进覆盖率里。
CREATE UNIQUE INDEX IF NOT EXISTS idx_geo_observations_no_double_insert
  ON public.geo_observations
     (batch_id, query_key, engine_family, model_version, locale, market, sample_index)
  NULLS NOT DISTINCT;

-- 可比性队列匹配（§6.1 第 1 条就是拿这几项逐项对齐）
CREATE INDEX IF NOT EXISTS idx_geo_observations_cohort
  ON public.geo_observations
     (client_id, query_set_version, query_key, engine_family, model_version, locale, market);
-- 每批次的覆盖率 / 失败率汇总
CREATE INDEX IF NOT EXISTS idx_geo_observations_batch_outcome
  ON public.geo_observations (batch_id, outcome_ok);
CREATE INDEX IF NOT EXISTS idx_geo_observations_source
  ON public.geo_observations (source_observation_id)
  WHERE source_observation_id IS NOT NULL;

ALTER TABLE public.geo_observations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.geo_observations
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 5. geo_evidence —— 原始响应与引用来源（GEO 契约 §4.4）
--
-- 🔴 原始响应**逐字保留**，供解析逻辑改进后重新解析。这是解释身份能起作用的
--    物质前提 —— 只有原始回答还在，两侧才可能「用同一个 parser 版本重新解析
--    一遍」再比（§6.1 第 2 条）。
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.geo_evidence (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                     uuid NOT NULL REFERENCES public.clients(id),

  -- 一条成功的观测对应一条证据（WP02 的 GeoEvidence.observationId 是单数）
  observation_id                uuid NOT NULL,

  -- 🔴 v1 就地存文本，不发明 S3 / Storage / 外部证据系统。
  raw_response                  text,
  raw_response_unknown_reason   public.geo_unknown_reason,

  -- 🔴 定位符由**证据自己的身份**推导出来，不是另存一份可以跟正文对不上的字符串。
  --    GENERATED ... STORED 让「两个可变真相源」这件事在结构上不可能发生。
  --    原始响应记未知时定位符也就为 NULL —— 对应 WP02 的
  --    `rawResponseLocator: {known:false, reason}`，而不是一个指向空气的地址。
  raw_response_locator          text GENERATED ALWAYS AS (
                                  CASE WHEN raw_response IS NOT NULL
                                       THEN 'db://public.geo_evidence/' || id::text || '/raw_response'
                                       ELSE NULL END
                                ) STORED,

  -- 🔴 引用来源保持 JSONB 数组：当前契约就把它当结构化数组用，
  --    而且还没有任何一个关系型查询模式需要按 citation 检索。
  --    每个元素逐字保留 WP02 的 GeoCitation：
  --      { url, domain, ownedDomain: {known,...}, ownedPage: {status,...} }
  --    Roman 没有页面台账这件事，在这里的诚实形态是
  --      ownedPage = {status:'not_computable', reason:'...'}
  --    —— 不是 0、不是 false、不是把这个字段省掉，更不是指向一张不存在的页面表。
  --
  -- 🔴 刻意**不给 DEFAULT '[]'**。空数组是一个有内容的结论（「这条回答一个来源都没引」），
  --    给了默认值，写入方忘了传就会自动替它下这个结论 —— 正是契约反复强调的
  --    「补 0 会被读成一次都没有」。必须由写入方显式写出来。
  citations                     jsonb NOT NULL,

  created_at                    timestamptz NOT NULL DEFAULT now(),

  -- 🔴 **这条唯一约束保证「最多一条」，保证不了「至少一条」。**
  --    数据库拦不住「成功的观测却没有证据行」：两次 INSERT 经 PostgREST 是两个事务，
  --    跨表的延迟约束在这条路径上根本没有生效的时机。
  --    所以这是一条**写入方的义务**（WP04：先写证据、再写观测，或同一个事务里两条一起写），
  --    不是库层的保证。诚实地写在这里，好过假装它被拦住了 ——
  --    真出现这种行，读的时候会当场炸（WP02 校验器要求 ok:true 必须带 evidenceId）。
  CONSTRAINT uq_geo_evidence_observation UNIQUE (observation_id),

  CONSTRAINT fk_geo_evidence_observation_same_client
    FOREIGN KEY (client_id, observation_id)
    REFERENCES public.geo_observations (client_id, id),

  CONSTRAINT geo_evidence_raw_response_xor
    CHECK (num_nonnulls(raw_response, raw_response_unknown_reason) = 1),
  CONSTRAINT geo_evidence_citations_is_array
    CHECK (jsonb_typeof(citations) = 'array')
);

ALTER TABLE public.geo_evidence ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.geo_evidence
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ============================================================================
-- 6. 不可变性 —— 由触发器强制，不是由 RLS，也不是由注释
--
-- 🔴 RLS 不是不可变机制：service_role **绕过 RLS**，而这几张表的写入方
--    （将来的 WP04）本来就是 service_role。RLS 在这里只干一件事 ——
--    让 anon / authenticated 连读都读不到（没有匹配策略 = 默认拒绝）。
--    真正拦住「改历史」的只有触发器：它对**所有角色**都会触发。
-- ============================================================================

-- ── 6.1 通用：禁止 TRUNCATE ─────────────────────────────────────────────────
-- 🔴 行级触发器在 TRUNCATE 上**不会触发**。少了这一条，上面所有的
--    「不许删」就都能被一句 TRUNCATE 绕过去。
CREATE OR REPLACE FUNCTION public.geo_forbid_truncate()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION '% 是不可变的测量证据，不允许 TRUNCATE', TG_TABLE_NAME;
END;
$$;

-- ── 6.2 geo_query_sets：只允许上锁那一次写入 ───────────────────────────────
CREATE OR REPLACE FUNCTION public.geo_query_sets_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- 🔴 建集合时不许自带锁定时间。
  --    只挡 UPDATE 是挡不住的：调用方可以直接 INSERT 一条 locked_at 是 2020 年的集合，
  --    它当场就被视为已锁定 —— 再也加不进问题，而且时间还是假的、也改不回来
  --    （UPDATE 分支看到 OLD.locked_at 非空就一律拒绝）。
  --    整个「首个批次落地时才由数据库上锁」的说法就是这么被绕过去的。
  IF TG_OP = 'INSERT' THEN
    IF NEW.locked_at IS NOT NULL THEN
      RAISE EXCEPTION
        '查询集不能在创建时就带着锁定时间（收到 %）：上锁只能由第一个批次落地时触发。',
        NEW.locked_at
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    -- 还没被任何批次用过的集合可以整体删掉（拟题阶段）；
    -- 一旦锁死，它就是历史的一部分了。
    IF OLD.locked_at IS NOT NULL THEN
      RAISE EXCEPTION
        '查询集 % 已于 % 锁定，不能删除。改问题请发新版本。', OLD.id, OLD.locked_at
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  -- 唯一允许的 UPDATE：把 locked_at 从 NULL 写成一次值。其余列一律冻结。
  IF OLD.locked_at IS NOT NULL THEN
    RAISE EXCEPTION
      '查询集 % 已于 % 锁定，任何字段都不可再改。', OLD.id, OLD.locked_at
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.locked_at IS NULL THEN
    RAISE EXCEPTION
      '查询集 % 的字段不可原地修改（只允许一次上锁）。', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  -- 🔴 上锁只能走「首个批次落地」那一条路，调用方不能自己 UPDATE 抢锁。
  --
  --    只堵住 INSERT 是不够的：`UPDATE geo_query_sets SET locked_at = now()`
  --    照样能穿过上面所有判据（旧值为空、新值非空、别的列没动），于是一个
  --    **一道题都还没拟完、一个批次都还没跑**的集合就被永久锁死了 ——
  --    解不开（再 UPDATE 会撞「已锁定」）、加不了题、也删不掉（锁定的集合不许删）。
  --    一次手滑就能把一个在建的查询集彻底做废，而且没有任何恢复路径。
  --
  --    判据用 pg_trigger_depth()：合法的那次上锁是 geo_batches 的 BEFORE INSERT
  --    触发器（深度 1）内部发出的 UPDATE，本守卫因此在**深度 2**触发；
  --    而调用方直接 UPDATE 时本守卫在**深度 1**触发。调用方伪造不了触发深度。
  IF pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION
      '查询集 % 不能被直接锁定：locked_at 只由第一个批次落地时的触发器写入。', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF ROW(NEW.id, NEW.client_id, NEW.query_set_version, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.client_id, OLD.query_set_version, OLD.created_by, OLD.created_at)
  THEN
    RAISE EXCEPTION
      '查询集 % 上锁时不许顺手改别的字段。', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  -- 🔴 上锁时间由数据库说了算，**无视调用方传进来的值**。
  --    不强制的话，可以手写一个倒填的 locked_at，让一个集合看起来在某次采集
  --    **之前**就已经冻结 —— 于是「这批数据用的是当时锁死的那套题」这句话
  --    就再也没法自证了。手法照抄 client_automation_policies_version_guard：
  --    调用方不能决定这类字段的值。
  NEW.locked_at := now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS geo_query_sets_guard_trigger ON public.geo_query_sets;
CREATE TRIGGER geo_query_sets_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON public.geo_query_sets
  FOR EACH ROW EXECUTE FUNCTION public.geo_query_sets_guard();

DROP TRIGGER IF EXISTS geo_query_sets_no_truncate ON public.geo_query_sets;
CREATE TRIGGER geo_query_sets_no_truncate
  BEFORE TRUNCATE ON public.geo_query_sets
  FOR EACH STATEMENT EXECUTE FUNCTION public.geo_forbid_truncate();

-- ── 6.3 geo_queries：锁后成员不可增、不可改、不可删 ────────────────────────
--
-- 🔴 三件事要分开挡，少一件这道锁就是漏的：
--    · 改问题        → BEFORE UPDATE
--    · 删问题        → BEFORE DELETE
--    · **往里加问题** → BEFORE INSERT（UPDATE/DELETE 触发器拦不住集合长大）
CREATE OR REPLACE FUNCTION public.geo_queries_locked_set_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_set_id    uuid;
  v_locked_at timestamptz;
BEGIN
  -- 🔴 问题的身份不可原地改。这一段不只是洁癖，它堵的是一个真的洞：
  --    `UPDATE geo_queries SET query_set_id = <另一个没锁的集合> WHERE query_set_id = <锁死的集合>`
  --    如果只看 NEW 的父集合，会被判成「目标集合没锁，放行」——
  --    而它实际做的事是把一道题从**已锁定**的集合里搬走，成员就这么少了一条。
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.client_id IS DISTINCT FROM OLD.client_id
       OR NEW.query_set_id IS DISTINCT FROM OLD.query_set_id THEN
      RAISE EXCEPTION
        '问题 % 的身份（id / 所属客户 / 所属查询集）不可原地修改：要换集合请在新版本里新建一条。',
        OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- 改与删看**旧**的父集合，插看新的。（身份已冻结，UPDATE 时两者其实相同。）
  v_set_id := CASE WHEN TG_OP = 'INSERT' THEN NEW.query_set_id ELSE OLD.query_set_id END;

  -- 🔴 行锁不是装饰：上锁本身是另一个事务里的一句 UPDATE。
  --    不锁住父行的话，「正在被锁定」和「往里插一个新问题」可以并发穿过去，
  --    于是一个已经开始采集的版本还能再长出一道题。
  --    外键自带的那把 KEY SHARE 锁挡不住这件事 —— locked_at 不是键列。
  --
  -- 🔴 强度必须是 FOR NO KEY UPDATE，**不能是 FOR UPDATE**：
  --    FOR UPDATE 是唯一一种与 FOR KEY SHARE 冲突的强度，而 FOR KEY SHARE
  --    正是 Postgres 为每一次外键检查在父行上加的锁。用 FOR UPDATE 就等于
  --    在「本事务已持 KEY SHARE」之上再要一把更强的锁 —— 两个并发事务互等，
  --    直接 40P01 死锁。FOR NO KEY UPDATE 与 KEY SHARE 不冲突，
  --    却与上锁那句 UPDATE（locked_at 不在任何唯一索引里，取的正是这个强度）冲突，
  --    刚好只留一个串行点。
  SELECT locked_at INTO v_locked_at
    FROM public.geo_query_sets
   WHERE id = v_set_id
   FOR NO KEY UPDATE;

  -- 🔴 父集合查不到 = 它正在同一个事务里被删掉（未锁定的集合删除会级联到这里）。
  --    没有父集合就没有要保护的锁，放行。
  --    这一段是**显式写出来**的：不写的话，代码靠「SELECT INTO 查不到时变量留 NULL」
  --    落到下面的放行分支 —— 结论对，但理由是巧合。下一个人看到这里少了 NOT FOUND
  --    判断，很自然会补一句 `IF NOT FOUND THEN RAISE`，那会让所有未锁定集合都删不掉。
  IF NOT FOUND THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF v_locked_at IS NOT NULL THEN
    RAISE EXCEPTION
      '查询集 % 已于 % 锁定：不能新增、修改或删除其中的问题。改问题 = 发新版本。',
      v_set_id, v_locked_at
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS geo_queries_locked_set_guard_trigger ON public.geo_queries;
CREATE TRIGGER geo_queries_locked_set_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON public.geo_queries
  FOR EACH ROW EXECUTE FUNCTION public.geo_queries_locked_set_guard();

DROP TRIGGER IF EXISTS geo_queries_no_truncate ON public.geo_queries;
CREATE TRIGGER geo_queries_no_truncate
  BEFORE TRUNCATE ON public.geo_queries
  FOR EACH STATEMENT EXECUTE FUNCTION public.geo_forbid_truncate();

-- ── 6.4 首个批次落地即锁死查询集 ───────────────────────────────────────────
--
-- 🔴 「被用于采集就锁死」不能靠调用方自觉写一句 UPDATE —— 忘了写、或者
--    换个写入路径，锁就没了。这里由数据库在批次落地的同一个事务里自己上锁。
--
--    并发安全：两个批次同时插进来时，两句 `UPDATE ... WHERE locked_at IS NULL`
--    在同一行上排队；后到的那句在拿到行锁后重新求值 WHERE，locked_at 已经
--    不是 NULL 了，于是影响 0 行。锁只会被打上一次，时间戳也只有一个。
--
-- 🔴 必须是 BEFORE INSERT，**不能是 AFTER INSERT**。
--    外键检查会在父行上加 FOR KEY SHARE。放在 AFTER 的话顺序是
--    「先拿 KEY SHARE，再要 NO KEY UPDATE」= 同一事务内的锁升级：
--    两个并发批次各自先拿到 KEY SHARE，然后各自等对方释放才能升级 —— 死锁。
--    放在 BEFORE，本事务先拿 NO KEY UPDATE，之后的外键检查是同一事务里
--    的降级请求，不必等任何人；晚到的事务干脆在这一句上排队，无环。
CREATE OR REPLACE FUNCTION public.geo_batches_lock_query_set()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.geo_query_sets
     SET locked_at = now()
   WHERE id = NEW.query_set_id
     AND locked_at IS NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS geo_batches_lock_query_set_trigger ON public.geo_batches;
CREATE TRIGGER geo_batches_lock_query_set_trigger
  BEFORE INSERT ON public.geo_batches
  FOR EACH ROW EXECUTE FUNCTION public.geo_batches_lock_query_set();

-- ── 6.5 批次 / 观测 / 证据：落库即不可变 ───────────────────────────────────
--
-- 🔴 一句都不许改，一行都不许删。重跑产生**新批次 + 新观测 + 新证据**，
--    永远不是更新旧行 —— 所以这里连「哪些列可以改」的名单都不需要有。
CREATE OR REPLACE FUNCTION public.geo_immutable_row()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      '% 是不可变的测量记录：不允许删除（重跑请新建批次）', TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;
  RAISE EXCEPTION
    '% 是不可变的测量记录：不允许修改（重新解析请新建批次与观测）', TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS geo_batches_immutable_trigger ON public.geo_batches;
CREATE TRIGGER geo_batches_immutable_trigger
  BEFORE UPDATE OR DELETE ON public.geo_batches
  FOR EACH ROW EXECUTE FUNCTION public.geo_immutable_row();

DROP TRIGGER IF EXISTS geo_observations_immutable_trigger ON public.geo_observations;
CREATE TRIGGER geo_observations_immutable_trigger
  BEFORE UPDATE OR DELETE ON public.geo_observations
  FOR EACH ROW EXECUTE FUNCTION public.geo_immutable_row();

DROP TRIGGER IF EXISTS geo_evidence_immutable_trigger ON public.geo_evidence;
CREATE TRIGGER geo_evidence_immutable_trigger
  BEFORE UPDATE OR DELETE ON public.geo_evidence
  FOR EACH ROW EXECUTE FUNCTION public.geo_immutable_row();

DROP TRIGGER IF EXISTS geo_batches_no_truncate ON public.geo_batches;
CREATE TRIGGER geo_batches_no_truncate
  BEFORE TRUNCATE ON public.geo_batches
  FOR EACH STATEMENT EXECUTE FUNCTION public.geo_forbid_truncate();

DROP TRIGGER IF EXISTS geo_observations_no_truncate ON public.geo_observations;
CREATE TRIGGER geo_observations_no_truncate
  BEFORE TRUNCATE ON public.geo_observations
  FOR EACH STATEMENT EXECUTE FUNCTION public.geo_forbid_truncate();

DROP TRIGGER IF EXISTS geo_evidence_no_truncate ON public.geo_evidence;
CREATE TRIGGER geo_evidence_no_truncate
  BEFORE TRUNCATE ON public.geo_evidence
  FOR EACH STATEMENT EXECUTE FUNCTION public.geo_forbid_truncate();


-- ── 6.5b 证据只能挂在**成功**的观测上 ────────────────────────────────────────
--
-- 🔴 外键只保证「这条观测存在、且是同一个客户的」，保证不了「它是成功的」。
--    把证据挂到 outcome_ok = false 的观测上，库层照单全收 —— 而 WP02 冻结的
--    GeoObservationOutcome 里，失败那一支**结构上就没有 evidenceId**。
--    于是库里会出现一种投影不出合法契约对象的行；更糟的是证据不可删，
--    这条自相矛盾的记录就再也清不掉了，citation 统计与覆盖率会一直读到它。
--
-- 没有竞态：观测落库即不可变，outcome_ok 之后不可能变。
CREATE OR REPLACE FUNCTION public.geo_evidence_requires_successful_observation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_outcome_ok boolean;
BEGIN
  SELECT outcome_ok INTO v_outcome_ok
    FROM public.geo_observations
   WHERE id = NEW.observation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      '观测 % 不存在，挂不上证据。', NEW.observation_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_outcome_ok IS NOT TRUE THEN
    RAISE EXCEPTION
      '观测 % 是失败观测，不能挂证据：失败本来就没有原始响应可留，硬挂一条会让「问了但失败」和「问到了」在库里长得一样。',
      NEW.observation_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS geo_evidence_successful_observation_trigger ON public.geo_evidence;
CREATE TRIGGER geo_evidence_successful_observation_trigger
  BEFORE INSERT ON public.geo_evidence
  FOR EACH ROW EXECUTE FUNCTION public.geo_evidence_requires_successful_observation();


-- ── 6.6 这道锁挡不住什么（说清楚，别让人以为都挡住了）────────────────────────
--
--   · **表的属主**（Supabase SQL Editor 里的 postgres）可以 DROP TRIGGER /
--     ALTER TABLE ... DISABLE TRIGGER / DROP TABLE / 改列类型触发全表重写。
--     这一层拦不住属主，要拦得上 event trigger（需要超级用户，仓库里一个都没有）。
--   · `session_replication_role = 'replica'` 会让普通触发器不触发。设这个 GUC
--     本身需要很高的权限，所以这里没有为它单独加 ENABLE ALWAYS。
--   · `ON CONFLICT DO NOTHING` 不会报错，只会**悄悄咽掉**一条重复插入。
--     它不是不可变性的洞（改不了旧行），但会让 WP04 以为写进去了。
--     这是写入方的纪律，库层给不了保证。
--
--   挡得住的：service_role 的任何 UPDATE / DELETE、upsert（ON CONFLICT DO UPDATE
--   与 MERGE 都会触发 BEFORE UPDATE）、TRUNCATE、以及从父表级联过来的删除；
--   还有「建集合时自带锁定时间」「调用方直接 UPDATE 抢锁」和「把证据挂到失败观测上」
--   这三种伪造。
--
--   仍然挡不住（写入方的纪律，库层给不了保证）：**成功的观测却没有证据行**。
--   经 PostgREST 的两次 INSERT 是两个事务，跨表的延迟约束在这条路径上没有生效时机。
-- ============================================================================


-- ============================================================================
-- 7. 让 PostgREST 看见这五张表
--
-- 🔴 不发这一句，新表在 PostgREST 的 schema 缓存里不存在，
--    WP04 第一次写入会拿到「relation does not exist」——
--    而那个报错看起来像「migration 没 apply」，能把人带偏很久。
--    （先例：20260808000001_flywheel_outcomes_identity_expand.sql:292）
-- ============================================================================
NOTIFY pgrst, 'reload schema';


-- ============================================================================
-- 8. apply 之后必须自验的几条（WP00 §2 规则 2：文件名不是 apply 证据）
--
--   SELECT to_regclass('public.geo_query_sets'),
--          to_regclass('public.geo_queries'),
--          to_regclass('public.geo_batches'),
--          to_regclass('public.geo_observations'),
--          to_regclass('public.geo_evidence');
--   -- 五个都非空才叫 applied
--
--   -- 五张表都开了 RLS，且只有 service_role 一条策略
--   SELECT c.relname, c.relrowsecurity, p.polname, p.polroles::regrole[]
--     FROM pg_class c LEFT JOIN pg_policy p ON p.polrelid = c.oid
--    WHERE c.relname LIKE 'geo\_%';
--
--   -- 不可变触发器真的在
--   SELECT tgrelid::regclass, tgname FROM pg_trigger
--    WHERE NOT tgisinternal AND tgrelid::regclass::text LIKE 'geo\_%';
-- ============================================================================
