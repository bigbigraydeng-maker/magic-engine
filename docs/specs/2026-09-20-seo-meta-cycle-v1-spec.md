# SEO Meta-Cycle v1 — 周循环 IMPACT 闭环设计

**Status**: Draft v2（精简版）— 待子牙（架构）+ 魏征（挑刺）复审
**Date**: 2026-09-20（v1 设计）→ 2026-09-20 当天 PM 精简拍板（v2，见 §11）
**Owner**: CTS 总项目经理窗口（claude/cts-project-manager-build-control-e4c4b1）
**PM 决策来源**: 2026-09-20 对话 — 全部新流程硬性要求接 Inngest；不满足于「盲改标题」，要求接入 DataForSEO + 竞争对手数据
**PM 精简拍板（同日）**：第一轮实现 + 子牙/魏征两轮复审后，PM 认定原设计对「每周最多改 3 个页面、只服务 CTS 一个客户」的实际用量过度开发——两轮复审抓到的严重 bug 都出在「自动检查 + 自动改回去」这套机器本身，不是外围保险不够，而是核心机制太复杂。**§4/§7 已改为精简版，原版见文末 §11 存档对比。**

## 1. 问题

现有 `cts-seo-optimizer`（`src/app/api/cron/cts-seo-optimizer/route.ts` → `src/lib/seo-meta/cts-meta-pr.ts`）每周一跑一次：

1. 读 GSC 排名 4-20、曝光 ≥10 的页面
2. AI（Haiku）只凭关键词写新标题/摘要
3. 改 CTS 网站仓库的 meta 数据文件，开 PR，（2026-09-20 起）自动合并

**这是 IMPACT 六段里只做了 Prescribe（不完整）+ Act，完全没有 Inspect（市场/对手情报）、没有 Measure 基线对照、没有 Check（改完有没有变好）、没有 Tune（学习喂回下一轮）。**

同时，代码审计发现仓库里已有 6 个 SEO 相关模块（`seo-patrol` 每日巡逻、`seo-intelligence` 周排名快照、`competitors` 解析器、`seo-agent` 机会规划器、`seo/post-publish-monitor` 回查模板、`memory` 学习记忆表）都是通用、跨客户可复用的，但周一执行手完全没接它们——**是复用问题，不是缺能力问题**。

## 2. 目标

把周一执行手从「孤立盲改标题的脚本」升级成「读全套已有情报、按处方分级执行、事后回查、结果喂回学习」的完整 IMPACT 闭环，且**全程 Inngest 步骤化监控**（PM 2026-09-20 硬性要求）。

## 3. 复用清单（Reuse First）

| 环节 | 复用模块 | 函数 |
|---|---|---|
| 候选发现 | `src/lib/seo-patrol` | `runSeoPatrolForClient`, `assembleSeoPatrolInput` |
| 排名/难度/搜索量 | `src/lib/seo-intelligence/keyword-snapshots.ts` | `getLatestKeywordSnapshotForClient` |
| 对手数据 | `src/lib/competitors/resolver.ts` + `src/lib/dataforseo/serp.ts` | `getClientCompetitors`, `getSerpPage` |
| 处方分级 | `src/lib/seo-agent/scorer.ts` | `deriveActionType`, `deriveExecutionPath` |
| 回查模板 | `src/lib/seo/post-publish-monitor.ts` | `buildCheckEvents`, `classifyReceipt`（**新增引用**，非直接复用——原函数是页面上线场景，本设计新增一个 meta 变更场景的姊妹函数，输入输出形状对齐但触发条件不同） |
| 学习记忆 | `src/lib/memory/service.ts` | `saveProvenPattern`, `saveFailedExperiment`, `loadMemoryForClient` |
| Inngest 编排模板 | `src/lib/inngest/functions/flywheel-seo-weekly.ts` | fan-out + per-client worker + `step.run`/`step.sendEvent` 模式参考 |

**新增的（无法复用）**：
- 执行手本身的候选合并逻辑（把 patrol + snapshot + gap 三路候选去重合并打分）
- `seo_meta_log` 表加列（改前 CTR/排名/曝光，供 14 天后对比）
- Inngest 函数文件 `src/lib/inngest/functions/seo-meta-cycle.ts`

## 4. 六步 Inngest 链路（v2 精简版，PM 2026-09-20 拍板 · 原版见 §11）

