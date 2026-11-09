-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ ⚠️ 本文件只随 PR 提交，**不在 PR 内 apply**。                              ║
-- ║                                                                          ║
-- ║ apply 授权：PM 2026-09-27 在「ME广告构建控制」窗口原话「删了重建」。        ║
-- ║ 执行人 = 那个窗口（授权给谁、就由谁执行；避免有人执行一个只从转述听到的     ║
-- ║ 不可逆授权）。apply 前须现场重核 `SELECT count(*) = 0`，不拿旧快照当证据。  ║
-- ║                                                                          ║
-- ║ 顺序（v2.2 §12 硬门）：migration 先 apply 再合并代码 + PR 描述附 apply 回执。║
-- ║ 🔴 反了会出事：resolver 一旦进主干而表不存在，v2.2 §6.2 的                  ║
-- ║   「读不到 = 视为熔断中」会让**全客户全 bounded 动作被拒**（含看板一键）。   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ────────────────────────────────────────────────────────────────────────────
-- 0. 先删掉 2026-09-27 按**错的**设计建的那张表
--
-- 错在哪：上一轮照总纲 spec §3 G11 实施，建成了「每条判据一行、按客户」
--   `(client_id, occurred_on, trigger_code, outcome, evidence)`；
-- 而 WP3.1b 的权威设计 v2.2 §6.2 要的是「trip/release 事件对、按账户、派生态」。
-- 七列缺、三列多、两条 CHECK 全换 —— 要改的比要留的多，ALTER 脚本会比 DDL 还长还难读。
--
-- 为什么 DROP 代价为零：表里 0 行、无任何代码读写、无外部引用（apply 前会再核一次）。
-- 为什么 DROP 和 CREATE 必须同一份 migration：分两次跑会留一个「表不存在」的空档，
--   而那个空档正好命中上面横幅里那条「读不到 = 全拒」。一个回执，一次跑完。
-- ────────────────────────────────────────────────────────────────────────────
-- 🔴 **先设一道闸再删**（我自己沙盘重跑第二遍时发现的洞，2026-09-27）：
--    这份 migration 以 `DROP TABLE` 开头，而 `DROP TABLE` **不受下面那个
--    append-only 触发器管**（触发器只管 UPDATE / DELETE / TRUNCATE）。
--    也就是说：将来任何人第二次跑这份文件，整张只增账本会被无声清空 ——
--    而账本被清空 = 所有未解除的 sticky 熔断一起消失 = 熔断状态被静默解除。
--    「改历史 = 解熔断」这句话对 DROP 同样成立，触发器却拦不住它。
--
--    所以：**表里有行就拒绝跑**，让它响一声而不是悄悄抹掉。
--    这不妨碍本次 apply —— 那张按错设计建的表实测 0 行（apply 前会现场再核一次）。
DO $guard$
DECLARE
  n bigint;
BEGIN
  IF to_regclass('public.ads_circuit_events') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.ads_circuit_events' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION
        'ads_circuit_events 已有 % 行，拒绝 DROP：这份 migration 只应跑一次。'
        '账本被清空 = 未解除的 sticky 熔断一起消失 = 熔断被静默解除。'
        '真要重建，先人工导出并在对话里拿到 PM 明确授权。', n;
    END IF;
  END IF;
END
$guard$;

