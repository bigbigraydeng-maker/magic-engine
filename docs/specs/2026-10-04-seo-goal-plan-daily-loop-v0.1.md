# SEO「目标 → 计划 → 每日任务」闭环 v0.1（CTS 先行）

> 状态：**设计稿 v0.1，只出方案，不含任何运行代码 / 迁移 / 开关改动**。
> 作者窗口：方案窗口 sid cdd5dbf9（2026-10-04）。上游核查：窗口 sid 06ec010d。
> 复审：子牙（架构）+ 魏征（挑刺）已各审一轮，意见与采纳/驳回见 **附录 A**；正文已按采纳项修改（v0.1 复审后版）。
> 读了哪份手册：`playbook-seo-general.md`（全文，重点 §二 §四 §六 §七 §八 §十 §十四）。

---

## 0. PM 版摘要（一页）

**结论一行：SEO 现在是"盯得很好、几乎不干活"。这份方案让它变成"有目标、每周自己排活、每天自己做能做的、做没做成能查出来"，而且不再出现"卡片躺着没人管"。**

**现状（我重新查过生产库，和上个窗口有 3 处出入，见 §1）**
- **监控很强**：谷歌搜索数据每天更新、关键词排名每周拍照、周报照发。
- **发现机会基本是摆设**：5 条巡检规则里，有 1 条按设计就不可能触发、1 条只看排名第 2~3 的词（CTS 几乎没有）、1 条只会抓"整页没人链接"的极端情况。真正有价值的"排名第 4~30 的近机会词"，数据早就在库里（37 个、月搜合计 1.66 万），没人用。
- **没有活的 SEO 目标**：之前的"自然流增长"目标 9 月 2 日过期，没出结论；现在 CTS 只剩广告线目标。
- **卡片没人做的真实原因**：不是人懒，是**设计上就没有人和机器会去做它**——没有执行器、自动执行任务一直开着"空跑"开关、今日待办规则故意不展示这类卡、14 天后系统自动把它标成"作废"。
  - 更正一个说法：卡片不是"从来没完成"。6 月~7 月有过约 100 张被人点完成（几乎全是别的客户，CTS 只有 2 张）；**7 月 27 日以后全库零完成**。

**目标态（一句话版）**
1. PM 给 CTS 立**一个**活的 SEO 目标（点击量），之后每周一系统自动挑 ≤5 件事、排到周一~周五。
2. 每天系统先核对昨天的事真做成没有（页面真改了、真上线了、真被谷歌收录了），再做今天**能自己做的**（查收录、查排名、出文章草稿、出方案）。
3. 需要 PM/FDE 点头的，**合并成每天最多 1 条**，说清楚"看什么、点哪里、直达链接"。
4. 一张卡只有在**系统核验过**才算完成；你点了"完成"但核验不过，会单独标出来。超过两周没动的，明明白白写"过期放弃"并进周报，不再悄悄消失。

**分几步，每步你能看到什么**

| 步 | 做什么 | 你能看到什么 |
|---|---|---|
| 第 0 步 | 清掉 CTS 躺了 4 个月的旧卡和过期计划，立新目标 | 一份"清了哪些、怎么恢复"的清单；目标页上出现 CTS SEO 目标 |
| 第 1 步 | 接通"发现机会"+"每周排活"+"每天核验"（这三样必须一起上，缺一就会重蹈覆辙） | 每周一一份"本周 5 件事"；每天一行"计划 X / 核验完成 Y / 过期 Z" |
| 第 2 步 | 每天的待办入口 + 周报栏目 | 今日待办里最多 1 条 SEO 条目；周报里有 SEO 记分牌 |
| 第 3 步 | 加"对手有、我们没有"的缺口词（要花谷歌数据费，有周上限） | 计划里出现新写文章的建议，每条带真实搜索量/难度 |
| 第 4 步 | 跑稳 4~6 周后再放到第二个客户 | — |

**诚实边界（先说在前面）**：CTS 全站 14 天只有约 2.4～3 万次曝光（手册 9 月上旬那次实测 2.4 万；今天近 14 天约 3 万），**没法证明某一次改动带来了多少流量**。我们只承诺能查得出的三件事：①事情真做了（页面/文章/链接核验）；②目标词排名有没有动 ≥3 名；③整站点击趋势。整站涨了不等于某个动作的功劳，系统不会这么写。

**要你拍板的只有一件事（下面最后一问）：CTS 的 SEO 目标，28 天点击量定多少。** 候选和依据在 §6.1。

---

## 1. Current State Audit

**remote fetched at 2026-10-04T08:01:32Z；origin/main = `31f716c05e391a7b53029f063574449db19c2a76`；本分支 HEAD 同此 SHA（左右差 0/0），工作区干净。**
生产库只读（项目 `glbdnayojixmexgofbsd`），未写任何数据；DataForSEO / 付费接口本窗口 **0 次调用，花费 0**。

### 1.1 与上个窗口结论对不上的地方（以本窗口查到的为准）

| # | 上个窗口说 | 本窗口查到 | 影响 |
|---|---|---|---|
| 1 | SEO 卡 358 张，没有任何一张完成 | `execution_items`(dimension=seo) 全库历史有 ~100 张 completed（6/1~7/27，其中 6/22 那周 67 张几乎全非 CTS，像批量点的），CTS 只有 2 张 completed + 8 张 skipped；**7/27 之后全库零完成**。账本 2026-09-26 的 391 张 / 60 天 / 0 完成与此一致 | 说"60 天零完成"准确，说"从来零完成"不准确；不改变结论 |
| 2 | `low_ctr_title` 吃 GSC 前 50 行、关键词文本匹配几乎瞎 | 还有更根本的：`rules.ts:34-35` 把触发排名限定在 **第 2~3 名**，规则注释写"top-of-page-2-ish"自相矛盾；CTS 排名 2~3 的词基本没有 | R1 要重定义，不是修匹配 |
| 3 | 目标"CTS 自然流 525→1000，实际 229" | 229 是**目标 9/2 过期那刻冻结的值**（刷新任务只刷活跃目标）。今天用**同一个取数函数**（GA4 近 28 天自然会话，只是取数日不同）算是 **817**；谷歌点击周值从 8 月中的 ~137 涨到 ~267。**"未达标"是 9/2 的快照，不是今天的事实**；但这段涨幅我们**不能**归功于任何 SEO 动作 | 立新目标时基线要用今天的数 |

> 数字对账脚注：上个窗口的"358 张"是近 60 天口径，账本 9/26 的"391 张"是 60 天口径另一日的快照，本窗口的"~100 张完成"是全历史、不限天数；三者统计窗口不同，不矛盾也不能互相加减。"近 14 天曝光"手册写 2.4 万是 9/1~9/14 旧窗口，今天按 §1.3 的周值约 3 万。

### 1.2 发现机会（Inspect）

- `seo_patrol_findings` 表是"每天先清后写"，只保留最新一批（现 stale_content 29 条、not_indexed 134 条，后者全是 10/4 当天写入）。**所以"另外 3 条一次没触发"不能用这张表证明**；但代码层面可证：
  - `keyword_opportunity`：只看 `!covered` 的词，而 `job.ts:163` 写 `covered = 有排名`，输入来自 `keyword_snapshots`（只存**已有排名**的词，CTS 最新快照 58 词 58 个有排名）→ **按设计不可能触发**。
  - `low_ctr_title`：见上表 #2，且 CTR 取自 GSC 前 50 词（`SNAPSHOT_ROWS=50`）按词文本小写匹配。
  - `missing_internal_link`：`page-signals.ts` 自己注释写明——导航/页脚链接让几乎每页都有"入链"，只有真孤儿页才触发，且只看 GSC 前 50 页。
  - `not_indexed`：映射到 `seo.refresh_blog`（"刷新旧文章"），但手册 §六：谷歌"已抓取未收录"官方就说"无需重新提交"，**这条动作本身是错的**；`seo.refresh_blog` 也没有执行器。
