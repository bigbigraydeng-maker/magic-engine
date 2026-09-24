-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ CTS Tours NZ 的线索表格路线（**客户级配置，不是代码**）。                  ║
-- ║ ⚠️ 跟 migration 一样：只随 PR 提交，apply 需 PM 显式 go。                  ║
-- ║                                                                          ║
-- ║ 改哪张表、改哪一列、加一个新选项的中文，都只动这一份 SQL，                  ║
-- ║ `src/lib/lead-sheets/` 一行都不用碰。                                     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- 🔴 **PM 2026-09-24 当面拍板：所有表单的线索汇总进「一张」表，不分表。**
--    这条推翻了同一天早些时候「按表单问了什么分流到两张表」的设计。
--    分流判据**保留**——仍然只看「这条线索的问答里出现了哪些字段名」，不看 form id，
--    所以客户出 v5 / v6 只要还问同样的问题就自动归位，不用改代码也不用改配置。
--    变的只是分流的结果：从「写哪张表」变成「第 12 列的『来源表单』写哪个标签」。
--
-- 🔴 **两条路线的列定义必须一模一样，只有第 12 列的固定文本不同。**
--    这不是风格要求，是 `src/lib/lead-sheets/config.ts::describeLayoutMismatch` 在
--    校验的硬条件：同一张表上的路线共用一份判重键，列位对不上就会互相误判成
--    「已存在」而**静默丢线索**。所以下面用一份 `layout` 模板 + `jsonb_set` 只换
--    那一格 —— 手抄两份迟早抄歪。
--
-- ── 上线前必须先做的三件事（缺一条这条链路就是白配） ────────────────────────
--   1. 目标表格 1ASNBy… 的第一行**逐格照下面的 header_row 排**（连「⭐重要」这种
--      符号都要一样，系统会逐格比对，对不上就整轮停手并出待办 —— 这是有意的，
--      排错一列会让之后每一行都错位，而错位追加不回来）。表里现有那 3 行 v4 数据
--      也要跟着重排，或者直接删掉让系统自己重写（它们都在 backfill 窗口内）。
--   2. CTS 的 Google 连接重新授权一次（现有令牌只有只读权限，写不进去）：
--      https://app.magicengine.com.au/api/auth/google/connect?client_id=c0000000-0000-0000-0000-000000000000&flow=admin
--   3. 旧表（FB 即时表单 Infrontof2000）上那条外部管道（客户账号里的 Zapier/Make，
--      实测每天 7–16 行）要停掉，否则同一个客人会同时进两张表。**这条是 PM 的决定**，
--      本 SQL 只是不再往旧表写，没有也没法替 PM 去停对方那条管道。
--
--      🔴🔴 **停它之前必须先做这件事，否则当天就断两条下游：**
--           `src/lib/conversions/cts-crm-sheet-sync-run.ts`（读旧表取成交，喂广告回传）
--           和 `src/lib/crm/sheet-followup-sync.ts`（读旧表取员工跟进记录，回灌 CRM）
--           都把旧表 id 写死在代码里。ME 切到新表之后，旧表只剩那条外部管道在喂；
--           一旦把它也停了，这两条链路会**安静地停在今天**，日报全绿、没有任何报警，
--           而「这个人有没有人跟过」的判断就是靠后者喂的（2026-09-24 实测过一次同类
--           误判：331 人里 224 个被当成没人跟过）。两条下游先改读新表，再停管道。
-- ──────────────────────────────────────────────────────────────────────────