DROP TABLE IF EXISTS public.ads_circuit_events;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. 按 v2.2 §6.2 / §11.4 重建
--
-- 🔴 **状态是派生态，不是某一列**。「这个 (client_id, ad_account_id) 现在熔断中吗」
--    = 存在任一 `kind='trip'` 的行，满足：没有对应的 release 行
--    （`release.trip_event_id = trip.id`），**且**（`sticky = true` 或
--    `trip.created_at > now() - 24h`）。
--    · 非 sticky 靠时间自然过期 —— **没有任何自动 release 写入者**（没 cron、没 worker）
--    · sticky 只认 `actor LIKE 'human:%'` 的 release 行，时间对它无效
--    · 同秒并发多条 trip 各自独立判定，一条被 release 不代表另一条被 release
--
-- 🔴 **不在 `ad_strategy_configs` 上加任何熔断状态列。** 状态只存这张事件表。
--    上一轮就是错在把熔断写成「改 autonomy_mode」，而 Kernel 压根不认识那一列。
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ads_circuit_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 给「同一个 created_at 时按写入顺序」一个稳定次序（created_at 精度不够时用）
  seq            bigserial NOT NULL,
  client_id      uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  -- 🔴 **按账户不按客户**：CTS 绑了两个广告账户，一个账户熔断不该连坐另一个
  ad_account_id  text NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('trip', 'release')),
  -- release 必须指回它解除的那条 trip（同表 FK）
  trip_event_id  uuid REFERENCES public.ads_circuit_events(id),
  reason         text NOT NULL,
  -- sticky = 只能人解，时间过期对它无效（回滚失败 / Jev 连续低分这两条）
  sticky         boolean NOT NULL DEFAULT false,
  evidence       jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor          text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ads_circuit_events_release_shape CHECK (
    (kind = 'trip'    AND trip_event_id IS NULL) OR
    (kind = 'release' AND trip_event_id IS NOT NULL)
  ),

  -- 🔴 狄仁杰 v2.1 复核：sticky「必须人解」落到**表**上，不只靠路由代码和 grep。
  --    路由代码会被绕过（有人写第二个入口），CHECK 不会。
  --
  -- 🔴 判据用**正则**而不是 `LIKE 'human:%'`（统筹 2026-09-27 审出，我原来写的有洞）：
  --
  --    `LIKE 'human:%'` 对 `'human:'` 是**通过**的 —— 前缀对了、人没了。
  --    而这不是理论边界：`requireGlobalAdmin()` 成功分支是 `{ ok: true; user: User }`，
  --    而 `User.email` **可空** —— `require-admin.ts:27` 和 `:84` 自己就写着
  --    `session.user.email ?? ''`。所以路由里顺手写
  --    ``actor = `human:${user.email ?? ''}` `` 就会得到 `'human:'`，
  --    穿过 CHECK、落一条**没有身份的「人解除过」**的账。
  --
  --    而这条 CHECK 是 v2.2 §6.9 第 3 条**唯一的数据库级保证**
  --    （「sticky 必须人解由数据库保证，不只靠路由代码和 grep」）——
  --    它放过空身份，那条保证就只剩个形状。
  --
  --    正则也比 `LIKE 'human:%@%'` 严：后者挡不住 `'human:@'`。
  --    路由那一侧另有一道：email 取不到 → 直接拒绝写入，**不许 `?? ''` 兜底**
  --    （取不到管理员身份就不该记一条「人解除过」的账）。两层各咬一次。
  CONSTRAINT ads_circuit_events_release_by_human CHECK (
    kind <> 'release' OR actor ~ '^human:[^@[:space:]]+@[^@[:space:]]+'
  )
);

-- 派生态查询按 (client_id, ad_account_id) 找未解 trip；看板按时间倒序
CREATE INDEX IF NOT EXISTS ads_circuit_events_account_idx
  ON public.ads_circuit_events (client_id, ad_account_id, created_at DESC);

-- 派生态要按 trip_event_id 反查「这条 trip 被 release 过吗」
CREATE INDEX IF NOT EXISTS ads_circuit_events_trip_idx
  ON public.ads_circuit_events (trip_event_id);

ALTER TABLE public.ads_circuit_events ENABLE ROW LEVEL SECURITY;

DO $do$
BEGIN
  CREATE POLICY ads_circuit_events_service_role ON public.ads_circuit_events
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $do$;