- **现成但没接线的素材**（Reuse）：
  - `keyword_snapshots`：CTS 2026-09-28 快照 58 词，其中排名 4~30 且月搜 ≥100 的 **37 个**（4~10 名 7 个 / 11~20 名 17 个 / 21~30 名 13 个），月搜合计 16,610。
  - `src/lib/seo-agent/`（`assembler`/`conductor`/`scorer`）：**已经会做**关键词缺口 + 机会打分 + 大模型排序，用 `getKeywordsGap` / `getSerpCompetitors`，但只挂在按需接口 `GET /api/clients/[id]/seo-agent/plan`，**不定时、不落库**。
  - `src/lib/seo-gap/`：缺口报告（一次性，按需）。`dataforseo/labs-keywords.ts` `getKeywordIdeas` / `labs-competitors.ts` `getKeywordsGap` 已封装。
  - `seo_topic_candidates` 表（有 `keyword/my_position/volume/kd/competitors_ranking/status/blog_post_id`）：**全仓无任何代码读写，CTS 0 行**。`competitor_keyword_snapshots`：CTS 0 行。
- `clients.primary_keywords`（CTS）11 个词**全是品牌词**（cts tours / cts nz …），不能当增长词源。

### 1.3 监控（Measure）— 强，不动
`gsc_page_daily`（CTS 2026-02-23 起逐页逐天，近 28 天 222 页）；`gsc_performance_snapshots` 每天；`keyword-snapshots-weekly`；`weekly-seo-report`；`site-audit-*`；GA4 每日。
CTS 谷歌口径：近三个完整周点击 268 / 269 / 266，曝光 ~14.7k / 13.8k / 18.0k；平均排名 7.8。

### 1.4 优化文章（Act）
- 改标题/描述：`seo-meta/cycle/`，**CTS 现已开启**（`seo_config.meta_cycle_enabled=true`，`max_pages=3`，保护名单 7 个；STATE.md 写"CTS 目前是关的"已过时）。**本方案不碰它**。
- `blog_posts`（CTS 16 篇）：rejected 10 / published 2（最近 6/13）/ failed 2 / draft 2（9/15、9/23）。**14 篇没有记录 `primary_keyword`**（周博客不是关键词驱动的）；**没有"拒稿原因"字段**，无法分析为什么拒。拒掉的篇里有"trip a deal china"（竞品品牌词）和"restaurants in shanghai"。
- 周博客 cron 写草稿，**不碰卡片**；`seo.refresh_blog` 没有任何执行器。

### 1.5 目标 / 计划 / 卡片（Prescribe → Act）
- `goals`（CTS 9 条）：organic_traffic 目标 `expired`、`verdict` 为空；**无 active 的 SEO 目标**（active 只有圣诞团报名与留资两条，广告线）。
  - 判定机制：`goals-expiry-check` 只把状态翻成 expired；`verdict` 只能由人调用 `POST /api/goals/[id]/judge` 写。**没有任何自动出结论的路径。**
  - `organic_traffic` 的当前值取 GA4 最近一份快照的自然来源会话，**不是**谷歌搜索点击（`strategy/auto-fetch.ts`）。
- `initiatives`（CTS 未归档 22 条）：挂在已过期"自然流增长"目标下的 **16 条**（demand_generation 9 / competitive_defense 4 / trust_building 3）——上个窗口说 17，以 16 为准。无 SEO 专属类型；`initiatives.campaign_ids` 只是松散数组。
- `execution_items`（CTS，dimension=seo）：pending 25（6/8 那批 "[C5]" 10 张 + 9/1 诊断 6 张 + 近期巡检/周期 9 张）、in_progress 1、superseded ~130（其中 `seo.refresh_blog` 80）、completed 2、skipped 8。
  - 巡检卡标题只有"Refresh Blog / Generate Blog Post"，不看 `steps_json` 不知道做哪页。

### 1.6 卡片为什么没人做（Act 断点，代码实证）
| # | 事实 | 出处 |
|---|---|---|
| 1 | 全库唯一的自动执行器只认 3 个 `generate_*` 类型；巡检卡是 `seo.*`，**根本选不上**；`seo.refresh_blog` 被明确从白名单拿掉（"没有执行器"） | `execution/auto-run.ts:162`、`auto-run-policy.ts:27-52` |
| 2 | 自动执行任务在 `render.yaml` 里一直带 `?dry_run=1`，**只选不做、什么都不写** | `render.yaml` execution-auto-run；STATE §4.1 |
| 3 | 即使放开，巡检卡带 `keyword/url` 会被判"人工专属"；且 8 天后不再算"被背书" | `auto-run-policy.ts:207,249-254` |
| 4 | 今日待办"只留五类"**明文排除** SEO 巡检卡，归周报；而周报里并没有"这些卡的处置状态" | `pm-todo/daily-todo.ts:528-532`、`five-kinds.ts` |
| 5 | 系统在 14 天后把仍 pending 的卡改成 `superseded`（"作废"），不是完成——**卡片坟场是系统自己的设计** | `zhuge/card-expiry.ts` |
| 6 | 发了博客也不会回头把卡标完成；Kernel 的 `action_runs.execution_item_id` 没人写回 | `blog-publisher.ts:180`、kernel 迁移 |
| 7 | 卡不挂目标/计划（`persistZhugeActions` 不写 `initiative_id`），没有"为了哪个目标"这条线 | `action-persister.ts` |

**一句话**：生产者（巡检）有、消费者（执行/展示/核验）没有；系统还会替你把没人理的卡"悄悄作废"。

---

## 2. 过平台层级门（me-platform-tier-gate）

> [跟班 · Tier] **归位既有 L1（SEO 支柱）的能力扩展 + 复用既有目标/计划项/执行卡三张表**，不新增能力线、不新增支柱；**表层面**：计划/卡片/目标复用既有表，但机会规则编号是数据库枚举、预算要独立账本，**需迁移**（WP-1、WP-3，均 A 级单独 PR，见 §8）；CTS 的目标值/保护名单/竞品名单/预算上限进 L4 客户配置。无需登记候选。
> [跟班 · 红线] 红线 2（客户事实不进共用代码）：目标值、竞品域名、关键词一律由客户配置/GSC/DataForSEO 供给；红线 4/5 自检见 §8。
> [跟班 · 继续] 归位既有 + 无红线冲突 → 已继续。

---

## 3. 设计原则：怎样才不会又变成"看起来通了其实没通"

对照 §1.6 的 7 个断点，每个断点必须有**机器可核验的对应物**，否则这块不算做完：

