-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ CTS Tours NZ 的两条线索表格路线（**客户级配置，不是代码**）。              ║
-- ║ ⚠️ 跟 migration 一样：只随 PR 提交，apply 需 PM 显式 go。                  ║
-- ║                                                                          ║
-- ║ 改哪张表、改哪一列、加一个新选项的中文，都只动这一份 SQL，                  ║
-- ║ `src/lib/lead-sheets/` 一行都不用碰。                                     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ── 路线 1：v4 及以后「问了预算 / 出发时间」的表单 → 新表（10 列） ──────────
--
-- 🔴 判据是**问了哪两个问题**，不是 form id。目前命中的只有 form
--    3232987727090852（CTS Lead Form v4 - Timing+Budget - 20260922），但以后
--    出 v5 / v6 只要还问这两个问题就自动归到这张表，不用改配置也不用改代码。
INSERT INTO public.client_lead_sheet_routes (
  client_id, route_key, label, spreadsheet_id, tab_name,
  match_any_answer_fields, priority, columns, value_labels, dedup_columns,
  timezone, backfill_since, enabled
) VALUES (
  'c0000000-0000-0000-0000-000000000000',
  'timing-budget',
  'CTS 留资跟进表 · 含预算与出发时间（v4 表单）',
  '1ASNByyBlyrl7fFs750Y7AGZstl4cy0SYhw71zZrvVME',
  'Untitled',
  ARRAY['whats_your_budget_per_person_nzd?', 'when_are_you_hoping_to_travel?'],
  10,
  '[
    {"field": "occurred_at", "format": "local"},
    {"field": "contact_name"},
    {"field": "contact_phone"},
    {"field": "contact_email"},
    {"field": "answer", "key": "which_tour_interests_you_most?", "mapped": true},
    {"field": "answer", "key": "when_are_you_hoping_to_travel?", "mapped": true},
    {"field": "answer", "key": "whats_your_budget_per_person_nzd?", "mapped": true},
    {"field": "blank"},
    {"field": "blank"},
    {"field": "blank"}
  ]'::jsonb,
  -- 键 = 归一化后的答案值（小写 + 各种破折号/下划线/空格压成一个 _，见 row.ts::normaliseAnswerValue）。
  -- 所以同一个选项的多种写法落在同一个键上：`still_deciding_-_show_me_all`、
  -- `still_deciding_—_show_me_all_4`、`Still deciding - show me all` 都命中第一条。
  -- 下面每个键都是拿**库里真实出现过的值**和 PM 给的英文原文各跑一遍归一算出来的，
  -- 不是手写猜的。查不到的值会原样写进表格并进人工待办，不会留空。
  '{
    "still_deciding_show_me_all": "还在决定",
    "still_deciding_show_me_all_4": "还在决定",
    "still_deciding_show_me_everything": "还在决定",
    "not_sure_yet_just_exploring": "还没定",
    "golden_china_november": "金色中国11月",
    "christmas_in_china_from_auckland": "圣诞·奥克兰出发",
    "christmas_in_china_from_christchurch": "圣诞·基督城出发",
    "best_of_china_march_2027": "Best of China 2027年3月",
    "best_of_china_15_days": "Best of China 15天",
    "best_of_china_15_days_(mar_2027)": "Best of China 15天（2027年3月）",
    "tale_of_two_cities_10_days": "双城记10天",
    "tale_of_two_cities_10_days_(beijing_+_xi''an)": "双城记10天（北京+西安）",
    "shanghai_&_surroundings_10_days": "上海周边10天",
    "silk_road_discovery_18_days": "丝绸之路18天",
    "first_half_of_next_year_(or_no_rush)": "明年上半年",
    "first_half_next_year": "明年上半年",
    "in_the_next_1_2_months": "1-2个月内",
    "next_1_2_months": "1-2个月内",
    "around_christmas": "圣诞前后",
    "not_sure_exploring": "还没定",
    "around_$3,000": "约$3000",
    "around_3000": "约$3000",
    "$3,000_$5,000": "$3000-5000",
    "3000_5000": "$3000-5000",
    "$5,000_$8,000": "$5000-8000",
    "5000_8000": "$5000-8000",
    "budget_isn''t_a_concern": "预算不是问题",
    "budget_isnt_a_concern": "预算不是问题"
  }'::jsonb,
  -- 判重：留资时间（到分钟）+ 电话。这张表**没有** lead id 列，只能靠看得见的
  -- 东西判重 —— 好处是跟 PM 手工填进去的那几行也能对上，不会重复写。
  ARRAY[0, 2],
  'Pacific/Auckland',
  -- 只补 v4 表单上线（2026-09-22）之后的。再往前没有带预算的线索。
  '2026-09-20T00:00:00+00:00',
  true
)
ON CONFLICT (client_id, route_key) DO UPDATE SET
  label = EXCLUDED.label,
  spreadsheet_id = EXCLUDED.spreadsheet_id,
  tab_name = EXCLUDED.tab_name,
  match_any_answer_fields = EXCLUDED.match_any_answer_fields,
  priority = EXCLUDED.priority,
  columns = EXCLUDED.columns,
  value_labels = EXCLUDED.value_labels,
  dedup_columns = EXCLUDED.dedup_columns,
  timezone = EXCLUDED.timezone,
  backfill_since = EXCLUDED.backfill_since,
  enabled = EXCLUDED.enabled,
  updated_at = now();

