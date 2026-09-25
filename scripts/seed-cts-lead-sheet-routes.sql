-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ CTS Tours NZ 的线索表格路线（**客户级配置，不是代码**）。                  ║
-- ║ ⚠️ 跟 migration 一样：只随 PR 提交，apply 需 PM 显式 go。                  ║
-- ║                                                                          ║
-- ║ 改哪张表、改哪一列、改判重口径，都只动这一份 SQL，                          ║
-- ║ `src/lib/lead-sheets/` 一行都不用碰。                                     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- 🔴 **PM 2026-09-24 最终拍板（原话）：「你不要过度开发，就按照 fb 默认的表格式，**
--    **把几个 form 的信息拉齐到一张 form 上」。**
--
--    这条是当天第三次也是最后一次改口，覆盖前两版：
--      · 第一版「按表单问了什么分流到两张表」（#1972，已合并）
--      · 第二版「汇总进一张**新建**的 13 列中文表」（#1975 第一轮）
--
--    最终口径：**写客户一直在用的那张老表**
--    `1vISaVkVkcQMSaR6Jo7xdmym6Ed5eE-q9025snYWYDVA` 的 `Sheet1`
--    （「FB 即时表单 Infrontof2000」），保持 Facebook 原样的 32 列格式，
--    只在**表尾追加两列**给 v4 表单多问的两个问题。不新建表、不翻中文、
--    不合并列、不加自造的「⭐重要」这类列。
--
-- ── 为什么「写老表」反而是最安全的那条路 ─────────────────────────────────────
--   1. **两条下游不用动。** `src/lib/conversions/cts-crm-sheet-sync-run.ts`（读这张表
--      取成交、喂广告回传）和 `src/lib/crm/sheet-followup-sync.ts`（读员工跟进记录
--      回灌 CRM）都把这张表的 id 写死在代码里。切到新表会让这两条链路安静地停在
--      切表那天、日报还是绿的；不切表，这个风险直接不存在。
--   2. **判重有现成的机器键。** 这张表第 1 列（表头写着 `f`）每一行都有
--      `l:<Facebook 线索编号>`，703 行无一例外（2026-09-24 全量核过）。ME 渲染出来的
--      第 1 列格式逐字相同，所以「表里已经有的人」是靠机器键认出来的 ——
--      不依赖电话写法、不依赖日期显示格式，那三个在搬迁场景下必翻车的坑全部绕开。
--   3. **员工的红字标注一格都不会动。** 这条链路只 append 不覆盖；O 列姓名 13 格、
--      R 列 11 格、S 列 13 格是 CTS 员工标的重要客人（约定的回电时间、「只要 email
--      不要电话」这类），只追加新行就碰不到它们。
--
-- ── apply 之前必须先做的两件事 ───────────────────────────────────────────────
--   1. **在 Sheet1 的表尾加两列**（第 33、34 列，也就是 AG / AH），表头逐字写：
--        AG: when_are_you_hoping_to_travel?
--        AH: whats_your_budget_per_person_nzd?
--      用 Facebook 的原字段名，跟现有 32 列一个风格，**不要翻中文**。
--      🔴 **必须加在最右边，不能插在中间。** 上面那两条下游读的是固定列下标
--      （email=N、full_name=O、phone=P、跟进记录=R/S），中间插一列会让它们整体错位。
--      没加这两列时 ME 一行都不会写：`header_row` 逐格比对表头，对不上整轮停手
--      并下发人工待办（这是有意的，错位追加不回来）。
--   2. **CTS 的 Google 连接重新授权一次。** 现有令牌只有「看表格」的权限，写不进去：
--      https://app.magicengine.com.au/api/auth/google/connect?client_id=c0000000-0000-0000-0000-000000000000&flow=admin
--      （写权限 `spreadsheets` 已经在 `COMBINED_GOOGLE_SCOPES` 里，是 #1972 合并进去的，
--        本 PR 没有再改 scope。已经连过的客户不会因此掉线，只是拿不到新权限 ——
--        要用写表格这件事的只有 CTS，所以只有 CTS 需要重连。）
--
-- ── 旧表上那条外部管道：**保持现状，不要停** ─────────────────────────────────
--   这张表每天还在进 7–16 行，带着 ME 库里没有的 `adset_name` / `campaign_name` /
--   `form_name`，几乎可以肯定是客户自己账号里的 Zapier/Make。
--   ME 在这里的定位是**补漏安全网**：先读表 → 已经有的跳过 → 只补它漏掉的。
--   实测（2026-09-24）：2026-09-20 以来库里 26 条线索，那条管道写进去了 23 条，
--   漏掉的正好是 v4 表单那 3 条 —— 它一条 v4 线索都没进过表。
--   **要不要让 ME 接管、把那条管道停掉，PM 还没拍板，本 SQL 不替 PM 做这个决定。**