| 断点（§1.6） | 本方案的对应物 | 怎么证明没断 |
|---|---|---|
| 1,2 没执行器 / 空跑 | 每类计划项都标明"谁做"：**机器自做 / 机器出稿等人点头 / 只出方案人做**；不假装有执行器的类型一律不进计划（见 §6.2） | 当场试跑：一轮真实跑完，每类至少一张卡走到核验 |
| 3 被判人工专属 | 计划项走**自己的派发器**，不借 auto-run 的白名单；人工类单列 | — |
| 4 没人看见 | 每日最多 1 条合并条目进待办（review 类）+ 周报记分牌；**"计划 / 核验完成 / 判不了 / 过期"每天一行**。**警报不放在这条链自己里面**（链挂了就不会自己报）：由**另一条独立任务 `pm-daily-todo` 里的一道体检**读记分牌——昨天没有记分牌行 / 核验器没跑 → 进"开发欠账"栏（`/dashboard/admin/cron-health#dev-debt`）；同一条警报**连续 7 天没人处理 → 升成 1 条 `decide` 待办**（说清 what/how/href） | 验收：人为停掉派发器一天，次日 `pm-daily-todo` 的输出里出现该欠账；停满 7 天出现 `decide` 条目（试跑时用时间拨快的测试数据验证） |
| 5 悄悄作废 | 计划项**不再被 14 天自动 superseded**；超 14 天未动 → 明确置 `skipped`，`reason=expired_no_action` 写入 `execution_logs.meta.reason` 与 `steps_json.skip_reason`，进周报"放弃清单"。**放弃清单每一行都带 what/how/href 和"一键恢复"（置回 pending）**；**连续 2 周放弃率 >50% → 自动降为每周只出 1 条机器自做项，并发 1 条给 PM 的知会**（防止"点不动→在途堆满→系统沉默"） | 记分牌的"过期数"必须等于周报放弃清单行数；降级触发有专测 |
| 6 没回写 | **完成 = 核验器查到真实产物**（见 §6.2）；人点"完成"也要过核验，不过的标"自称完成未核验"；**核验有四种独立结论：核验通过 / 核验不过 / 没测成（取数失败、被拦截、窗口缺天）/ 判不了（数据不全，本轮不动）**，后两种不进"完成"也不进"失败" | 记分牌只数"已核验完成"，"没测成/判不了"各占一列；每类核验器各有"没测成"的测试用例 |
| 7 不挂目标 | 每张计划项写 `initiative_id` + `steps_json.goal_id/plan_week/opportunity_ref`；**顶层同时写 `keyword` 与 `url`**（旧去重键只读顶层，见 §6.3） | 抽查：任一张卡能顺藤摸到目标和机会 |
| （新增）堆积 | **在途上限**：未完成计划项 ≥ 8 条，当周不再出新项（并受上面"降级"兜底，不会无限沉默） | 记分牌显示在途数 |

**"派活不带核验"是这套方案里的硬禁令**：WP3（派发）和 WP4（核验）绑成同一批上线，不许只上派发。

---

## 4. 目标态总览（衔接现有系统，不另起一套）

```
 GSC 逐页逐天 ┐                                          ┌─ 周博客管线(已有,草稿→审核→PR)
 keyword_snapshots(每周)┼─▶ ① 机会池 ──▶ ② 每周一排活 ──▶ ③ 每日派发 ─┼─ 机器自做(查收录/查排名/诊断)
 DataForSEO 缺口词(周,有预算闸)┘   (seo_patrol_findings   (execution_items     │  (本方案新增小执行器)
 seo-agent 评分(已有,接定时)        新 rule_id)            +initiative_id)     └─ 只出方案(内链/合并/规范网址)
                                          ▲                       │                   → 人做 / 将来走 Kernel
                              ┌───────────┘                       ▼
                       goals(active SEO 目标)            ④ 每日核验器 ──▶ 记分牌 ──▶ 周报 / 今日待办(≤1条)
                       由 PM 立, 目标值 PM 拍                (查真实产物)         (整站趋势只展示不归因)
```

| 环节 | 复用什么 | 新增什么 |
|---|---|---|
| 目标 | `goals`（`createGoal`/`activateGoal`）、`goal-current-value-refresh` | 一个新指标 `seo_gsc_clicks_28d`（读 `gsc_page_daily`，近 28 天点击）；GA4 自然会话留作参考 |
| 机会 | `seo_patrol_findings`（`rule_id` 是 `seo_patrol_rule` 枚举，需迁移扩值，见 WP-1）、`keyword_snapshots`、`seo-agent` 评分、`getKeywordsGap`/`getKeywordIdeas` | 新规则：近机会词、缺口词、页级点击率偏低（见 §5.1） |
| 计划 | `initiatives`（复用现有类型，每目标 ≤3 条）、`execution_items`（`due_date`、`initiative_id`、`steps_json`、`action_type` 均已有列） | 周一计划器（挑 ≤5 项、排日期） |
| 执行 | 周博客管线、`seo-meta/cycle`（不碰）、人工点头面 | 每日派发器 + 3 个机器自做小动作 |
| 核验 | `gsc_page_daily`、URL Inspection（已有，每客户每天用 20 次，配额 2,000）、站点抓取、`keyword_snapshots` | 每日核验器 |
| 回执 | `cron_run_logs`、`execution_logs`（PATCH 已在用） | 记分牌行 |
| 可见 | 今日待办五类（新增 1 种 `review` 车道的 kind）、周报 | — |

**与 Campaign（2026-09-21 拍板）的关系**：Campaign 是增长营销里"有时间窗的一次推广"（社媒/广告/邮件），现有代码里没有 SEO 类 Campaign，也**不为 SEO 新造一种**。SEO 计划挂 **目标 → 计划项(initiative)**；当某个计划项服务于某个 Campaign 的落地页（例如圣诞团），写进 `initiatives.campaign_ids`。这是 SEO 持续线与 Campaign 时间窗线的松耦合，不是平行系统。

**与"今日待办只留五类"（2026-09-26）的关系**：不破坏。SEO 最多每天 **1 条**合并条目，归 `review`（"发出去前要看一眼"）；周计划本身走周报（`weekly` 车道）；只有"目标偏离"才可能升 `decide`。新增 kind 必须在 `five-kinds.ts` 的穷举表里给出车道（类型检查强制）。

**与 Kernel**：第 1 阶段**不新增任何对外写动作**——改站只走已有通道（周博客 PR、meta-cycle 自己的闸），结构性改动只出方案。`seo.rewrite_meta` / `seo.open_content_fix_pr` 收编属于孔子设计稿 §4.1 批 2（A 级，另案，且 `seo-meta` 临时豁免 2026-10-11 到期，**不在本方案范围，也不阻塞本方案**）。

---

## 5. A：发现机会怎么真接通

### 5.1 机会类型（判据 · 数据源 · 成本 · 防噪音）

| 机会类型 | 判据 | 数据源 | 成本 | 防噪音 |
|---|---|---|---|---|
| **近机会词** `near_miss_keyword`（首发，**零成本**） | 本周快照排名 4~30、月搜 ≥100（量/难度必须来自快照里的 DataForSEO 数）；按"量 × 距下一档差几名"算潜在点击上限排序 | `keyword_snapshots`（已有，每周） | 0（已采集） | ①品牌词/竞品品牌词排除（客户配置里的品牌别名 + 竞品名单）；②同词 90 天内已派过不再派；③3 周内排名剧烈震荡（>10 名）的词先观察不派；④低量词（<50）单次排名不采信（手册 §九） |
| **页级点击率偏低** `ctr_gap_page`（零成本） | 近 28 天该页曝光 ≥300、平均排名 ≤10，且点击率低于排名曲线 0.6 倍；**页级**取自 `gsc_page_daily`，不再按词文本匹配 | `gsc_page_daily` | 0 | 只用于**发现候选**，不用于判效果（手册 §十四）；先查标题是否 >60 字符被截断、是否与自家另一页分食同一主题（§十二） |
| **缺口词** `keyword_gap`（第 3 步，花钱） | 竞品排前 20、我们没有排名，月搜 ≥100、难度 ≤30，且含客户业务主题词、非品牌词 | `getKeywordsGap` + `getKeywordIdeas`（`src/lib/dataforseo/`，复用 `seo-agent/assembler`） | 每周每客户 1 轮；**预算闸是全环路公共闸（见 §6.4）：每客户每周所有 DataForSEO 调用合计 ≤ US$2 起步（PM 可调），单价首轮试跑实测后写进台账**（本窗口未调用，不估） | 竞品名单必须是 **FDE/PM 确认过的客户配置**，不由系统自选；量/难度缺一就丢弃，不当 0 放行（红线 §8）；与"已有页面已在排"的词去重；同主题已有 ≥2 页的先走"自相残杀体检"而不是写新文 |
| **同题自相残杀** `cannibalization`（第 3 步，小成本） | 同主题 ≥2 个自家页，枢纽页不是自家第一名（手册 §八） | `ranked_keywords`（按词查当前排的是哪个自家 URL） | 每候选主题 1 次查询，每周 ≤5 个主题 | 只产出**方案**（内链往枢纽汇 / 窄化定位 / canonical），不自动改（手册 §四、§八） |
| **排名下跌** `stale_content`（已有，保留） | 掉 >3 名 | `keyword_snapshots` | 0 | 保留现行去重；映射动作改为"诊断"，不再是"刷新博客" |
| **没收录** `not_indexed`（已有，**降级**） | 谷歌给的原因归类后，只对"可行动原因"出项 | URL Inspection（已有） | 0 | 手册 §六：Redirect / 规范网址 / 有意 noindex / 参数垃圾 / "已抓取未收录" **不派活**；"已发现未抓取"才进诊断。134 条里大部分预期会被剔掉 |