-- 🔴 显式收口：Supabase 默认会把新表的七项权限授给 anon / authenticated。
--    RLS 开着且只有 service_role 策略时匿名读不到行，但 `architecture.test.ts` 把标准
--    写成明文：「anon/authenticated 必须被显式 REVOKE，service_role 显式 GRANT ——
--    不赌底表 RLS 恰好都配对」。照那条办。
REVOKE ALL ON public.ads_circuit_events FROM PUBLIC, anon, authenticated;
GRANT  ALL ON public.ads_circuit_events TO service_role;
-- seq 是 bigserial，它的序列也要一起收口，否则 anon 能推进序列号
REVOKE ALL ON SEQUENCE public.ads_circuit_events_seq_seq FROM PUBLIC, anon, authenticated;
GRANT  ALL ON SEQUENCE public.ads_circuit_events_seq_seq TO service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. append-only 靠**触发器**，不靠「只给 INSERT 策略」
--
-- 🔴 为什么必须是触发器（模板抄 `me_conversion_audit`，20260905000002:242-262）：
--    **`service_role` 带 BYPASSRLS，RLS 策略对它根本不生效**（子牙那轮复审的原话）。
--    而熔断状态是从这张表的历史**派生**出来的 —— 能改写历史 = 能解除熔断。
--    本仓范式还有 `authorization_decisions_append_only()`（20260808000003:209-212），
--    注释原文：「审计记录能被改写 = 没有审计」。
--
-- 🔴 但本表比那两张多一个约束：`client_id` 是 `ON DELETE CASCADE`。
--    一个无条件拒 DELETE 的触发器会连**删客户**都挡掉。
--    所以用 `pg_trigger_depth()` 区分：
--      · 调用方直接 DELETE / UPDATE → 深度 1 → 拒
--      · FK 级联删除（`DELETE FROM clients` 内部发出）→ 深度 > 1 → 放行
--    调用方伪造不了触发深度（同 `geo_query_sets` 那处上锁守卫的判据，20260811000001:630）。
--
-- 🔴 级联到底是深度几，**沙盘实测过**，不是照文档猜的 —— 见本轮 PR 描述的沙盘结果。
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ads_circuit_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- 级联删除（删客户带走它的事件）放行；调用方直接动手一律拒。
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION
    'ads_circuit_events 是只增账本（熔断状态从它的历史派生，改历史 = 解熔断）：% 被拒绝', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS ads_circuit_events_append_only_trigger ON public.ads_circuit_events;
CREATE TRIGGER ads_circuit_events_append_only_trigger
  BEFORE UPDATE OR DELETE ON public.ads_circuit_events
  FOR EACH ROW EXECUTE FUNCTION public.ads_circuit_events_append_only();

-- 行级触发器对 TRUNCATE 不触发，单独挡一道（同 me_conversion_audit）
DROP TRIGGER IF EXISTS ads_circuit_events_no_truncate ON public.ads_circuit_events;
CREATE TRIGGER ads_circuit_events_no_truncate
  BEFORE TRUNCATE ON public.ads_circuit_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.ads_circuit_events_append_only();

REVOKE EXECUTE ON FUNCTION public.ads_circuit_events_append_only() FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.ads_circuit_events IS 'append-only 熔断事件账本（v2.2 §6.2）：trip/release 成对、按广告账户。当前是否熔断为派生态，不存列。只增不改由触发器强制（service_role 带 BYPASSRLS，RLS 拦不住它）。';
COMMENT ON COLUMN public.ads_circuit_events.kind IS 'trip=熔断 / release=解除。release 必带 trip_event_id，且 actor 必须 human: 前缀（CHECK 强制）。';
COMMENT ON COLUMN public.ads_circuit_events.sticky IS 'true=只能人解，24h 过期对它无效（回滚失败 / Jev 连续低分）。false=24h 后自然不再算熔断，没有自动 release 写入者。';
COMMENT ON COLUMN public.ads_circuit_events.reason IS '机器可读前缀 + 人话：circuit: / facts: / manual_only:。前缀决定 pm-todo 分三种话说。';
COMMENT ON COLUMN public.ads_circuit_events.actor IS '谁写的。release 行必须 human:<email>（不从 body 读，从授权上下文取）。';

NOTIFY pgrst, 'reload schema';
