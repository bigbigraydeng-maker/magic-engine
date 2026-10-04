# 价格 / 日期识别补强（对外发布闸的识别函数）— 2026-10-05

风险级别：**A**（`containsPriceClaim` 是发布路由的挡板判据）。权威任务来源：客户内容底座规划 v0.3 第 3 节「第 0 步」最后一条 + 第 9 节「魏征 B1」。
**范围**：只补识别规则 + 回归集 + 只读影子统计。**不改**任何渠道接线、发布路由，不建表；「白名单绑 tour_id」本 PR 不做（依赖第 3 步的产品事实源）。

## 1. 改了什么

| 文件 | 改动 |
|---|---|
| `src/lib/content/price-claim.ts` | 宽、严两个口径都补币种写法（见 §2）；旧规则原样保留在最前面，新的只往后追加 |
| `src/lib/content/date-claim.ts`（新） | 精确日期识别 `findDateClaims` / `containsDateClaim`，**不接任何渠道** |
| `src/lib/content/claim-shadow-stats.ts`（新） | 只读对照函数：冻结的旧规则 vs 现行规则 |
| `scripts/claim-shadow-stats.ts`（新） | 读本地一个 JSON 文件、打印对照报告；不联网、不读密钥、不写盘 |
| `src/lib/content/claim-recognition.test.ts`（新） | 回归集（43 条正常文案 / 42 条价格正例 / 35 条价格反例 / 25 条日期正例 / 49 条日期反例 / 14 条旧规则正例 + 超集断言 + 旧规则冻结快照） |
| `src/lib/factory/copy-generator.test.ts` | 新增 2 条：NZD / ¥ / 元 写法的编造价会落模板；NZD 真价白名单能放行 |

`src/lib/factory/copy-generator.ts` **一字未动**。

## 2. 识别规则对照

| 写法 | 旧 | 新（宽） | 新（严，挡发布） |
|---|---|---|---|
| `From NZD 4,999` / `NZD4999` / `4,999 NZD` / `AUD88` / `4999 NZDpp` | 漏 | ✅ | ✅ |
| `USD 1,200` / `RMB 12000` / `US$ 99` | 漏 | ✅ | ✅ |
| `¥3999`（半角）/ `￥3999` / `3999元` / `纽币` / `纽元` / `新西兰元` / `新西兰币` / `澳元` / `澳币` / `澳刀` / `美元` / `美金` / `美刀` / `人民币` + 数字 | 仅全角 `￥` | ✅ | ✅ |
| `1.2万元` / `8千元` / `2万纽币` | 漏 | ✅ | ✅ |
| `NZD 1.3k` / `1.3k NZD` / `$1.3k` | 漏 | ✅ | ✅ |
| 裸 `1.3k` / `20k` / `10k followers` | 漏 | ✅（有意，宽口径多触发只会落模板） | ❌ 不收（不能挡发帖） |
| `4K video` / `8K drone`（视频分辨率） | — | ❌ 排除 | ❌ |
| `CNY 2027 tours`（春节） | — | ❌ | ❌ **故意不收 CNY** |
| `NZD 7 day itinerary` / `USD 3 nights` / `NZD 2 adults` / `澳币 3 天` / `美金 10 人`（币种码后面跟的是单位，不是金额） | — | ❌ | ❌ |
| `All prices in NZD↵7 day tour`（跨行） | — | ❌ | ❌（新增币种不跨行配对） |
| `5元件` `元旦` `元宝` `元朗` `元数据` `2元宇宙` `5 audience` `2 NZD-friendly cafes` `Fraud 5 cases` | — | ❌ | ❌ |
| `NZD 99 per night` / `NZD 99 free cancellation` / `¥3999 人均` | — | ✅ | ✅（有意：这些后面跟的是价格说明，不是单位） |

日期（`findDateClaims`，精确口径）：`15 March`、`March 15`、`March 5`、`15th of March`、`1st of September`、`5 Mar`、`Mar. 15`、`Sept 3`、`15 March 2027`、`March 2027`、`15/03/2027`、`2027-03-15`、`2027/03/15`、`3月15日`、`2027年3月`、`2027年3月15日`、`12月出发`；句末的点会去掉（`Closes 5 May.` → `5 May`）；小写 `may` 做情态动词时不算，且不会吞掉它后面的真日期（`Fares may 1 July increase` → `1 July`）；日≤31、月≤12 的范围会校验。
**不当日期**：`2027 tour`、`3 days`、`Level 3`、`Room 12`、`Market 50 Street`、`22 Market Street`、`Shop 5 Mayfair`、街名（`88 May Road`、`12 August Street`、`15 May Court`、`7 June Grove`）、`March 7 day tour`、`May 5 star lodge`、`Jan 5 km run`、`Nov 9 am`、`you may 5 times`、`6月龄宝宝`、`13月`、`第3月`、`满12月`、`0.5月`、`1月5号线`、`每月`、`3个月`、`24/7`、`v2.1.3`、`14:35`、`1999.99.99`。

