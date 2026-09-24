-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ ⚠️ 本文件只随 PR 提交，**不在 PR 内 apply**。apply 需 PM 显式 go。          ║
-- ║                                                                          ║
-- ║ 「把线索按规则分流写进客户指定的 Google 表格」的**客户级配置**。            ║
-- ║ 表格 id / 列顺序 / 分流判据 / 选项值中文映射全部是数据，不进共享代码 ——     ║
-- ║ 换个客户、换个行业只改这张表，`src/lib/lead-sheets/` 一行都不用动。         ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS public.client_lead_sheet_routes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id            uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  -- 同一客户下的稳定标识（配置更新按它 upsert，不靠 uuid）
  route_key            text NOT NULL,
  label                text,
  spreadsheet_id       text NOT NULL,
  tab_name             text NOT NULL,
  /**
   * 分流判据：这条线索的问答里**出现任一个**这里列的字段名 → 走这条路线。
   * 空数组 = 兜底路线（谁都没命中时用它）。
   *
   * 故意按「表单实际问了哪些问题」判断，不按 form_id —— 客户出 v5 / v6 只要
   * 还问这两个问题就自动归位，不用改代码也不用改配置。
   */
  match_any_answer_fields text[] NOT NULL DEFAULT '{}',
  -- 小的先匹配；兜底路线给一个大数
  priority             integer NOT NULL DEFAULT 100,
  /**
   * 列定义：有序数组，一项一列。每项 { field, key?, prefix?, format?, mapped? }。
   * field 的取值范围由 src/lib/lead-sheets/types.ts 的 LeadSheetField 锁定。
   */
  columns              jsonb NOT NULL,
  /** 选项值 → 中文短语。key 是归一化后的答案值（见 normaliseAnswerValue）。 */
  value_labels         jsonb NOT NULL DEFAULT '{}'::jsonb,
  /**
   * 判重用的列下标（0 起）。这些列拼起来就是「这条线索在表里有没有了」的唯一键。
   * 读表里已有的行算一遍、这次要写的行算一遍，撞上就跳过 —— 所以重跑不会写出第二行，
   * 跟别的系统（Zapier / Make / 人手）往同一张表里写也不会互相写重。
   */
  dedup_columns        integer[] NOT NULL,
  /**
   * 机器键所在的列下标（0 起，可空）。指向 lead id 这种**机器自己写、人不会去改**
   * 的列：这一列非空时判重只看它，销售在表里怎么编辑别的格子都不影响。
   * 表里老行没有这一列（值是空的）时自动退回 dedup_columns。
   */
  dedup_id_column      integer,
  /** 时间列按哪个时区渲染。 */
  timezone             text NOT NULL DEFAULT 'Pacific/Auckland',
  /**
   * 只同步这个时刻之后的线索。
   * 🔴 不是性能优化，是**防误伤**：库里可能攒了几百条历史线索，首跑全倒进
   *    人正在用的表里会把表冲烂。要补历史就把这个值往前调，一次调一点。
   */
  backfill_since       timestamptz,
  enabled              boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, route_key)
);

ALTER TABLE public.client_lead_sheet_routes ENABLE ROW LEVEL SECURITY;

DO $do$
BEGIN
  CREATE POLICY client_lead_sheet_routes_service_role ON public.client_lead_sheet_routes
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $do$;

CREATE INDEX IF NOT EXISTS client_lead_sheet_routes_client_idx
  ON public.client_lead_sheet_routes (client_id, priority ASC);

COMMENT ON TABLE public.client_lead_sheet_routes IS
  '客户级配置：Meta 即时表单线索按「表单问了哪些问题」分流写进哪张 Google 表、写哪些列。';
COMMENT ON COLUMN public.client_lead_sheet_routes.match_any_answer_fields IS
  '命中任一字段名就走这条路线；空数组 = 兜底路线。按问题判断而非 form_id，新版表单自动归位。';
COMMENT ON COLUMN public.client_lead_sheet_routes.dedup_columns IS
  '判重列下标（0 起）。读表里已有行算同一把键，撞上就跳过 —— 重跑与外部管道并存都不会写重。';
COMMENT ON COLUMN public.client_lead_sheet_routes.dedup_id_column IS
  '机器键列下标（0 起，可空）。非空优先用它判重，人编辑其它列不影响；老行没有这一列时退回 dedup_columns。';
COMMENT ON COLUMN public.client_lead_sheet_routes.backfill_since IS
  '只同步这个时刻之后的线索。防止首跑把库里几百条历史一次性倒进人在用的表。';

NOTIFY pgrst, 'reload schema';