**不做**：`missing_internal_link` 不修（只对孤儿页触发是已知取舍）；内链机会改由"同题自相残杀"和"枢纽页体检"产出。

### 5.2 机会池如何落地
- 写 `seo_patrol_findings`（新 `rule_id`：**需迁移**给 `seo_patrol_rule` 枚举加 `near_miss_keyword`/`ctr_gap_page`/`keyword_gap`/`cannibalization` 四个值，并同步 TS 联合类型）。**注意**：这张表每天"先清后写"，只存最新一批；机会池要的是"本周候选"，所以**机会被周计划挑中那一刻，把证据快照（词/量/难度/排名/取数日期）抄进计划项 `steps_json.opportunity`**，之后不再依赖这张表。
- **隔离周机会生命周期（P2 修订）**：现有 `seo-patrol-daily`（`src/lib/seo-patrol/job.ts:488-492`）按客户删除全部 `status='fresh'` 的 finding，不分规则，会清掉周写入、尚未被周计划器消费的 `keyword_gap`/`cannibalization`/`near_miss_keyword`/`ctr_gap_page`。WP-1 必须把该删除**限定为每日规则的 `rule_id` 白名单**（`stale_content`/`not_indexed` 等现有每日规则），周规则行不被每日任务触碰；周规则行由周任务自己"先清本周规则再写"，并在同一次周任务内按 排序 → 写计划项（抄证据快照）连续完成，计划项写成功后才把对应 finding 置 `consumed`。WP-1 须加测试：每日任务跑完后周规则 `fresh` 行仍在。
- `seo-agent` 的评分与大模型排序接成**每周一次**（不是每日），产出写进机会池的 `priority` 字段（该表**目前没有此列**，由 WP-1 迁移新增可空 `priority INTEGER` 与 `priority_reason TEXT`）；大模型只负责排序与写"为什么"，**量/难度/排名一律只来自 DataForSEO/GSC，不让模型编数字**。

---

## 6. B：目标 → 计划 → 每日任务

### 6.1 目标（PM 拍业务口径，我出候选）
- **指标**：谷歌搜索**点击量（近 28 天）**。依据：手册 §十"北极星是整站曝光+点击"；`gsc_page_daily` 逐日、无滞后问题；GA4 自然会话更依赖统计代码与口径（9/2 的 229 与今天 817 差 3.5 倍，说明该口径对取数时点敏感）。曝光量作为**辅助指标**一并展示（`supporting_metrics`）。
- **周期**：2026-10-05 ~ 2027-01-03（13 周，覆盖圣诞团与 11 月招募窗口）。
- **基线（今天）**：近三个完整周点击 268 / 269 / 266 → 折算 28 天 **≈1,070**；周曝光 ~15k。
- **候选目标值（28 天点击，周期末）**：

| 档 | 目标 | 相对基线 | 依据（只用历史数据，不用预测） |
|---|---|---|---|
| 守住 | ≥1,070 | 0% | 近 6 周周点击 137→230→229→268→269→266，翻倍的原因**没有查明**，回落风险真实存在；只求不掉 |
| **稳健（建议，属判断题）** | **1,200** | +12% | 周点击在最近三周很平（266~269），+12% 约等于"再多一个小台阶"，不要求再翻倍 |
| 进取 | 1,340 | +25% | 需要近机会词池大面积成功 + 缺口词开始贡献；偏紧 |

  **三档的取法是判断，不是推算**，请不要把"稳健"理解成有模型支持。仅作规模参照：37 个近机会词（月搜 ≥100、排名 4~30）月搜合计 16,610；若**每个词都**升到下一档，用代码里已有的"排名-点击率"曲线做**未经验证的算术**，约再多 456 次点击/月（相对基线约 +43%）——这只说明"池子有多大"，**不是预测，也不是承诺**，更不是目标依据。CTS 14 天只有约 3 万曝光，实际结果会被噪音淹没（手册 §十四）。**目标值推荐不依赖该算术上限。**
- **判定**：周期末由系统出**预判**（用 `computeGoalVerdict` 同一公式），**PM 点一下才写 verdict**（保留现行"人写结论"的规则，但不再"过期无人理"：到期前 14 天进周报提醒）。
- **怎么建**：走现有 `createGoal`→`activateGoal`（PM 在对话里回目标档位，由本方案第 0 步执行）；`intent=awareness/sub_type` 取现有取值，新指标 `seo_gsc_clicks_28d` 补进 `PRIMARY_METRIC_CATALOG` 与 `autoFetchMetricValue`（已有 GEO 新指标先例；B 级小改，见 WP-3a）。
- **指标口径钉死（子牙意见）**：取数 = `gsc_page_daily` 近 28 天**全部页**点击求和，**跳过最近 3 天**（谷歌数据滞后），不用 Top-50 快照；**§6.1 的基线 1,070 必须用同一函数重算后再写进目标**，否则第一次刷新就会跳变；目录里 `recommended_for`/`sub_types` 要选定，否则建目标向导看不到这个指标。

### 6.2 计划项类型（只收"有人/有机器真能做"的）

| 计划项类型（`action_type`） | 来源机会 | 谁做 | 做到哪算完成（核验） |
|---|---|---|---|
| `seo.plan.diagnose_page` 诊断某页/某词 | 页级点击率偏低、排名下跌、没收录 | **机器自做**：抓 SERP 前三、核对标题长度、查同题自家页、查收录原因，产出一份结论写回卡 | **产物字段齐全才算**：`serp_top3_urls`、`title_length`、`own_pages_same_topic`、`fetched_at` 四项都在；缺任何一项 → 结论"判不了（数据不全，本轮不动）"，**不是**完成，也不当 0 放行（自己写结论自己验是软承诺，已否决） |
| `seo.plan.draft_post` 为某词出文章草稿 | 近机会词（该词排名页不是博客、无自家兄弟页抢）、缺口词 | **机器出稿 → 人点头 → 走现有博客发布管线** | `blog_posts` 出现 `primary_keyword/keyword_volume/keyword_kd`（现有真实列名）与计划一致的行且状态走到 `published`，并且线上网址 200 |
| `seo.plan.strengthen_page` 加强某页（补小节/加内链/往枢纽汇链） | 近机会词（已有页在排但内容不全）、自相残杀 | **只出方案，人做**（手册 §四：加内链/动结构必须人点头）；方案含 what / how / 直达链接 | 重新抓取该页，方案中指定的链接/小节**真的出现**（`link_present`/`text_present`）。抓取被 CDN/反爬拦住（手册 §三）→ "没测成"，不是通过也不是失败；需补一个**只读重抓封装**（现有站点重抓只有按需接口） |
| `seo.plan.consolidate_pages` 合并/规范网址/跳转 | 自相残杀 | **只出方案，A 级动作不自动**；第 1 阶段只出方案 | 方案被 PM 采纳（decide）后由人执行；核验同上。**PM 不采纳 → 记 `decided_no` + 原因，算"已处置"，但不进"核验完成"计数**（防止拿"不做"充数） |
| `seo.plan.recheck_rank` 复查目标词排名 | 所有已核验完成的上述项 | **机器自做**：T+14 天与 T+28 天各查一次该词（固定 `depth` 与参数，同词多取一次，手册 §九） | **基线不用周快照**（它只存"当时有排名的词"，且最多滞后 7 天）：**派发当天现场对该词查一次**，把排名、`depth`、取数时间一起写进 `steps_json.baseline`。四态结论：移动≥3 名 / 没动 / 没测成 / **超出查询深度**（基线或复查查不到 ≠ 掉出榜，也 ≠ 没测成，单列） |