WITH layout AS (
  SELECT
    /**
     * 13 列。前 12 列是 PM 2026-09-24 定的表头，第 13 列是机器用的线索编号。
     *
     *   0  留资时间(NZ)   1 姓名        2 电话        3 邮箱
     *   4  想去哪个团     5 什么时候出发 6 预算_人
     *   7  ⭐重要         8 员工跟进记录 9 跟进状态    10 邮件进度
     *   11 来源表单       12 线索编号（隐藏）
     *
     * 🔴 第 6、7 列（出发时间 / 预算）两条路线都放 `answer`，不是给基础表单留白。
     *    基础表单没问这两个问题 → 取不到值 → 自然写成空格子，这本来就是想要的；
     *    而配成 `blank` 会让两条路线的列定义不一致，校验会当场判坏。
     *
     * 🔴 第 8–11 列是**人工维护区**（员工手写的跟进、跟进状态、邮件进度），必须用
     *    `blank` 占位。这条链路只 append 不覆盖，写进去是空格子，碰不到已有内容；
     *    但少占一格后面每一列都会错位。
     *
     * 🔴 第 12 列（下标 11）的 literal 在模板里**故意不写 value**，由下面的
     *    `jsonb_set(…,'{11,value}',…)` 按路线填。写个占位符更危险：下标一旦打偏
     *    （有人在模板里加了列忘了改那个 11），jsonb_set 挂到错的列上或者越界 no-op
     *    **都不报错**，结果是整张表的「来源表单」写着占位符，看着像有意为之。
     *    不写 value 的话，打偏 = `parseRoute` 当场判坏 = 整个客户停手 + 出待办。
     *
     * 🔴 第 13 列（下标 12）是 Facebook 给的线索编号，PM 的 12 列里没有 —— 这里
     *    **多加一列**当判重主键。只靠「时间+电话」判重的话，销售在表里把电话
     *    规整成 `+64 21 …`、或者有人改了时间列的显示格式，键就变了 → 下一轮判成
     *    「表里没有」→ **再写一行**，销售的跟进记录被劈到两行上。线索编号是机器
     *    写的、没人会去改，唯一真正稳。这一列对销售没用，在表格里隐藏即可。
     */
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
      {"field": "blank"},
      {"field": "blank"},
      {"field": "literal"},
      {"field": "lead_id"}
    ]'::jsonb AS columns,

    /**
     * 表头签名：目标表格第一行必须逐格长这样，对不上这轮一行不写并出人工待办。
     *
     * 🔴 这一列专门防「人工排表头排错」。ME 照配置写满 13 格，没有这道闸的话，
     *    有人在表中间插一列 → 之后每一行都错位（电话写进邮箱列、员工手打的跟进
     *    记录被挤走），而回执全绿、一条待办都不出。追加不可逆，错位比不写更糟。
     */
    ARRAY[
      '留资时间(NZ)', '姓名', '电话', '邮箱',
      '想去哪个团', '什么时候出发', '预算_人',
      '⭐重要', '员工跟进记录', '跟进状态', '邮件进度',
      '来源表单', '线索编号'
    ]::text[] AS header_row,

    -- 键 = 归一化后的答案值（小写 + 各种破折号/下划线/空格压成一个 _，见 row.ts::normaliseAnswerValue）。
    -- 所以同一个选项的多种写法落在同一个键上：`still_deciding_-_show_me_all`、
    -- `still_deciding_—_show_me_all_4`、`Still deciding - show me all` 都命中第一条。
    -- 下面每个键都是拿**库里真实出现过的值**和 PM 给的英文原文各跑一遍归一算出来的，
    -- 不是手写猜的。查不到的值会原样写进表格并进人工待办，不会留空。
    --
    -- 🔴 两条路线共用这一份 —— 同一个选项在同一列里必须是同一个中文，
    --    否则销售按那一列筛会漏人。
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
    }'::jsonb AS value_labels
),

/**
 * 两条路线的**全部**差别就在这张表里：判据、优先级、第 12 列写什么标签。
 * 目标表格、列定义、选项对照表、判重配置全部共用，不给「抄歪一份」留机会。
 */
routes (route_key, label, match_fields, priority, source_label) AS (
  VALUES
    (
      'timing-budget',
      'CTS 留资汇总 · 问了预算与出发时间的表单',
      -- 判据：问答里出现任一个这两个字段名就算。目前命中的只有 form
      -- 3232987727090852（CTS Lead Form v4 - Timing+Budget - 20260922），
      -- 但以后出 v5 / v6 只要还问这两个问题就自动归到这一档。
      ARRAY['whats_your_budget_per_person_nzd?', 'when_are_you_hoping_to_travel?']::text[],
      10,
      '含预算与出发时间'
    ),
    (
      'default',
      'CTS 留资汇总 · 其余表单（兜底）',
      ARRAY[]::text[],   -- 空 = 兜底路线，谁都没命中时走它
      900,
      '基础表单'
    )
)