### 与旧 `DATE_RE`（`copy-generator.ts:91`）的关系
**没有替换它。** 子牙、魏征设计审都指出：把它换成新规则会改变 `hasInventedClaim` 的行为（旧的「31 July」不算断言，新的算，brief 里没有原样出现就会落模板；而且 `15th March` / `15 March` / `March 15` 互相不归一，会让以前放行的文案现在掉回模板）。这次替换要和第 4 步的结构化比对（年/月/日拆开比，不比字符串）一起做，不在本 PR。所以：
- 新的 `findDateClaims` 现在**没有调用方**，是给第 4 步准备的；
- `copy-generator` 里那套旧日期规则**照旧认不出** `15 March`、`3月15日`——这条缺口**本 PR 没修**。
- 测试里有一条「copy-generator 的私有 DATE_RE 没有漂移」：第 4 步替换它时会变红，提醒连同冻结副本一起清理。

### 行为影响（诚实说明）
1. **严口径被发布闸使用**（`judgeOutgoingPost` → `publer/create-post`、`schedule`、`quick-post`；另有 `pm-todo/manual-content-items.ts`、`SocialPlanSection.tsx`）：**一合并就生效**。凡文案里有上表新认出的价格、且配图来源没核实为实拍的帖子，会被拦。影子统计里的「新增命中」是「文字命中」的上限，实际被拦还要叠加「配图来源未核实」这一条。**合并前请先跑 §4 的影子统计**，看会多拦几条。
2. **宽口径被 `copy-generator.hasInventedNumber` 使用**：补强后，AI 写的广告文案里出现 `NZD 4,999`、`¥3999`、`3999元`、`1.3k` 这类、且不在 `verified_offer` 白名单里的数字，会整条落模板（文案变平淡，没人被挡）。以前这些写法会漏过去。这是任务明确要求的方向，不是接线变化。**落模板的比例没有量化**——影子统计的数据源（社媒帖、reels）不含 AI 广告文案。
3. 白名单只比数字、不比币种（旧行为，没变）：`verified_offer` 写 `NZD 4,999`，AI 写 `4,999 NZD` 或 `NZD 4999` 都能放行。`1.3k` 不会被换算成 1300（只识别，数字归一属于第 4 步），所以真价 1300 时 AI 写 `1.3k` 会落模板（偏保守）。
4. **超集只在「命中与否」这一层成立，命中的片段可能变长**：例如 `NZD 4,999 for 2`，旧规则命中的片段是 `4,999 for 2`（里面的 2 不在白名单里 → 判编造），新规则命中的是 `NZD 4,999`（放行）。这和旧版 `$99 for 2` 的既有行为一致，不是新类别；反过来 `Was NZD 5000 now NZD 4999` 由放行变成拦截，方向是预期的。

## 3. 已知没覆盖 / 已知误伤（有意，不是 bug；写在代码注释里）
**价格**：中文数字（三千九百元）· 符号在数字后（`4999$`、`10 US$`）· 币种后带冒号/括号（`NZD: 4999`、`Price (NZD): 4,999`）· `4999 NZ dollars` / `yuan` / `3999块` · € £ EUR GBP HKD SGD · `CNY 3999`（CNY 故意不收）· 全角数字（`３９９９元`、`＄４５０`；评估过 NFKC 归一，范围外，留到影子统计之后再定）· `NZD 4 999`（空格千分位，只识别到 `NZD 4`）。
已知误伤：币种码紧贴年份（`#NZD2027`、`2027 NZD rates`）、域名/账号里夹币种码加数字（`nzd5.com`、`rmb88`）会命中；旧的 `AUD` 源允许跨行配对（`All prices in AUD↵7 day tour` 仍命中），为保证超集不能改旧源。
**日期**：周几、`next month`、节日名、中文数字日期、`租期12月`（当时长用）、**小写月份缩写（除 may 外）仍会命中**（`3 mar`、`this will mar 5 of them`；第 4 步接线前必须再收紧）、`31st May` 与 `May 31` 不归一、日期区间只抓到一端（`15–20 March` 只得 `20 March`）、`3.4.2026` 这类版本号与 dd.mm.yyyy 日期分不开；月名后面跟 `view/way/row/close/park/walk` 等街道后缀词时（如 `15 March close of play`）会漏识别。