-- ── 路线 2：其余表单 → 旧表「FB 即时表单 Infrontof2000」Sheet1（32 列） ─────
--
-- 🔴 **这张表已经有另一条管道在写**（实测 2026-09-24：每天 7–16 行，最新一行
--    2026-09-23，且带着广告组名 / 系列名 / 表单名 —— 那三样 ME 库里没有）。
--    所以 ME 在这张表上的角色是**补漏的安全网**，不是主力：先读表、已经有的
--    一律跳过，只补别人漏掉的。两边同时写也不会写重。
--
-- 🔴 第 18 列起全是 CTS 员工手打的跟进记录，还有一片人工维护的名单区。
--    这条链路**只 append 不覆盖**（见 google-sheets/client.ts），那些列
--    在配置里用 blank 占位，写进去是空格子，不会碰到已有内容。
--
-- 🔴 **这张表的实际用法已经跟表头对不上了**，下面的列按**实测**配，不按表头配
--    （2026-09-24 读生产表最后几行核实）：
--      · 第 18 列（R，表头写 `员工跟进记录`）—— 实际放的是 Facebook 后台链接。
--        第 506 行起换的，见 conversions/cts-crm-sheet-sync.ts 的
--        `CTS_NOTE_COLUMN_SWITCH_ROW`。我们只追加新行（行号远在 506 之后），
--        所以按现行用法写 `inbox_url`。
--      · 第 19 列（S，表头写 `Many Chat`）—— 实际是员工手打的跟进记录，
--        **必须留空**，写进去就是往人家的记录上盖。
--      · 第 32 列（AF，表头写 `inbox_url`）—— 新行里实际是空的，跟着留空。
--      · 第 17 列（Q，`lead_status`）—— 外部管道写 "CREATED"；ME 没有真取过
--        这个字段，留空而不是照抄一个没验证过的值。
INSERT INTO public.client_lead_sheet_routes (
  client_id, route_key, label, spreadsheet_id, tab_name,
  match_any_answer_fields, priority, columns, value_labels, dedup_columns,
  timezone, backfill_since, enabled
) VALUES (
  'c0000000-0000-0000-0000-000000000000',
  'default',
  'FB 即时表单 Infrontof2000 · Sheet1（兜底）',
  '1vISaVkVkcQMSaR6Jo7xdmym6Ed5eE-q9025snYWYDVA',
  'Sheet1',
  ARRAY[]::text[],   -- 空 = 兜底路线
  900,
  '[
    {"field": "lead_id", "prefix": "l:"},
    {"field": "occurred_at", "format": "iso"},
    {"field": "ad_id", "prefix": "ag:"},
    {"field": "ad_name"},
    {"field": "adset_id", "prefix": "as:"},
    {"field": "adset_name"},
    {"field": "campaign_id", "prefix": "c:"},
    {"field": "campaign_name"},
    {"field": "form_id", "prefix": "f:"},
    {"field": "form_name"},
    {"field": "is_organic"},
    {"field": "platform"},
    {"field": "answer", "key": "which_tour_interests_you_most?"},
    {"field": "contact_email"},
    {"field": "contact_name"},
    {"field": "contact_phone", "prefix": "p:"},
    {"field": "blank"},
    {"field": "answer", "key": "inbox_url"},
    {"field": "blank"},
    {"field": "blank"},
    {"field": "blank"},
    {"field": "blank"},
    {"field": "blank"},
    {"field": "blank"},
    {"field": "blank"},
    {"field": "blank"},
    {"field": "blank"},
    {"field": "blank"},
    {"field": "blank"},
    {"field": "blank"},
    {"field": "blank"},
    {"field": "blank"}
  ]'::jsonb,
  -- 第 13 列（想去哪个团）刻意**不翻中文**：这张表的历史行全是英文 slug，
  -- 中英混排反而让人以为是两种数据。要翻就整表一起翻，那是另一件事。
  '{}'::jsonb,
  -- 判重：第 1 列的 `l:<lead id>`。ME 和那条外部管道写出来的格式一样，对得上。
  ARRAY[0],
  'Pacific/Auckland',
  -- 🔴 **只补今天以后的**。库里有 373 条这张表没有的历史线索（大多是 6–7 月
  --    CSV 导入那批），一次全倒进去会把人正在用的表冲烂。要补历史就把这个值
  --    往前调，一次调几天，每次调完看一眼表。
  '2026-09-24T00:00:00+12:00',
  true
)
ON CONFLICT (client_id, route_key) DO UPDATE SET
  label = EXCLUDED.label,
  spreadsheet_id = EXCLUDED.spreadsheet_id,
  tab_name = EXCLUDED.tab_name,
  match_any_answer_fields = EXCLUDED.match_any_answer_fields,
  priority = EXCLUDED.priority,
  columns = EXCLUDED.columns,
  value_labels = EXCLUDED.value_labels,
  dedup_columns = EXCLUDED.dedup_columns,
  timezone = EXCLUDED.timezone,
  backfill_since = EXCLUDED.backfill_since,
  enabled = EXCLUDED.enabled,
  updated_at = now();