INSERT INTO public.client_lead_sheet_routes (
  client_id, route_key, label, spreadsheet_id, tab_name,
  match_any_answer_fields, priority, columns, value_labels, dedup_columns,
  dedup_id_column, header_row, timezone, backfill_since, enabled
)
SELECT
  'c0000000-0000-0000-0000-000000000000'::uuid,
  r.route_key,
  r.label,
  -- 🔴 一张表。两条路线同一个 spreadsheet_id + tab_name —— 这是这次改动的全部重点。
  '1ASNByyBlyrl7fFs750Y7AGZstl4cy0SYhw71zZrvVME',
  'Untitled',
  r.match_fields,
  r.priority,
  -- 唯一按路线变化的那一格：第 12 列（下标 11）的「来源表单」标签。
  jsonb_set(l.columns, '{11,value}', to_jsonb(r.source_label)),
  l.value_labels,
  -- 判重退路：留资时间（到分钟）+ 电话。用在**没有第 13 列**的行上 ——
  -- PM 手填的那几行、以及从旧表搬过来的历史行里没带编号的那些。
  ARRAY[0, 2],
  -- 判重主键：第 13 列（下标 12）的线索编号。
  12,
  l.header_row,
  'Pacific/Auckland',
  /**
   * 🔴 **先只补最近的，历史另走一次性搬迁。**
   *
   * 库里攒着 733 条线索，直接全倒进去有两个后果：一是把表冲烂；二是**抢在
   * 历史搬迁前面**把这些人写成"没有员工跟进记录"的空行 —— 而旧表里那 703 条
   * 带着 CTS 员工用红字标的 37 处约定（"call back thursday 5pm"、"明确不要电话"），
   * 那些才是有价值的版本。顺序必须是：先从旧表搬历史，再把这个值往前调让 ME 补缺口。
   *
   * 2026-09-20 起 = 覆盖 v4 表单上线（9-22）前后，也就是表里现有那 3 行的时段。
   *
   * 🔴🔴 **把这个值往前调之前，先确认历史搬迁把 Facebook 线索编号写进了第 13 列。**
   *      判重退路是「分钟级本地时间 + 电话」，要认出搬过去的历史行，这两格必须跟
   *      ME 自己渲染出来的逐字相等 —— 而实际上三处都会对不上：
   *        · 时间：ME 写 `YYYY-MM-DD HH:mm`，粘进 Google Sheets 的日期常被自动
   *          改成 `18/09/2026 14:03` 这种显示格式，而判重读的就是显示值；
   *        · 电话：搬迁要「补回 +64」，而判重**不做** `021…` → `+6421…` 的换算
   *          （见 row.ts::normaliseDedupCell，那属于猜，故意不做）；
   *        · 压根没留电话的历史行算不出身份键。
   *      三者任一发生，就是 703 行重复写进人正在用的表 —— 不可逆，而且销售的跟进
   *      记录会被劈到两行上。**有第 13 列的编号就全部绕开**（机器键直接对上）。
   *      拿不到编号的那几行，要么这个值别往前调，要么提前告诉 PM 会重复。
   *
   * 🔴 还有一条顺序坑：这个值一 apply，ME **立刻**开始写 2026-09-20 至今这一段。
   *    等真去搬那 703 条时，快照里必然含 9-20 之后的行 —— **搬迁时必须把这个日期
   *    之后的行剔掉**（或者反过来，把这个值改成搬迁完成那天）。不剔就指望判重挡住，
   *    而上面刚说过判重在搬迁这种场景下三处都可能对不上。
   */
  '2026-09-20T00:00:00+00:00'::timestamptz,
  true
FROM routes r CROSS JOIN layout l
ON CONFLICT (client_id, route_key) DO UPDATE SET
  label = EXCLUDED.label,
  spreadsheet_id = EXCLUDED.spreadsheet_id,
  tab_name = EXCLUDED.tab_name,
  match_any_answer_fields = EXCLUDED.match_any_answer_fields,
  priority = EXCLUDED.priority,
  columns = EXCLUDED.columns,
  value_labels = EXCLUDED.value_labels,
  dedup_columns = EXCLUDED.dedup_columns,
  dedup_id_column = EXCLUDED.dedup_id_column,
  header_row = EXCLUDED.header_row,
  timezone = EXCLUDED.timezone,
  backfill_since = EXCLUDED.backfill_since,
  enabled = EXCLUDED.enabled,
  updated_at = now();