```
cron (Monday 05:30 UTC)
  │
  ▼
[1] seo/meta-cycle.check_due
    回查上周改动：读 seo_meta_log 里 14 天前的改动 → 重新查 GSC CTR/position
    → 判定 improved / flat / regressed / insufficient_data
    → 写回 outcome + observed_ctr/observed_impressions
    → regressed 的页面：下发 1 条人工看板任务，链接指向当初那条已合并的 PR
      （人点 GitHub 上的 Revert 按钮、再合并 revert PR 即可改回去——零新代码）
  │
  ▼
[2] seo/meta-cycle.candidates_ready
    合并两路候选（patrol 发现 + GSC 4-20 名），字段级去重合并（同一页面多来源
    命中时，identity 取高优先级来源，但 impressions/ctr/搜索量/难度按字段各自
    补全，不因为撞上高优先级来源就整体丢弃）
    排除冷却期内的 slug
    搜索量/难度直接读 keyword_snapshots（每周快照已付过钱，零新增 DataForSEO 调用）
  │
  ▼
[3] seo/meta-cycle.prescribed（纯函数，无 I/O）
    难度 > 70 → skip，记录原因，不占改动名额
    其余 → title_rewrite，按 impressions/搜索量排序取前 ≤ maxPagesPerRun 个
    （超出上限的候选本轮直接不选，下周再评估——不占用人工看板名额）
  │
  ▼
[4] seo/meta-cycle.applied
    对最终选中的 ≤ maxPagesPerRun 个候选，各调一次 DataForSEO SERP 取前 3
    竞品标题（花费结构上就封顶，不需要跨客户熔断）
    AI 生成 meta（关键词+搜索量+难度+当前排名/CTR+对手前3标题作为 prompt 输入）
    → 改仓库文件 → PR → 自动合并（复用现有 mergePullRequest）
    → 合并成功：写 seo_meta_log（含改前基线 + PR 链接）
    → 合并失败：下发人工看板任务，链接指向这条未合并的 PR
    → AI 生成失败：下发人工看板任务
  │
  ▼
[5] seo/meta-cycle.logged
    step 4 写入 seo_meta_log 的汇总回执（实际写入动作已在 step 4 内完成，
    因为需要 apply 调用返回的确切标题/描述）
  │
  ▼
[6] seo/meta-cycle.completed
    汇总回执写 cron_run_logs
```

事件命名沿用仓库现有斜杠风格（如 `seo/page-watch.check_due`）。

## 5. 数据变更

`seo_meta_log` 加列（migration，新增不改旧列，向后兼容）：
```sql
ALTER TABLE seo_meta_log
  ADD COLUMN IF NOT EXISTS baseline_ctr NUMERIC,
  ADD COLUMN IF NOT EXISTS baseline_position NUMERIC,
  ADD COLUMN IF NOT EXISTS baseline_impressions INTEGER,
  ADD COLUMN IF NOT EXISTS checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS outcome TEXT CHECK (outcome IN ('improved','flat','regressed','insufficient_data')),
  ADD COLUMN IF NOT EXISTS observed_ctr NUMERIC,
  ADD COLUMN IF NOT EXISTS observed_impressions INTEGER,
  ADD COLUMN IF NOT EXISTS pr_url TEXT;
```
（v2 新增 `observed_ctr`/`observed_impressions`——供周报展示改前改后对比；`pr_url`——regressed 人工任务的直达链接。v1 设计里的 `revert_count` 列不再需要，见 §11。）

## 6. 客户配置 vs 共享代码（层级门判定，见 §8）

现状代码里硬编码在共享目录的、必须挪进 `clients.seo_config` 的：
- `CTS_CLIENT_ID` 常量 → 改为遍历 `client_status='active' AND seo_config->>'meta_cycle_enabled' = 'true'` 的客户（对齐 `seo-patrol` 已有的批量遍历模式）
- repo 路径、`DATA_DIR`、meta 文件落地格式 → 客户配置
- 「NZ China-travel voice」品牌语气句 → 客户配置里的 `brand_voice` 字段
- `MAX_PAGES_PER_RUN=3`、`COOLDOWN_DAYS=30` → 客户配置可覆盖的默认值

Oztop 现有的独立实现（`oztop-seo-optimizer/route.ts` 内联逻辑）在本次不合并，**记为后续候选**：先让 CTS 这条新链路跑穣，验证一个月后再把 Oztop 切过来复用同一条 Inngest 链路（避免同时动两个客户的生产链路）。

## 7. 自动 vs 人工边界（v2 精简版）

| 动作类型 | 自动执行 | 理由 |
|---|---|---|
| 改标题/摘要（title_rewrite） | ✅ | 可逆、范围小、14 天有回查兜底 |
| 难度过高（skip） | 不算动作 | 记录原因，不占改动名额 |
| 回归后改回去 | ❌ 进看板，**不是自动** | v1 设计里这一步是自动的；PM 2026-09-20 拍板改为人工——链接直达当初那条已合并的 PR，人点 GitHub 自带的 Revert 按钮、合并 revert PR 即可，零新代码。理由见 §11：两轮复审抓到的严重 bug 都出在这台"自动改回去"机器本身 |
| 索引申请 / 内容重写 / 新建页面 / 加内链 | 不在本设计范围 | v1 设计里这些是 title_rewrite 之外的独立分支；v2 全部砍掉——索引由合并后的 webhook 负责（issue #1794），其余三类 seo-patrol 本就会送进诸葛亮看板，这条链路再送一遍是重复待办，见 §11 |