> **明确不进计划**：改标题/描述（`seo-meta/cycle` 自己的活，不碰）；"请求谷歌收录"（做不到）；新页面落地页建设（手册 §四：新页面一律人工点头，且 `seo.publish_landing_page` 只有桩）；任何需要对客户网站直接写入的动作。

### 6.3 每周一排活（计划器）
1. 读 active SEO 目标与本周机会池，按"**潜在点击上限 ÷ 难度成本**"排序，**每周 ≤5 项**；组合规则：至少 1 项机器自做、最多 2 项需人点头（防止一周堆 5 个等人批的）。
2. **在途上限**：未完成计划项 ≥8 → 本周只补核验与复查，不出新项。
3. 上周没做完的**顺延一次**；再没动 → 置 `skipped`，`reason=expired_no_action` 记入 `execution_logs.meta.reason` + `steps_json.skip_reason` → 周报"放弃清单"。
4. 每项写：`initiative_id`、`due_date`（周一至周五按"机器自做先、人点头后"错开，避免周五扎堆）、`steps_json={loop:'seo_goal_v1', goal_id, plan_week, opportunity:{keyword,volume,kd,rank,fetched_at,source}, baseline:{rank_at_plan,fetched_at}, verify:{type,params,check_on}}`。
5. 计划项挂的 `initiative`：每目标最多 3 条（复用现有类型：`demand_generation`=近机会/缺口词出稿；`competitive_defense`=掉名次/自相残杀；`trust_building` 不用）。先归档 CTS 那 16 条过期计划项（第 0 步）。
6. 与旧机制隔离（子牙必改项，**均为具体条件，不是原则**）：
   - 计划项 `source='zhuge'`（避免动 `execution_items_source_check` 约束；承认语义偏差——`zhuge` 原指"建议"，计划项带 `due_date` 更像"承诺"；WP-5 验收要查 `pm-todo` 里其他按 `source='zhuge'` 过滤的地方不会误收计划项），靠 `steps_json.loop='seo_goal_v1'` 区分。
   - **去重键**：`executionItemDedupKey`（`action-persister.ts`）只读 `steps_json` **顶层**的 `keyword`/`url`。计划项**顶层必须写 `keyword` 与 `url`**（机会证据另放 `opportunity` 子对象）；否则同类型所有卡的 key 相同，下一周的新卡会把"顺延一次"的上周卡直接 supersede。**专测**：同类型不同词、跨周，互不 supersede。
   - **14 天自动作废**：`supersedeStaleZhugeCards`（`card-expiry.ts`）的筛选条件加「排除 `steps_json->>'loop'` 非空」，否则 14 天后计划项仍被悄悄作废。
   - **周上限**：`buildCardSuppression` 只数带字符串 `rule_id` 的卡，计划项无 `rule_id` → 不占巡检每周 3 张额度；**专测钉住**「计划项不进 `openedLast7Days`」。
   - **机会别变两张卡**：新机会规则写进 `seo_patrol_findings` 后，`findingsToActions` 会把所有 finding 一视同仁转成旧式日卡。WP-1 验收：`findingsToActions` 对新规则 id 显式排除（白名单只含旧 5 条），**专测**：一个新规则命中只产生计划项、不产生旧式卡。
7. **写入路径（Kernel 架构测试）**：`kernel/boundaries.ts` 的 `EXECUTION_ITEMS_WRITERS_GRANDFATHERED`（15 个历史写入方）**只准变短**，架构测试扫全仓：任何新文件里 `from('execution_items')` 后紧跟 insert/update/delete 都会红。所以：**不新建写 `execution_items` 的文件**；计划项的"新建/置状态/置核验结果"全部作为**新导出函数加进已在名单里的 `zhuge/action-persister.ts`**（若文件将超 800 行则拆出纯函数计算部分、写库仍留在该文件）；或改为提交 Kernel `action_run`。**只要实现里要改 `boundaries.ts` 名单，WP-3 即升 A 级。**
8. **页面互斥（魏征意见，对 meta-cycle 只读）**：计划器派 `strengthen_page`/`consolidate_pages` 之前，读 `seo_meta_log`（近 30 天被周循环改过的页）与 `seo_config.meta_cycle_protected_slugs`，**命中则本周不派该页**并在卡上写原因；本方案**不改**周循环，同窗口两边都动同一页的剩余风险（周循环不读计划项）记入孔子设计稿 §4.4"按页冷却"的 Kernel 批次解决，在此之前靠计划器单向让路。

### 6.4 每日任务拆分（每个工作日一次）
顺序固定：**① 先核验昨天 → ② 再做今天到期的机器活 → ③ 合并人工件 → ④ 写记分牌**。
- 核验：对所有"待核验"计划项跑 `verify`；通过 → `completed` + `execution_logs(kind='note', meta.verified=true, meta.receipt=…)`（`execution_logs.kind` 库里有约束，只允许 `note/status_change/ai_assist/blocker/adjustment`，不新增 `verified` 值；**先写核验日志、写成功才改状态**，日志写失败则不置完成，避免卡片显示完成却无回执）；人已点完成但核验不过 → 卡保持 `in_progress`（不改状态枚举），在 `execution_logs(kind='note', meta.claimed_unverified=true, meta.verify_failure=…)` 记一条，进记分牌与次日合并条目；该标记即 `claimed_unverified` 的唯一持久化落点，只读日志、不新增状态值。
- **拦截人工"完成"（P1 修订）**：现有 `src/app/api/clients/[id]/execution/[itemId]/route.ts:133-137` 会把"完成"直接写成 `status='completed'`+`completed_at`，门户也按它统计。WP-3 必须在该路由对"计划项"（`steps_json.loop` 标记存在者）改为：人点完成 → 状态写 `in_progress`、写一条 `execution_logs(kind='note', meta.claimed_done=true)` 并返回"待核验"，**不写 `completed_at`**；只有上面的核验链路（先日志后状态）才能把计划项置为 `completed`。非计划项行为不变。这样"完成"统计只会数到机器核验过的卡，无需新增状态枚举；门户/统计里"待核验"= `in_progress` 且最新 note 带 `claimed_done`。
- 机器活：`diagnose_page`、`recheck_rank`；再加"草稿生成"（走现有博客引擎，产出 `blog_posts` 草稿并写好 `primary_keyword/keyword_volume/keyword_kd`）。
- 合并人工件：当天所有需要人看的东西合并成**一条**（至多 1 条/天），内容 = 每件事的 **what（问题+影响）/ how（点哪里）/ href（直达）**，类型 `review` 车道。
- 托管：**Inngest**（CLAUDE §3：跨步骤异步 + 外部副作用的默认工作流层）。事件名业务可读：`seo.loop.week_planned` / `seo.loop.item_dispatched` / `seo.loop.item_verified` / `seo.loop.day_closed`；每阶段写机器可读回执（request id、client id、item id、status、provider 花费、`no_publish` 状态、created_at）。**人工点头只推进到下一事件，不等于发布授权**；发布仍走周博客管线现有闸。
  - **回执落点**：`cron_run_logs`（与 `seo-meta-cycle` 同法，任务名 `seo-loop-*`）；记分牌行也写这里。
  - **`dry_run` 语义**：不写 `execution_items`、不调大模型出稿、不发布；计划预览与"本该核验什么"写进回执 summary；DataForSEO/GSC **只读调用可真调**（花费记入预算闸）。
  - **时区**：周一~周五按 `Pacific/Auckland`。**登记**：新增的 Inngest 定时函数必须同步登记 `src/lib/cron/registry.ts`（孔子稿 §4.1 已指出 `seo-meta-cycle` 就漏登过），否则"夜巡没来"检查是瞎的；Inngest 后台要手动 Sync。
  - **付费调用统一预算闸（放公共层，不只缺口词）**：所有 DataForSEO 调用——缺口词、派发当天**现场基线**、`diagnose_page` 抓 SERP 前三、T+14/T+28 复查——**走同一个按客户按周的 SEO 预算账本**。注意：现有 `geo-remeasure/budget-ledger.ts` 是 GEO 月度账本（写 `geo_client_budgets`/`geo_budget_reservations`，UTC 月键，无预算行即拒绝），**不能直接承载 SEO 周额度，也不得混用 GEO 额度**；因此 WP-3 **新建独立 SEO 周预算账本**（新表 + 原子预留/结算 RPC，周键按 ISO 周、预算行缺失 fail-closed，RLS 用 service-role 模板），只借鉴 GEO 账本的原子扣账写法；超限 → 当项记"没测成（预算）"，不偷偷降级。**单价首轮试跑实测后写进台账，本稿不估。**
  - **GSC 数据滞后**：所有 GSC 取数跳过最近 3 天；核验窗口与基线窗口同口径。