/**
 * 只有一条路线。
 *
 * 🔴 **为什么不再分两条**：分流的意义原本是「写哪张表」/「第 12 列写哪个标签」。
 *    现在所有表单写同一张表、同一套列，v4 多问的两个问题在老表单上天然是空格子 ——
 *    分两条路线会产出**一模一样**的行，只是多一份配置要维护、多一次
 *    `describeLayoutMismatch` 的机会抄歪。`form_id` / `form_name` 这两列本来就写着
 *    线索来自哪张表单，不需要再造一列「来源表单」。
 *
 *    平台层「几条路线写同一张表」的能力（config.ts::describeLayoutMismatch、
 *    sync.ts::DestinationSnapshot）保留不动 —— 那是通用拓扑规则，不认识 CTS，
 *    别的客户可能用得上；这里只是没用到它。
 */

-- 🔴 先清掉上一版留下的路线。上一版（#1975 第一轮）配的是两条写「新表」的路线；
--    这张配置表还没 apply 到生产，但任何跑过上一版 seed 的沙盘 / 预发环境里都会
--    残留它们，留着会让线索被写进那张没人看的新表。删掉的是「不在本次名单里的
--    全部路线」，不是硬删某个 key —— 以后再改口径也不用回来改这一句。
--    ⚠️ 也就是说**这份文件是 CTS 路线配置的唯一真相源**：谁手工往库里加过路线，
--       下一次跑这份 seed 会被清掉。要加路线就加在这份文件里。
DELETE FROM public.client_lead_sheet_routes
WHERE client_id = 'c0000000-0000-0000-0000-000000000000'
  AND route_key <> 'cts-fb-lead-sheet';