## 8. Platform Tier 判定（me-platform-tier-gate · Full）

**被判定对象**：SEO Meta-Cycle 周循环编排（发现→处方→执行→回查→学习）

**建议层级**：
- 编排逻辑本身（六步链路、回查判定、学习读写）= **L1**，归属 SEO 支柱
- CTS 改代码仓 / Oztop 未来改 WordPress 的落地方式 = **L3 Connector**（挂在 L1 下的 adapter）
- repo 路径、品牌语气句、默认页数/冷却天数 = **L4 Client Configuration**

**换客户测试**：✓ — CTS 用代码仓落地、Oztop 用 WordPress 落地，编排逻辑（发现候选→打分→处方→执行→回查→学习）不因客户而变；变的只是第 4 步"执行"的落地适配器和 L4 配置里的品牌语气、页面上限。

**换行业测试**：✓ — 用地产客户（Roman）推演：GSC 4-20 名候选发现、DataForSEO 富化、对手 SERP 抓取、自动改标题、14 天回查、学习记忆，六步没有一条只对旅游行业成立。唯一行业相关的是 prompt 里"NZ China-travel voice"这句，已在 §6 明确挪进 L4。

**智能层 or 执行手**：智能层 — 本设计的核心价值是"发现+处方+学习"的决策质量，"执行"只是最后一步动作，且大部分执行动作（内容重写/建页/加内链）明确留给人工。

**红线检查**：
- 红线 1（禁包装升级）：✓ 未新设支柱，明确归入既有 SEO 支柱
- 红线 2（禁客户/行业事实进 shared runtime）：✓ §6 已列出全部需要下沉到 L4 的硬编码项，本设计要求实现时一并挪走
- 红线 3（禁直建 L1）：不适用 — 本能力并非"单客户提出、直接建 L1"，而是把**已经跨客户复用**的 6 个既有模块（patrol/intelligence/competitors/seo-agent/memory 均已是 client-generic）重新编排成一条链路，属于整合既有 L1 能力，不是新建
- 红线 4（换客户测试语义级）：✓ 见上
- 红线 5（换行业测试语义级）：✓ 见上
- 红线 6（若 L1，走五道 Build Gate）：待走 — 本 spec 是 Architecture/Reuse Gate 的输入，子牙+魏征复审通过后按 §9 走剩余 Gate
- 红线 7（L2 只装行业级判断）：不适用，本设计不产生新 L2

**PM 待拍板项**：无（不涉及新支柱/新版本/定价/抽佣）

**结论**：判定 L1（编排）+ L3（落地适配器）+ L4（客户配置），与最初对话中的设计方向一致，无需改口。不登记 `platform-candidates.md`（不是"候选"，是既有 L1 能力的整合与补全）。

## 9. 下一步

1. 子牙（架构）+ 魏征（挑刺）复审本 spec（大任务门槛：跨 3+ 文件、改共享 `src/lib/`、影响已上线功能）
2. 复审通过后开工单，按 IMPACT 六段拆成可独立验证的子任务
3. 实现顺序建议：先接 §5 数据库迁移（A 级，独立可测）→ 再接 Inngest 六步骨架（用 stub 数据跑通事件链）→ 最后替换 stub 为真实模块调用
4. CTS 验证一个月无回归后，评估 Oztop 切入（§6 已记）

## 10. Reuse Statement

- **复用了什么已有平台能力**：`seo-patrol`、`seo-intelligence`（排名快照+DataForSEO）、`competitors` 解析器、`seo-agent` 打分器、`memory` 学习表、`post-publish-monitor` 的 Inngest 编排模式、现有 `mergePullRequest`（2026-09-19 新增）。
- **新增内容哪些是 platform-shared**：六步 Inngest 编排逻辑、候选合并去重算法、`seo_meta_log` 新增的 outcome 判定逻辑。
- **哪些是 industry-specific**：无新增 L2（本次未新建行业剧本）。
- **哪些是 client-specific**：repo 路径、品牌语气句、页面上限/冷却天数、Oztop 的 WordPress 落地适配器（未来接入时新增）。
- **有没有把客户名/客户 ID/行业判断写进 shared runtime**：现状代码有（`CTS_CLIENT_ID` 硬编码），本设计要求实现时挪走，§6 已列清单，作为实现验收项。
- **哪些学习仍只在 client-private memory，哪些有证据升级到 industry/global memory**：v2 不再写 memory（见 §11，推迟）。

## 11. PM 2026-09-20 精简拍板（v1 → v2）