### 6.5 记分牌（每天一行，PM 不用点开也能看见"有没有在转"）
`计划 N / 机器核验完成 A / 自称完成未核验 B / 没测成 E / 判不了（数据不全）F / 在途 C / 本周过期放弃 D / 已处置但不采纳 G / 今日合并条目 0|1 / 整站点击 28 天 X（周环比，仅趋势不归因）`。"没测成""判不了"各占一列，**不与"在途"混**（子牙 §4b 第 8 条）。
- **三条自动警报**（由**独立的 `pm-daily-todo` 体检**读，不靠本链自己报告，见 §3 第 4 行）：①连续 5 个工作日"核验完成=0 且在途>0"；②"自称完成未核验"占比 >30%；③记分牌昨天缺行 / 核验器没跑。**任一条持续 7 天无人处理 → 升 1 条 `decide`。**
- 熔断：复用孔子设计稿 §4.4（一周内 ≥2 页复查判"变差"→ 该客户该支柱回观察，PM 点才恢复）——本阶段只**记录与提示**，不接自动停机。

### 6.6 验收口径（写死，防"邀功"）
| 能说 | 不能说 |
|---|---|
| 这件事真做了（页面线上 / 链接存在 / 文章 200 / 收录状态 X） | "这件事带来了 Y 次点击" |
| 目标词排名移动 ≥3 名（基线在派发当时记录；三态：没测成 ≠ 没变 ≠ 变了） | 页级点击率前后对比下结论（41% 假动静率，手册 §十四） |
| 整站 28 天点击周环比 / 目标进度 | 整站涨跌 = 某动作功劳 |
| 本周计划/核验/过期数 | 经验库"有效/失败"计数（手册 §七，当噪音；本阶段**不**把结论喂进记忆，等 `classifyActionCase` 通得过再议） |

---

## 7. C：让卡真的被做掉的路径（对外与授权）

| 类别 | 现状 | 本方案 | 谁点头 | 受什么约束 |
|---|---|---|---|---|
| 机器自做（查/诊断/复查） | 无 | 新小执行器（只读外部，写自家表） | 无需 | 只读；DataForSEO 花费进预算闸；缺数据本轮不动 |
| 机器出稿 → 人点头 → 发布 | 周博客管线存在，但与机会脱节、14/16 篇无关键词、10/16 被拒且**不记拒绝原因** | 草稿带关键词证据；**拒稿必须记原因**（WP-6）；发布仍走现有授权（Ray 授权事件 + provider 回执） | PM/FDE（`review`） | CLAUDE §8：对外内容先 grounding 官网；每周每客户 ≤1 篇（手册 §四）；竞品品牌词/事实无法溯源的直接拦 |
| 结构性改动（内链/合并/规范网址） | 无通道 | 只出方案，人做，核验重抓 | PM/FDE | 手册 §四、§八；动站点结构一律人点头；第 1 阶段不做自动写入 |
| 改标题/描述 | meta-cycle 自有闸 | **不碰** | 其自有闸 | 保护名单不变 |
| 将来自动写站 | — | 走孔子设计稿 §4.1：`seo.rewrite_meta` / `seo.open_content_fix_pr` 经 Kernel，客户逐个授权 `bounded` | PM 逐客户 | 另案 A 级 |

CLAUDE §3「能自动就别丢给人；真丢给人，就把话说到他不用问第二遍」：人工件三件套 what/how/href 是**验收项**，不是文案建议。

---

## 8. 工作包（WP）

打分格式按 ENGINEERING_QUALITY_GATES §11：**频率 X / IMPACT Y / 收入 Z → P几**。IMPACT 段位按闭环关键度：卡在 Act 或给错信号 = 高。