INSERT INTO public.client_lead_sheet_routes (
  client_id, route_key, label, spreadsheet_id, tab_name,
  match_any_answer_fields, priority, columns, value_labels, dedup_columns,
  dedup_id_column, header_row, timezone, backfill_since, enabled
)
VALUES (
  'c0000000-0000-0000-0000-000000000000'::uuid,
  'cts-fb-lead-sheet',
  'CTS 留资总表 · FB 即时表单 Infrontof2000 / Sheet1',

  -- 客户一直在用的那张老表。**不新建表**，见文件头。
  '1vISaVkVkcQMSaR6Jo7xdmym6Ed5eE-q9025snYWYDVA',
  'Sheet1',

  -- 兜底路线：不分流，所有表单都走这一条。
  ARRAY[]::text[],
  900,

  /**
   * 34 列 = Facebook 原样的 32 列 + 表尾追加的 2 列（v4 表单多问的两个问题）。
   * 下标 0 起，跟表格列字母的对应：0=A … 25=Z，26=AA … 31=AF，32=AG，33=AH。
   *
   *   0  f                                   ← 表头真的就写着一个 `f`，不是笔误
   *   1  created_time    2  ad_id      3  ad_name
   *   4  adset_id        5  adset_name 6  campaign_id   7  campaign_name
   *   8  form_id         9  form_name  10 is_organic    11 platform
   *   12 which_tour_interests_you_most?
   *   13 email           14 full_name  15 phone_number  16 lead_status
   *   17 员工跟进记录     18 Many Chat
   *   19-26 E1已发 / E1打开 / E2已发 / E2打开 / E3已发 / E3打开 / E4已发 / E4打开
   *   27 客户回复        28 回复摘要   29 id            30 邮件进度   31 inbox_url
   *   32 when_are_you_hoping_to_travel?      ← 本次新增
   *   33 whats_your_budget_per_person_nzd?   ← 本次新增
   *
   * 🔴 **前缀不是装饰。** 这张表里 id 类的值都带前缀：`l:` 线索、`ag:` 广告、
   *    `as:` 广告组、`c:` 广告系列、`f:` 表单、`p:` 电话。判重读的是单元格文本，
   *    少一个前缀 = 机器键跟表里每一行都对不上 = 703 个人被重写一遍。
   *
   * 🔴 **第 16-31 列一律 `blank`**，一个都不能省：
   *    · 16 lead_status —— Facebook 自己的字段，ME 手里没有。写死一个 'CREATED'
   *      是编数据（703 行确实全是 CREATED，但那是 FB 写的，不是我们知道的）。
   *    · 17 员工跟进记录 / 18 Many Chat —— 员工手打的，红字标注就在这两列里。
   *    · 19-28 邮件追踪 / 29 id / 30 邮件进度 / 31 inbox_url —— 别的管道维护的。
   *    只 append 不覆盖，写进去是空格子，碰不到已有内容；但少占一格，后面每一列
   *    都会错位。
   *
   * 🔴 第 9 列 form_name **必然是空的**：`leads.ts` 本地没有表单名缓存，一律留空
   *    （留白是事实，不去别处凑一个像的名字）。回执里会点名 `form_name`。
   *    表单编号在第 8 列，认得出是哪张表单，不影响销售用。
   *
   * 🔴 第 31 列 inbox_url 留空是**有意的，但是一个留给 PM 的问题**：
   *    线索的问答里确实带着一个叫 `inbox_url` 的字段（Meta 原样给的，ME 没加工过），
   *    v3 表单上它是真的 Messenger 会话链接 `https://business.facebook.com/latest/…`，
   *    可 v4 那三条的值是「Nil」「What answer」「the right itinerary」—— 像是 v4 建表单时
   *    把这个字段改成了自由文本题。同一列两种含义，写进去会误导销售。
   *    而且表里现有 703 行这一列**全是空的**，客户自己那条管道也没写过它。
   *    所以本轮跟现状保持一致：留空。等 PM 确认 v4 那道题到底是什么再决定要不要填。
   */
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
    {"field": "blank"},
    {"field": "blank"},
    {"field": "answer", "key": "when_are_you_hoping_to_travel?"},
    {"field": "answer", "key": "whats_your_budget_per_person_nzd?"}
  ]'::jsonb,

  /**
   * 🔴 **空的，不翻中文。** PM 要的就是「fb 默认的表格式」：表里现有 703 行的团名
   *    列写的是 `still_deciding_-_show_me_all` 这种 Facebook 原样的值，ME 写进去的
   *    也必须是同一种写法 —— 一列里两种语言，销售按那一列筛就会漏人。
   *    `mapped` 一处都没配，所以这张对照表根本不会被读到；留一个空对象是为了
   *    让「故意不翻」这件事在配置里看得见，而不是像忘了填。
   */
  '{}'::jsonb,

  /**
   * 判重退路：第 2 列（留资时间）+ 第 16 列（电话）。
   *
   * 🔴 这一把在这张表上**基本不会命中**，留着是当保险：表里的 created_time 是
   *    Facebook 导出的 `2026-09-23T19:35:05-05:00`（带 FB 账户时区偏移），
   *    ME 写的是同一时刻的 `+00:00` 写法，逐字比不相等。真正干活的是下面那把
   *    机器键 —— 而这张表 703 行**每一行**第 1 列都有 `l:` 编号，机器键够用。
   *    万一哪天那条外部管道改版写出没有编号的行，这一把能接住。
   */
  ARRAY[1, 15],

  -- 判重主键：第 1 列（下标 0）的 `l:<线索编号>`。机器写的、没人会去改，唯一真正稳。
  0,

  /**
   * 表头签名：Sheet1 第一行必须逐格长这样，对不上这轮一行不写并出人工待办。
   *
   * 🔴 这一列是「加两列」这步人工动作的唯一验收闸。没加最后两格 → 当场停手；
   *    有人在中间插了一列 → 当场停手。没有它的话，ME 照配置写满 34 格，
   *    电话会写进邮箱列、员工手打的跟进记录被挤走，而回执全绿、一条待办都不出。
   *    这张表是销售每天直接看的，错位比不写糟得多，而且追加不可逆。
   *
   * 表头右边多出来的列不算数（比对只看前 34 格），人在右边留草稿列不影响。
   */
  ARRAY[
    'f', 'created_time', 'ad_id', 'ad_name',
    'adset_id', 'adset_name', 'campaign_id', 'campaign_name',
    'form_id', 'form_name', 'is_organic', 'platform',
    'which_tour_interests_you_most?',
    'email', 'full_name', 'phone_number', 'lead_status',
    '员工跟进记录', 'Many Chat',
    'E1已发', 'E1打开', 'E2已发', 'E2打开',
    'E3已发', 'E3打开', 'E4已发', 'E4打开',
    '客户回复', '回复摘要', 'id', '邮件进度', 'inbox_url',
    'when_are_you_hoping_to_travel?', 'whats_your_budget_per_person_nzd?'
  ]::text[],

  -- 时区只给 `format: 'local'` 用；这张表的时间列走 iso，所以它此刻不参与渲染。
  'Pacific/Auckland',

  /**
   * 🔴 **补档窗口 = 2026-09-20，别往前调。**
   *
   * 这个日期下实测（2026-09-24，拿生产库和当天导出的表逐条对）：
   *   · 库里 2026-09-20 以来 26 条线索
   *   · 其中 23 条那条外部管道已经写进表了 → 机器键命中 → 跳过
   *   · 剩下 3 条正是 v4 表单（form 3232987727090852）的线索 → 这一轮会写进去
   * 也就是说开闸第一轮**只追加 3 行**，正是 PM 要补的那 3 条。
   *
   * 🔴🔴 **往前调会出事，原因跟上一版完全不同，先看完再动：**
   *      库里 735 条线索里有 **347 条的 `source_ref` 不是 Facebook 线索编号**，
   *      而是历史导入时拼的 `邮箱|时间戳`（例如
   *      `dave.attwell@outlook.com|2026-06-14T07:39:49.000Z`）。它们全部落在
   *      **2026-06-14 ~ 2026-07-25**；2026-07-24 起才都是真编号。
   *      把窗口调到 2026-07-24 之前的后果有两条，都是不可逆的：
   *        1. 第 1 列会写出 `l:dave.attwell@outlook.com|2026-06-14T...`，
   *           一列本该是数字编号的格子里混进邮箱；
   *        2. 这种值跟表里的 `l:1687504185706630` 永远对不上 → 机器键失效 →
   *           那 347 个人**在销售正在用的表上被重写一遍**，跟进记录劈成两行。
   *      真要补 2026-07-24 之前的历史，先把 `contact_touchpoints.source_ref`
   *      回填成真编号（或者另配一条只认真编号的规则），别只改这个日期。
   *
   * 2026-07-24 到 2026-09-20 之间这一段是安全的（全是真编号，机器键能挡住重复），
   * 想一段一段往前补可以，但每挪一次都要看一眼表再挪下一段。
   */
  '2026-09-20T00:00:00+00:00'::timestamptz,
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
  dedup_id_column = EXCLUDED.dedup_id_column,
  header_row = EXCLUDED.header_row,
  timezone = EXCLUDED.timezone,
  backfill_since = EXCLUDED.backfill_since,
  enabled = EXCLUDED.enabled,
  updated_at = now();
