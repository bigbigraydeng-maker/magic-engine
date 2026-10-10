-- ============================================================================
-- Client Knowledge Base — step 2/6 (Issue #1644, depends on #1643)
--
-- 目的：AI 对客户说价格/时效/承诺/政策类事实之前，必须先过"ME 内部批准 +
-- 客户本人确认"两道闸（双签）。这个迁移建立那道闸的**存储层**：
--   1. client_knowledge_facts        — 逐条知识事实，双签字段落在行上
--   2. client_knowledge_mining_runs  — 萃取回执（扫了什么、花了多少、结果如何）
--   3. client_knowledge_events       — 只增不改的开关/阶段事件流
--
-- 本迁移只建表。不接萃取工作流、不接审核页面（见 Issue #1644"明确不做"）。
-- 🔴 上生产库需 PM 显式 go，本 issue 只在本机 PG 沙盘重放验证。
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. client_knowledge_facts —— 逐条知识事实 + 双签
--
-- 🔴 双签的方向性：approved_* 是 ME 内部审核（谁批的/什么时候），
--    client_confirmed_* 是客户本人确认（谁确认的/什么时候/如果拒绝写了什么）。
--    两者互相独立，`getClientKnowledge()` 的 customer_reply 用途会同时要求
--    两者都非空（对 price/timeline/commitment/policy 四类敏感条目）。
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_knowledge_facts (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                   uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,

  -- 事实身份 = client_id + fact_key + scope + value_fingerprint（唯一索引
  -- 见下方 uq_client_knowledge_facts_identity）。同一个值重复萃取到走
  -- UPDATE；不同的值（冲突）各开一行，同时存在，留给人工审核挑一条——
  -- "同一时刻只能有一条 approved" 这条规则由触发器保证，不是靠这张表的
  -- 唯一索引本身。
  fact_key                    text NOT NULL,
  -- 产品线/线路/门店……等细分范围。无范围区分的事实用 '{}'::jsonb。
  scope                       jsonb NOT NULL DEFAULT '{}'::jsonb,

  statement                   text NOT NULL,
  -- 机器可核对的结构化值（如 { "amount": 4, "currency": "NZD", "unit": "kg" }）。
  -- 可空：有些事实（政策类）没有单一数值。
  structured_value            jsonb,

  status                      text NOT NULL DEFAULT 'candidate'
                               CHECK (status IN ('candidate','approved','rejected','retired','superseded')),
  visibility                  text NOT NULL
                               CHECK (visibility IN ('customer_ok','internal_only','forbidden')),
  -- 用 #1643 的 detectSensitivity()/resolveSensitivity() 在**写入时**判定，
  -- 不是查询时现算——sensitivity 决定的是"这条事实该不该经过客户确认"，
  -- 必须在事实定型的那一刻钉死，不能随判定函数以后调整而回溯改变历史行为。
  sensitivity                 text NOT NULL
                               CHECK (sensitivity IN ('price','timeline','commitment','policy','general')),

  valid_from                  timestamptz NOT NULL DEFAULT now(),
  valid_until                 timestamptz,
  last_verified_at            timestamptz,

  -- 萃取/录入来源类型。故意不加 CHECK enum——萃取管道（后续 issue）会引入
  -- 新的来源类型，这里不预先猜它的词表。
  source_kind                 text NOT NULL,

  -- 🔴 只存引用（对话 id / 消息 id / 出现次数……），不复制客户原文本身。
  evidence                    jsonb NOT NULL,

  -- 冲突分组：萃取管道发现同一 fact_key 在不同对话里有矛盾说法时，
  -- 把冲突的候选行打上同一个组号（应用层概念，这里不建外键目标表）。
  conflict_group_id           uuid,

  -- 🔴 候选内容指纹（跨窗口复审引入·2026-09-14）：同一个 fact_key+scope
  -- 出现价值矛盾的说法时（§9.7"聚类+冲突检测...不做多数投票自动裁决"），
  -- 必须让多条互相矛盾的候选行同时存在,留给人工审核挑一条——不能只留一行
  -- 覆盖掉另一条。由写入方（目前只有后续的萃取工作流）从 statement+
  -- structured_value 算好填入,不含时间相关字段（不能用下面 client_confirmed_
  -- fingerprint 用的 computeContentFingerprint()——那个含 validUntil,每次
  -- 写入都用 now()+N 天现算,同一个值每次重跑会得到不同指纹,直接破坏幂等
  -- 性）。留空（NULL）安全：Postgres 唯一索引把多个 NULL 视为互不相同,
  -- 手工建的事实哪怕不填这一列也不会跟别的行意外冲突。
  value_fingerprint            text,

  -- ME 内部批准（第一道闸）
  approved_by_email           text,
  approved_at                 timestamptz,

  -- 客户本人确认（第二道闸）
  client_confirmed_by_email   text,
  client_confirmed_at         timestamptz,
  client_rejection_note       text,
  -- 客户确认的**是哪一版内容**——存 computeContentFingerprint() 在确认那一刻
  -- 算出的指纹。读取入口用它跟"当前内容重新算一遍的指纹"比对：不一致 =
  -- 客户确认的是旧版本，这条对 customer_reply 视为未确认。
  client_confirmed_fingerprint text,

  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT valid_window_sane CHECK (valid_until IS NULL OR valid_until > valid_from),

  -- approved_by_email / approved_at 必须成对出现
  CONSTRAINT approval_pairing CHECK ((approved_by_email IS NULL) = (approved_at IS NULL)),
  -- client_confirmed_by_email / client_confirmed_at 必须成对出现
  CONSTRAINT confirmation_pairing CHECK ((client_confirmed_by_email IS NULL) = (client_confirmed_at IS NULL)),
  -- 确认了就必须留下"确认的是哪一版"——否则读取入口没有指纹可比对，
  -- 双签机制的"版本没变过"这条防线直接失效。
  CONSTRAINT confirmation_fingerprint_pairing
    CHECK ((client_confirmed_fingerprint IS NULL) = (client_confirmed_at IS NULL)),
  -- status = 'approved' 必须已经有 ME 批准人——不能"标成已批准但查不到谁批的"。
  CONSTRAINT approved_status_requires_approver
    CHECK (status <> 'approved' OR (approved_by_email IS NOT NULL AND approved_at IS NOT NULL)),
  -- 🔴 双签变异测试②：同一个邮箱不能既是批准人又是确认人。写入层面直接拒绝，
  --    比读取时再判定更彻底——库里永远不会出现这种脏数据，也不依赖每一个
  --    读取路径都记得重新检查一遍。
  -- 🔴 狄仁杰攻击验证（2026-09-14）实测：不 trim 的话，一个带尾随空格的
  -- confirmed_by_email（如 'ray@x.com '）能绕开 lower() 比较，跟 approver
  -- 判定成"不同人"直接插入成功。跟 read.ts / confirmers.ts 的比较标准对齐，
  -- 两边都先 trim 再 lower。
  CONSTRAINT approver_confirmer_differ
    CHECK (
      client_confirmed_by_email IS NULL
      OR approved_by_email IS NULL
      OR lower(trim(client_confirmed_by_email)) <> lower(trim(approved_by_email))
    )
);

-- 🔴 身份唯一性（跨窗口复审引入·2026-09-14，替换本迁移最初版本里"同客户下
-- fact_key+scope 无条件唯一"的设计）：
--
-- 最初版本把 (client_id, fact_key, scope) 设成无条件唯一，意味着重新萃取
-- 出不同的值必须 UPDATE 同一行——这跟 issue #1645 的萃取工作流要求
-- ("同 fact_key+scope 值不同→冲突组，不做多数投票自动裁决") 直接冲突：
-- 冲突意味着两条互相矛盾的候选行要同时留着给人工挑，不能只留一行覆盖掉
-- 另一条。改成 (client_id, fact_key, scope, value_fingerprint) 唯一——
-- 同一个值只会有一行（重复萃取到同一个值走 UPDATE，不重复插入），但不同
-- 的值可以是不同的行（冲突时两条都留着）。
--
-- 本机实测踩过一个坑，记录下来避免以后重犯：一开始想再加一条"只对
-- status='approved' 唯一"的局部（partial）唯一索引来保证"同一时刻一个
-- 身份只能有一条 approved"，SQL 层面完全正确，但 Supabase 的 upsert 是
-- 经 PostgREST 转译的，PostgREST 的 on_conflict 参数只接受一份列名清单、
-- 不支持带 WHERE 谓词的局部索引——用 supabase-js 调用会报"没有匹配
-- ON CONFLICT 规格的唯一约束"。所以"同一身份只能一条 approved"这条规则
-- 挪到下面的触发器里用查询显式检查，不受 PostgREST/upsert 语法能力限制。
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_knowledge_facts_identity
  ON public.client_knowledge_facts (client_id, fact_key, scope, value_fingerprint);

CREATE OR REPLACE FUNCTION public.client_knowledge_facts_single_approved_per_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'approved' AND EXISTS (
    SELECT 1 FROM public.client_knowledge_facts
     WHERE client_id = NEW.client_id
       AND fact_key  = NEW.fact_key
       AND scope     = NEW.scope
       AND status    = 'approved'
       AND id <> NEW.id
  ) THEN
    RAISE EXCEPTION
      'client_knowledge_facts: another approved row already exists for this identity (client_id=%, fact_key=%, scope=%)',
      NEW.client_id, NEW.fact_key, NEW.scope;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS client_knowledge_facts_single_approved_per_identity_trigger
  ON public.client_knowledge_facts;
CREATE TRIGGER client_knowledge_facts_single_approved_per_identity_trigger
  BEFORE INSERT OR UPDATE ON public.client_knowledge_facts
  FOR EACH ROW EXECUTE FUNCTION public.client_knowledge_facts_single_approved_per_identity();

CREATE INDEX IF NOT EXISTS idx_client_knowledge_facts_client_status
  ON public.client_knowledge_facts (client_id, status);
CREATE INDEX IF NOT EXISTS idx_client_knowledge_facts_conflict_group
  ON public.client_knowledge_facts (conflict_group_id) WHERE conflict_group_id IS NOT NULL;

ALTER TABLE public.client_knowledge_facts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  -- 🔴 必须写 TO service_role。漏掉 = 对匿名访客敞开读写。不给 anon/authenticated
  --    建任何 policy——这张表只能由服务端读取入口经过准入闸之后再读。
  CREATE POLICY "service_role_full" ON public.client_knowledge_facts
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.client_knowledge_facts_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS client_knowledge_facts_touch_updated_at_trigger
  ON public.client_knowledge_facts;
CREATE TRIGGER client_knowledge_facts_touch_updated_at_trigger
  BEFORE UPDATE ON public.client_knowledge_facts
  FOR EACH ROW EXECUTE FUNCTION public.client_knowledge_facts_touch_updated_at();

-- 🔴 事故预防（跨窗口复审发现·2026-09-14）：即使有了 value_fingerprint 区分
-- 不同的值各开一行，一条已经 approved+已客户确认的行仍然可以被直接 UPDATE
-- 改动内容（比如手工纠错，或者未来某个写入路径没走"开新候选行"这条正规
-- 路径）。如果改的时候忘了把 status 拨回 candidate、清掉批准/确认字段，库里
-- 会显示"已批准+已确认"但内容已经变了——比丢数据更危险，因为它看起来完全
-- 正常。这道闸不依赖调用方自己记得清字段：只要内容真的变了，无条件重置。
CREATE OR REPLACE FUNCTION public.client_knowledge_facts_reset_signoff_on_content_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (
    NEW.statement IS DISTINCT FROM OLD.statement OR
    NEW.structured_value IS DISTINCT FROM OLD.structured_value OR
    NEW.scope IS DISTINCT FROM OLD.scope OR
    NEW.valid_from IS DISTINCT FROM OLD.valid_from OR
    NEW.valid_until IS DISTINCT FROM OLD.valid_until OR
    NEW.visibility IS DISTINCT FROM OLD.visibility OR
    NEW.sensitivity IS DISTINCT FROM OLD.sensitivity
  ) AND (
    OLD.approved_by_email IS NOT NULL OR OLD.client_confirmed_at IS NOT NULL OR OLD.status = 'approved'
  ) THEN
    NEW.status := 'candidate';
    NEW.approved_by_email := NULL;
    NEW.approved_at := NULL;
    NEW.client_confirmed_by_email := NULL;
    NEW.client_confirmed_at := NULL;
    NEW.client_confirmed_fingerprint := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS client_knowledge_facts_reset_signoff_trigger
  ON public.client_knowledge_facts;
CREATE TRIGGER client_knowledge_facts_reset_signoff_trigger
  BEFORE UPDATE ON public.client_knowledge_facts
  FOR EACH ROW EXECUTE FUNCTION public.client_knowledge_facts_reset_signoff_on_content_change();


-- ────────────────────────────────────────────────────────────────────────────
-- 2. client_knowledge_mining_runs —— 萃取回执
--
-- 本迁移只建表，不接萃取工作流本身（那是后续独立 issue）。
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_knowledge_mining_runs (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 外部调用方的幂等键（如 Inngest event id）。同一个 request_id 只应该有一条回执。
  request_id               text NOT NULL,
  client_id                uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,

  conversations_scanned    integer NOT NULL DEFAULT 0,
  messages_scanned         integer NOT NULL DEFAULT 0,
  candidates_found         integer NOT NULL DEFAULT 0,
  conflict_groups_found    integer NOT NULL DEFAULT 0,
  llm_cost_usd             numeric,

  -- 🔴 花费硬顶（design doc §9.8/§9.14-B："每次调模型前按最坏情况预估判上限，
  -- 不是调完再算"；"缺任一上限 = 拒绝运行"）。这三列存的是**这一轮开跑前
  -- 配置好的上限**，不是事后实际值（llm_cost_usd 才是事后实际花费）——三者
  -- 都必填且必须为正数，"忘了配上限"和"明确无限"永远不能长得一样。
  max_messages_cap         integer NOT NULL,
  max_model_calls_cap      integer NOT NULL,
  max_spend_usd_cap        numeric NOT NULL,

  status                   text NOT NULL DEFAULT 'queued'
                            CHECK (status IN ('queued','running','succeeded','failed')),
  error                    text,

  started_at               timestamptz,
  finished_at              timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  -- 计数字段不许是负数——负数只可能是写入方算错了，不该被库悄悄收下。
  CONSTRAINT mining_run_counts_non_negative CHECK (
    conversations_scanned >= 0 AND messages_scanned >= 0
    AND candidates_found >= 0 AND conflict_groups_found >= 0
  ),
  CONSTRAINT mining_run_cost_is_real_amount CHECK (
    llm_cost_usd IS NULL OR (llm_cost_usd >= 0 AND llm_cost_usd <> 'NaN'::numeric)
  ),
  CONSTRAINT mining_run_caps_are_positive CHECK (
    max_messages_cap > 0 AND max_model_calls_cap > 0
    AND max_spend_usd_cap > 0 AND max_spend_usd_cap <> 'NaN'::numeric
  ),
  -- failed 必须留下 error；其余状态不许挂着一条 error 误导排查。
  CONSTRAINT mining_run_error_matches_status CHECK (
    (status = 'failed') = (error IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_client_knowledge_mining_runs_request_id
  ON public.client_knowledge_mining_runs (request_id);
CREATE INDEX IF NOT EXISTS idx_client_knowledge_mining_runs_client
  ON public.client_knowledge_mining_runs (client_id, created_at DESC);

ALTER TABLE public.client_knowledge_mining_runs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.client_knowledge_mining_runs
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.client_knowledge_mining_runs_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS client_knowledge_mining_runs_touch_updated_at_trigger
  ON public.client_knowledge_mining_runs;
CREATE TRIGGER client_knowledge_mining_runs_touch_updated_at_trigger
  BEFORE UPDATE ON public.client_knowledge_mining_runs
  FOR EACH ROW EXECUTE FUNCTION public.client_knowledge_mining_runs_touch_updated_at();


-- ────────────────────────────────────────────────────────────────────────────
-- 3. client_knowledge_events —— 只增不改的开关/阶段事件流
--
-- 当前状态 = 按 (client_id, dimension) 取 created_at 最新的一条。
--
-- 🔴 照抄 20260808000003_me2_execution_kernel_v1.sql:210-245
--    （authorization_decisions 的 append-only 触发器）的写法，但这次**删掉
--    "允许把 consumed_at 从 NULL 写成一次值"那个例外**——本表任何字段、
--    任何时候都不许 UPDATE，行也不许 DELETE。要记录新状态就 INSERT 新事件。
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_knowledge_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,

  -- 事件所属的维度：'kill_switch'（整个客户知识库开关）或 'phase'（阶段状态：
  -- 如 mining/review/live/retired，具体阶段词表留给后续萃取/审核 issue 定义，
  -- 这里故意不对 value 加 enum，避免抢在那些 issue 之前替它们发明词表）。
  dimension     text NOT NULL CHECK (dimension IN ('kill_switch','phase')),
  value         text NOT NULL,

  reason        text,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_email   text NOT NULL,

  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_knowledge_events_client_dimension
  ON public.client_knowledge_events (client_id, dimension, created_at DESC);

ALTER TABLE public.client_knowledge_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.client_knowledge_events
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.client_knowledge_events_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'client_knowledge_events is append-only: rows cannot be deleted';
  END IF;
  -- 🔴 跟 authorization_decisions 不同：这里**没有任何例外**——不像那张表
  --    留了"consumed_at 可以从 NULL 写一次"的口子。任何 UPDATE 一律拒绝，
  --    包括看起来无害的字段。要变更状态就 INSERT 一条新事件。
  RAISE EXCEPTION 'client_knowledge_events is append-only: rows cannot be updated (insert a new event instead)';
END;
$$;

DROP TRIGGER IF EXISTS client_knowledge_events_append_only_trigger
  ON public.client_knowledge_events;
CREATE TRIGGER client_knowledge_events_append_only_trigger
  BEFORE UPDATE OR DELETE ON public.client_knowledge_events
  FOR EACH ROW EXECUTE FUNCTION public.client_knowledge_events_append_only();


-- ────────────────────────────────────────────────────────────────────────────
-- 4. client_knowledge_confirmers —— 客户侧确认人登记（design doc §9.14 E.2 第2步）
--
-- "新增'客户确认人登记'：只有全局管理员能登记，留审计；确认人必须在草稿批准
-- 前登记；登记人 ≠ 批草稿的人"。没有这张表，read.ts 的双签校验只能查"确认人
-- ≠批准人""确认人非全局管理员"——任何其他邮箱都能填进 client_confirmed_by_
-- email 并通过。这张表把"这个邮箱真的是这个客户登记过的确认人"补成第三道闸。
--
-- 谁是全局管理员由应用层 isGlobalAdminEmail()（env 驱动）判断，这里不建 CHECK
-- ——数据库判不出谁是全局管理员，跟 approver_confirmer_differ 之外那道全局管理
-- 员检查一样，只能在读取入口/写入入口的代码里做。
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_knowledge_confirmers (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  confirmer_email       text NOT NULL,
  registered_by_email   text NOT NULL,
  registered_at         timestamptz NOT NULL DEFAULT now(),
  revoked_at            timestamptz,
  revoked_by_email      text,

  CONSTRAINT client_knowledge_confirmers_revocation_pairing
    CHECK ((revoked_at IS NULL) = (revoked_by_email IS NULL))
);

-- 同一个邮箱对同一客户只能有一条"当前有效"（未撤销）的登记——撤销后允许
-- 重新登记，所以是局部唯一索引，不是表级 UNIQUE 约束。
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_knowledge_confirmers_active
  ON public.client_knowledge_confirmers (client_id, lower(confirmer_email))
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_client_knowledge_confirmers_client
  ON public.client_knowledge_confirmers (client_id) WHERE revoked_at IS NULL;

ALTER TABLE public.client_knowledge_confirmers ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.client_knowledge_confirmers
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 5. getKnowledgeEntitlement() 复用 client_automation_policies（执行内核已有的
--    按客户/按动作/带版本和生效期的授权模型），不新造会员系统。
--
-- 复用方式：action_key = 'client_knowledge.read'，mode='auto_approve' 表示
-- 已授予、'deny' 或没有生效行表示未授予（fail-closed：查不到行 = 拒绝，
-- 跟 client_automation_policies 本身"默认 deny 是没有行"的既有约定完全一致）。
--
-- 缺的是 basis（fde_managed/tier_499/enterprise）——client_automation_policies
-- 原本没有地方放这个。新增一个 nullable 的 metadata jsonb 列，只存
-- { "basis": "..." }，是全表唯一新增列，不影响任何既有查询（都用显式列名
-- select，不会因为多一列而变化）。
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.client_automation_policies
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.client_automation_policies.metadata IS
  'Issue #1644：client_knowledge.read 授权记录用它存 {"basis": "fde_managed"|"tier_499"|"enterprise"}。其余 action_key 的行留空对象，不强制使用。';