**为什么**：v1 设计实现完 + 走完两轮子牙/魏征复审后，PM 复盘发现——实际用量是每周最多改 3 个页面、只有 CTS 一个客户在用（Oztop 走 WordPress，现在接不上这条链路）。而 v1 的 2900 行代码里有一大块是为"多客户、大量改动"场景预先准备的保险（跨客户花费熔断、连续回归的振荡保护、孤儿 PR 清理），**两轮复审揪出的两个严重 bug 全部出在"自动检查效果 + 自动改回去"这套机器本身**，不是外围保险不够严密，而是核心机制的复杂度本身就是 bug 的温床。PM 判断：先把核心机制做简单、做对，比给一个复杂机制不断加保险更划算。

**保留的（v1 → v2 不变）**：
- Inngest 两函数结构（fan-out + per-client worker）+ 每一步写回执——PM 硬性要求，未动
- `seo_meta_log` 记录改前基线 + `applied_channel` 字段（连带历史数据回填）——这是修一个真实存在的误报 bug，保留
- 14 天后回查效果、判定结果写回 `outcome`，且出现在每周报告里
- PR 自动合并；合并失败 → 进人工看板，附 PR 链接（不是新代码，是把已实现的 `pr_opened_but_not_merged` 路径保留下来）
- 客户配置来自 `seo_config`，不写死客户身份进共享代码（平台化规则，硬约束）

**砍掉/推迟的（v1 → v2 变化，连带原因）**：
| 项目 | v1 怎么做 | v2 怎么做 | 为什么 |
|---|---|---|---|
| 回归后改回去 | 自动重新提交改回原文的 PR，带"人已手改就跳过"的比对逻辑 | 判定 regressed → 1 条人工看板任务，链接指向已合并的原 PR，人点 GitHub 自带 Revert 按钮 | 两轮复审的两个严重 bug（`baseline_ctr` 从未写入导致回查永远判不出结果、PR 未合并却被当成已生效）都发生在这条自动回滚链路上或紧邻它。GitHub 原生 Revert 按钮零新代码、零新 bug 面 |
| 振荡保护（`oscillation.ts`） | 连续回归 2 次强制转人工 | 删除整个文件 | 没有自动改回去，就不存在"改了又回归又改"的振荡 |
| 跨客户花费熔断（`budget-guard.ts`） | 每周全局 DataForSEO 调用上限 + 各客户抢配额 | 删除整个文件，改成结构性封顶：搜索量/难度不再调 DataForSEO（读 `keyword_snapshots` 现成快照），SERP 只对最终选中的 ≤ 3 个页面各查一次 | 原设计的熔断是为了防"候选池很大 × 很多客户"时失控超支；把候选池收窄到"只对最终会真正执行的页面才花钱"之后，单客户单周花费天然是个位数常数，熔断变得没有对象可管 |
| 孤儿 PR 分页清理 | 列出 repo 里所有开着的 PR，找出上周遗留的同名分支，关掉 | 删除，只留"同一 (周, slug) 已有 PR 就复用"这一层幂等闸 | 每周 ≤3 个 PR，不会真的堆积；这段代码此前也没有真实 bug 压力支撑，纯粹是为假设中的高频场景预写的 |
| 动作类型 | 6 种（title_rewrite/index_request/content_refresh/new_page/internal_link/skip） | 2 种（title_rewrite/skip） | 4 种被砍的动作类型里，3 种（content_refresh/new_page/internal_link）本来就会被 seo-patrol 发现、送进诸葛亮看板——这条链路再送一遍是重复待办；index_request 由合并后的 webhook 负责（issue #1794），不需要这里再做一次 |
| memory 学习写入/读取 | `saveProvenPattern`/`saveFailedExperiment` 写、`loadMemoryForClient` 读进 AI prompt | 推迟，不写不读 | 每周 3 个页面的样本量，几周内学不出统计意义上站得住的模式，写进去的更可能是噪音而不是信号 |

**什么条件下再加回来**：
- 第二个客户接入这条链路（Oztop 或其他），且该客户单周候选量明显超过个位数 → 重新评估跨客户熔断
- 单客户单周实际改动量稳定超过 ~10 页 → 重新评估振荡保护 + 孤儿 PR 清理的必要性
- 人工看板里"regressed 改回去"这类任务出现"人没空处理、连续攒了几周"的真实积压 → 重新评估要不要把改回去自动化
- 运行满 2-3 个月、`outcome` 判定积累到有统计意义的样本量 → 重新评估要不要接 memory 学习

**行数对比**：精简前 `src/lib/seo-meta/cycle/` + `src/lib/inngest/functions/seo-meta-cycle.ts` 共约 2900 行新增；精简后约 2000 行（含新增的测试）。删除的文件：`oscillation.ts`、`budget-guard.ts`。`src/lib/cms/github-client.ts` 的 `listPullRequestsByBranchPrefix`（孤儿 PR 分页清理专用）一并撤回。