| WP | 内容 | IMPACT 段 | 风险 | §11 打分 | 迁移 |
|---|---|---|---|---|---|
| **WP-0 清场 + 立目标** | 归档 CTS 过期 16 条计划项；25 张僵尸 pending 卡置 `skipped`，原因 `legacy_cleanup` 写入 `execution_logs(kind='status_change', meta.reason)` 并同步 `steps_json.skip_reason`（`execution_items` 无 `reason` 列，PATCH 也不收该字段；WP-0/3/周报统一读这两处）；PM 拍定后建并激活 SEO 目标；输出"清了什么/怎么恢复"清单 | Prescribe（目标） | **A 级流程**（改生产数据：PM 在对话里回「合」才动；非代码 PR） | 频率 低 / IMPACT 高 / 收入 中 → **P2**（但它是 WP-3/4 的**前置**，排最前） | 否 |
| **WP-1 发现规则重做**（其中 1a「近机会词」是 WP-3/4 的前置，**随 P0 链同批提级**） | 新规则 `near_miss_keyword`、`ctr_gap_page`；`not_indexed` 按谷歌原因分类并降级；`keyword_opportunity` 输入改为"机会池"；R1 判据重定义；机会证据快照抄进计划项；`findingsToActions` 显式排除新规则（专测：只产计划项不产旧卡） | Inspect | **A（含迁移）** | 频率 高 / IMPACT 中 / 收入 中 → **P2**（1a 因前置关系与 WP-3/4 同批做） | **是**：①`ALTER TYPE seo_patrol_rule ADD VALUE` 加 4 个新值（`near_miss_keyword`/`ctr_gap_page`/`keyword_gap`/`cannibalization`，WP-2 的两个也在此一次加完）；②`seo_patrol_findings` 加可空 `priority`、`priority_reason`；③TS 联合类型同步。迁移单独 A 级 PR，走子牙+魏征+狄仁杰 |
| **WP-3 周计划器 + 每日派发器**（含 3a 新目标指标 `seo_gsc_clicks_28d`、公共预算闸、旧机制隔离 §6.3-6~8） | §6.3、§6.4；Inngest 函数 + 回执 + 登记 `cron/registry.ts`；写库只经 `action-persister.ts` 新增导出函数 | Prescribe → Act | **A（新增预算账本表 + RPC 属迁移且涉及资金上限；另若改 `kernel/boundaries.ts` 名单或碰发布/Kernel 注册表同样 A）**，迁移单独 A 级 PR，走子牙+魏征+狄仁杰 | 频率 高 / IMPACT 高（卡 Act，闭环断在这）/ 收入 中 → **P0** | **是**：独立 SEO 周预算账本（表 + 原子预留/结算 RPC） |
| **WP-4 每日核验器 + 记分牌 + 独立体检** | §6.5、§3；核验器四态；`pm-daily-todo` 里加独立体检（缺行/没跑→开发欠账，7 天→`decide`）；只读重抓封装；与 WP-3 **同批上线** | Check | B | 频率 高 / IMPACT 高（没有它整条链是假的）/ 收入 中 → **P0** | 否 |
| **WP-5 PM 可见面** | 今日待办新增 1 个 `review` 车道 kind（≤1 条/天）；周报新增"SEO 记分牌 + 放弃清单（带 what/how/href 与一键恢复）"；不改五类规则；查 `pm-todo` 其他 `source='zhuge'` 过滤不误收计划项 | Check→Tune（可见） | B（动 `five-kinds.ts` 穷举表） | 频率 高 / IMPACT 中 / 收入 低 → **P2** | 否 |
| **WP-2 缺口词与自相残杀体检** | `keyword_gap`、`cannibalization` 接机会池；`seo-agent` 评分接每周；预算闸；竞品名单走客户配置 | Inspect | **A**（真实消耗供应商预算：须验证所有调用都经预算闸、重复执行不重复扣额、超限 fail-closed；走子牙+魏征+狄仁杰） | 频率 中 / IMPACT 中 / 收入 中 → **P2** | 否（枚举值与 `priority` 列已由 WP-1 迁移提供，WP-2 依赖 WP-1） |
| **WP-6 周博客对齐机会** | 草稿必带 `primary_keyword/keyword_volume/keyword_kd`（现有列名）；**拒稿必须记原因**（新增一个可空列属迁移，需先确认，若加列则单独 A 级迁移 PR）；竞品品牌词拦截 | Act | B（加列则迁移 A） | 频率 中 / IMPACT 中 / 收入 中 → **P2** | **可能**（`blog_posts` 加 `rejection_reason`，需开工时核实现有字段，不在本稿定） |
| **WP-7 泛化** | 第二客户（Oztop 目前暂停，另有其他客户视 PM 优先级） | — | — | 频率 低 / IMPACT 中 / 收入 中 → **P2**（等 CTS 跑稳 4~6 周再评） | 视客户 |

**顺序**：WP-0 → （WP-1a 近机会词 + WP-3 + WP-4 同批）→ WP-5 → WP-2 → WP-6 → WP-7。
**同一写入者**：每个 WP 一个写入窗口，WP-3/4 共用同一写入者（同改派发与核验的数据约定）；`five-kinds.ts`、`render.yaml`/注册表的改动不与别的窗口并行。

### 8.1 每个 WP 的"当场试跑"（CLAUDE §3 / AI 协作流程）
- **WP-0**：不是定时任务；执行前输出 id 清单，执行后回读比对；回滚清单随 PR/台账附上。
- **WP-1**：对 CTS 现有快照**离线跑规则**（只读），把命中的词表贴进 PR，PM 抽看 10 个是否像人话；不外发。
- **WP-3/4（Inngest）**：手动触发一次**完整一周链路**——`week_planned → item_dispatched → item_verified → day_closed`，**`dry_run`**（语义见 §6.4：不写计划项、不调大模型、不发布）+ 真实只读取数（GSC/URL Inspection 真调，DataForSEO 只读小量真调并记花费）。PR 写「## 当场试跑」：触发方式、时间、运行状态、规划几项、核验几项、写了哪些回执。**Inngest 后台需手动 Sync 一次**。没跑通 = 不能说"做好了"。
  - **当场测不了的部分要老实写**：T+14/T+28 复查要等两周，**不能写成"当场试跑通过"**——用**时间拨快的测试数据**验证复查/四态/降级/警报升级的逻辑，并开台账卡 `verify_by`=首批计划项 T+14 当天，`verify_how` 写明查什么。
  - **`draft_post` 的真实/替身边界**：当场试跑用**替身草稿**走完"出稿→待审→核验"；真实大模型出稿只在 WP-6 做**不超过 1 篇**、花费记台账；"线上 200"核验在试跑中对**一个已发布的真实网址**做，不为试跑真发布。
- **WP-5**：本地预览待办渲染 + 周报渲染各一次，贴截图/文本。
- **WP-2**：带预算闸跑**一轮真实小规模**（上限内），记录实际花费进台账，再决定每周上限。
- 首次自动运行当天另开台账卡 `verify_by`（记分牌三条警报是否在响）。

### 8.2 Reuse Statement（设计阶段）
- **复用**：`goals`/`initiatives`/`execution_items`/`execution_logs`、`seo_patrol_findings`、`keyword_snapshots`、`gsc_page_daily`、`getKeywordsGap`/`getKeywordIdeas`/`getRankedKeywords`、`seo-agent` 评分与排序、URL Inspection 采集、周博客管线、`pm-todo` 五类框架、台账、Inngest、孔子设计稿 §4.1/§4.4 的熔断与"数据不全本轮不动"。
- **真正 platform-shared 新增**：机会规则（与客户无关的判据）、周计划器/每日派发器/核验器、记分牌、一个目标指标。
- **industry-specific**：行业词表/受众语言/品牌词模式进 Playbook（本方案不写任何行业硬编码）。
- **client-specific（L4）**：CTS 的目标值、保护名单（已有）、竞品名单、预算上限、品牌别名——全部走 `goals` / `clients.seo_config` / 配置，**共享代码里无 CTS 名字或 ID**。
- **换客户测试**：换成 Oztop（行业不同、站是 WordPress 且改站通道暂停）——计划器/核验器不需要改；`strengthen_page` 的核验靠"重新抓取页面"与站点技术无关；Oztop 的"自动写站"本来就不在本方案。换成悉尼地产客户——机会判据（量/难度/排名/曝光）无行业语义；**需要改的**只有客户配置（品牌词、竞品、目标）。**换行业测试**：地产里"近机会词"多是本地长尾，量更小——阈值（月搜 ≥100、曝光 ≥300）要作为**客户/行业配置**，不是写死常量（实现时必须参数化并有 Playbook 默认）。
- **决策与落点一致性**：设计时分类 = L1 扩展 + L4 配置；实现落点需交付时再对账。

### 8.2b 配置契约（所有阈值都不是写死常量）
默认值放 SEO Playbook（行业层默认），客户覆盖放 `clients.seo_config.loop.*`（**缺省即用默认；给 CTS 写覆盖值属于另一次 PM 点头的生产写，本方案不碰 `seo_config`**）：

| 键 | 默认 | 含义 |
|---|---|---|
| `loop.near_miss_min_volume` / `loop.near_miss_rank_range` | 100 / 4–30 | 近机会词门槛 |
| `loop.ctr_gap_min_impressions` / `loop.ctr_gap_ratio` | 300 / 0.6 | 页级点击率偏低门槛 |
| `loop.weekly_max_items` / `loop.weekly_max_human_items` | 5 / 2 | 每周计划上限、人点头上限 |
| `loop.wip_cap` | 8 | 在途上限 |
| `loop.abandon_degrade_rate` | 0.5（连续 2 周） | 放弃率降级阈值 |
| `loop.weekly_budget_usd` | 2 | 每客户每周 DataForSEO 合计预算 |
| （不新增）竞品名单 / 品牌别名 | — | **直接复用 `clients.competitor_domains` 与 `clients.brand_aliases`**（权威来源，已有读写 API/解析器，CTS 品牌别名已写入）；空则该机会类型停产并记"没测成（缺竞品）"，**不自己兜底选竞品** |