## 4. 影子统计（给协调窗口跑，我不读生产密钥）

**目的**：回答「新规则比旧规则多命中多少条、哪些是误伤」。三个层：`price_strict`（会挡发布，**重点人工看**）、`price_recall`（只触发落模板）、`date_strict`（信息性：旧日期正则的命中几乎全是裸年份，这一层的「新增命中」只说明精确识别器多看见了日期，不代表误伤）。`丢失命中` 在两个价格层必须是 0（结构性的，只是一道回退报警）。

**第一步**：在 Supabase SQL 编辑器跑下面这条（**只读**，只有 select），结果是一个 JSON，另存为 `rows.json`。列名取自建表迁移文件，实现审查已逐列核对；如果报「列不存在」告诉我，我改。
```sql
select coalesce(json_agg(r), '[]'::json) as rows from (
  select 'content_posts.caption'::text as source, id::text as id, caption as text
  from public.content_posts
  where status in ('approved','scheduled','published')
    and coalesce(published_at, scheduled_at, created_at) > now() - interval '90 days'
  union all
  select 'content_posts.script', id::text, script
  from public.content_posts
  where status in ('approved','scheduled','published')
    and coalesce(published_at, scheduled_at, created_at) > now() - interval '90 days'
  union all
  select 'reels_drafts.fb_caption', id::text, fb_caption
  from public.reels_drafts
  where created_at > now() - interval '90 days'
) r;
```
说明：发布闸判的是 `caption`，所以 `content_posts.caption` 这一行最能代表「一合并会多拦几条」；`script` 与 `reels_drafts.fb_caption` 作参考。导出文件含客户文案，**只放本机，不进仓库**。

**第二步**（在仓库根目录）：
```bash
npx tsx scripts/claim-shadow-stats.ts rows.json
```
输出一张表（每层 旧命中 / 新命中 / 新增命中 / 丢失命中）+ 新增命中明细（命中片段 + 命中位置前后各约 60 字）。

**怎么读**：`price_strict` 的每一条「新增命中」人工判一次——是真价格 = 该拦（正中目标）；不是价格 = **误伤，要收紧严口径**，把那条贴给我。样本量（总行数/有文案行数）随结论一起报。**这个统计只覆盖这两张表**；每日计划、工厂工单里的文案不在内，AI 广告文案（宽口径真正作用的对象）也不在内。

## 5. 验证（实际跑过的）
见 PR 正文「## 验证」。

## 6. 审查记录
- **设计阶段**：子牙（需改后可进：B1 CNY 误伤、B2 日期不接线、B3 may/mar 误判）、魏征（需改后可进：B1 CNY、B2 跨行配对、B3 日期接线、B4 元/字母后缀、B5 严日期误伤）——全部并入。
- **实施阶段**：子牙（需改后可进：日期小写月份注释与行为不符、缺台账卡、缺 g 标志断言）、魏征（需改后可进：日期月名+单位词/街道后缀/范围/中文月、币种码+非金额数字、测试缺牙齿、摘录位置）——**已按意见修完并用测试锁住**（27 种故意改坏，26 种被测试抓到；第 27 种「丢失命中永不记录」结构上不可能触发，已在注释里说明）。
- 没有开第三轮审（仓库规定普通任务最多两轮）；合并前由 PM 回「合」。

## 7. Reuse Statement
- 复用：`price-claim.ts` 既有宽/严双口径与 `containsPriceClaim`、`price-claim-gate`；影子统计用既有 vitest。
- platform-shared：币种/日期的**写法识别**（NZD/USD/¥/元/15 March/3月15日）属市场与语言通用，不含客户名、客户 ID、行业判断。
- industry-specific：无。client-specific：无（CTS 的 NZD 只作测试举例；`CNY=春节` 的排除是旅游文案通用事实，不是 CTS 私货）。
- 学习/记忆：无写入。
- 对账：实现落点与 tier-gate 决策时一致（既有内容检查能力加固，无新能力线，无需登记候选）。
- 换客户测试：CTS → Roman（地产，`$` 挂牌价、`m²`）→ 建材客户（`/m²` 单价）：新增规则都不需要改；只可能的新增是币种词表（例如以后做 UK 市场加 GBP），属表驱动扩充。