### 8.3 不做什么（本版明确排除）
广告 / 社媒 / GEO；改标题验收与 `seo-meta/cycle/`、`clients.seo_config`（只**读**）、PR #2217；自动写客户网站（含内链、canonical、合并页）；"请求谷歌收录"；新建落地页；把执行结论写进经验记忆；SEO Campaign 新类型；除 WP-3 的独立 SEO 周预算账本（及 WP-1 的枚举/列迁移）外不新建表；第二个客户上线；对 Oztop 的任何动作；承诺"SEO 动作带来了流量"。

### 8.4 仍需 PM 决定的（只列业务口径，一次一个）
1. ~~CTS 28 天点击量目标~~ —— **PM 2026-10-04 在对话里选「进取」：28 天点击 1,340（基线约 1,070，+25%），周期 2026-10-05～2027-01-03。** 仅为口径决定；建目标（WP-0）尚未执行，基线需按 §6.1 同一取数函数重算后再写入。注意稿内已说明：该档偏紧、不是预测。
2. （之后再问）缺口词每周数据费上限（默认 US$2）。
3. （之后再问）WP-0 清场授权——届时会给清单。

---

## 附录 A：设计复审意见与采纳/驳回

两个不同 agent 各审一轮（设计阶段）。全部"必改/致命/严重"均已采纳并落进正文；驳回项附理由。

### A.1 子牙（架构）

| 意见 | 处理 | 落点 |
|---|---|---|
| 必改 1：新写 `execution_items` 的文件会被 Kernel 架构测试拦；只能加进已在名单的文件，或走 `action_run`；改名单即 A 级 | **采纳** | §6.3-7、WP-3 风险级条件式 |
| 必改 2：`source='zhuge'` 的去重键只读顶层 `keyword/url`，计划项会互相 supersede | **采纳** | §6.3-6、§3 第 7 行（顶层必写 + 专测） |
| 必改 3：新规则会被旧巡检再转成旧式卡 | **采纳** | §6.3-6、WP-1 验收 |
| 必改 4：14 天作废/周上限改法要写成具体条件 | **采纳** | §6.3-6 |
| 必改 5：付费调用只有缺口词有预算闸 | **采纳**（与魏征 g 合并） | §6.4 公共预算闸 |
| 必改 6：§4b 第 8/9 条（判不了单独一列；Inngest 函数登记 `cron/registry.ts`） | **采纳** | §6.5、§6.4 |
| 建议 1：WP-3 风险级条件式写明 | **采纳** | WP-3 行 |
| 建议 2：新指标可行，需钉口径、基线同函数重算、选定 `recommended_for` | **采纳** | §6.1 |
| 建议 3：承认 `source='zhuge'` 语义偏差，查 pm-todo 误收 | **采纳** | §6.3-6、WP-5 |
| 建议 4：WP-1a 随 P0 链提级 | **采纳** | WP-1 行 |
| 建议 5：补配置契约 | **采纳** | §8.2b |
| 建议 6：回执落点、`dry_run` 语义、时区 | **采纳** | §6.4 |
| 可接受：复用既有表（goals/initiatives/execution_items/seo_patrol_findings）；注：原稿"免迁移"一说有误，已由评审机器人更正（`seo_patrol_rule` 是枚举、预算账本需新表），WP-1/WP-3 已升 A、§11 打分逐行核对无误、Reuse 声明属实、不碰 seo-meta | 确认 | — |

### A.2 魏征（挑刺：会不会又变成"看起来闭环通了其实没通"）

结论：**修改前**断点 1/2/3/5/7 有硬对应物，断点 4/6 仍软，另有 2 个致命缺口。修改后逐条回应：

| 意见 | 级别 | 处理 | 落点 |
|---|---|---|---|
| `recheck_rank` 基线用周快照不可靠（滞后 7 天、只存有排名的词）；查不到分不清"掉出"与"没测成" | 致命 | **采纳**：派发当天现场基线；单列"超出查询深度" | §6.2 |
| 三条警报只进周报，靠同链自报，会死在日志里 | 致命 | **采纳**：独立 `pm-daily-todo` 体检 → 开发欠账；7 天无人处理升 `decide` | §3 第 4 行、§6.5、WP-4 |
| `diagnose_page` 核验是"自己写自己验" | 严重 | **采纳**：四个产物字段齐全才算 | §6.2 |
| `consolidate_pages` "不采纳也算处置完毕" 与"只数已核验完成"矛盾 | 严重 | **采纳**：`decided_no`，不进完成计数 | §6.2、§6.5 |
| 点不动时退路仍是"悄悄作废"；在途上限会卡死 | 严重 | **采纳**：放弃清单带 what/how/href+一键恢复；放弃率>50% 连续 2 周自动降级并知会 PM | §3 第 5 行 |
| §6.1 的 "+230/月""理论天花板"是自己估的，推荐目标不应依赖 | 严重 | **采纳**：删 "+230/月"，天花板标"未经验证的算术、仅示池子规模"，目标推荐只凭历史并明说属判断题 | §6.1 |
| 14 天曝光 2.4 万 vs 周值对不上；三个卡片数没对账 | 严重/一般 | **采纳**：加脚注说明窗口不同 | §0、§1.1 脚注 |
| T+14/T+28 复查当场跑不了；`draft_post` 真调大模型花钱 | 严重 | **采纳**：时间拨快测试 + `verify_by` 台账卡；草稿用替身，真调≤1 篇且记花费 | §8.1 |
| 预算只覆盖缺口词；meta-cycle 与计划项同页冲突 | 严重 | **采纳**（预算）；**部分采纳**（互斥：计划器单向让路，不改周循环，残余风险写明并挂到 Kernel 批次） | §6.4、§6.3-8 |
| `link_present` 需只读重抓封装；被拦算没测成 | 一般 | **采纳** | §6.2 |
| GSC 2~3 天滞后 | 一般 | **采纳** | §6.1、§6.4 |
| 拒稿原因无字段 | 一般 | **已纳入 WP-6**（可能是迁移，开工时核实） | WP-6 |
| 229 vs 817 口径差别未核实 | 一般 | **部分采纳**：改称"同一取数函数、取数日不同"，不再说"同口径"断言之外的东西；是否完全同公式留给 WP-3a 重算基线时核对 | §1.1 #3 |
| "复审"措辞但附录空 | 一般 | **采纳**（本附录即补） | 头部 |

### A.3 驳回项
**本轮无整条驳回。** 唯一部分采纳是魏征"同页互斥"：要求把计划项与 meta-cycle 双向互斥，但 `seo-meta/cycle/` 在本任务"别碰"名单上且刚验收结案，所以只做计划器单向让路；双向互斥属孔子设计稿 §4.4（Kernel 按页冷却）的范围，不在本方案内。

### A.4 复审者没覆盖、留给实现窗口的
- `gsc_page_daily` 求和函数是否需分页读（PostgREST 单次 1000 行上限，参照 `card-expiry`/`job.ts` 的 CARD_READ_LIMIT 做法"满页即报错"）。
- 只读重抓封装复用 `site-audit/crawler` 还是新写，需先查现有可用性（反爬脏数据见手册 §三）。
- 第二轮复审：A 级升级（若触碰 `boundaries.ts`）须重新走子牙+魏征+狄仁杰。
