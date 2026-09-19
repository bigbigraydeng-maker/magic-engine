# SEO Meta-Cycle v1 — 周循环 IMPACT 闭环设计

**Status**: Draft — 待子牙（架构）+ 魏征（挑刺）复审
**Date**: 2026-09-20
**Owner**: CTS 总项目经理窗口（claude/cts-project-manager-build-control-e4c4b1）
**PM 决策来源**: 2026-09-20 对话 — 全部新流程硬性要求接 Inngest；不满足于「盲改标题」，要求接入 DataForSEO + 竞争对手数据

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

## 4. 六步 Inngest 链路

```
cron (Monday 05:30 UTC)
  │
  ▼
[1] seo/meta-cycle.check_due
    回查上周改动：读 seo_meta_log 里 7/14 天前的改动 → 重新查 GSC CTR/position
    → 判定 improved / flat / regressed
    → regressed 的页面记入本轮"改回去"候选
  │
  ▼
[2] seo/meta-cycle.candidates_ready
    合并三路候选（patrol 发现 + GSC 4-20 名 + gap 高搜索量未覆盖词）
    去重、排除 30 天冷却、排除上一步已回查过的
    每个候选调 DataForSEO：搜索量 + 难度 + SERP 前 3 竞品标题
  │
  ▼
[3] seo/meta-cycle.prescribed
    按 seo-agent 现有分级逻辑判定动作类型：
      title_rewrite（标题/摘要）→ 自动执行
      index_request（仅缺收录）→ 自动执行
      content_refresh / new_page / internal_link → 进执行看板，人工任务三件套
      skip（难度>70 且对手前3是大站）→ 记录原因，不占改动名额
  │
  ▼
[4] seo/meta-cycle.applied
    自动动作：AI 生成 meta（含对手标题+搜索量+客户历史学习作为 prompt 输入）
    → 改仓库文件 → PR → 自动合并（复用现有 mergePullRequest）
    人工动作：写入 pm-todo 执行看板
  │
  ▼
[5] seo/meta-cycle.logged
    seo_meta_log 写入本次改动 + 改前基线指标（为下次回查用）
  │
  ▼
[6] seo/meta-cycle.completed
    汇总回执 写 cron_run_logs + 触发 memory 写入（若本轮有回查结果）：
      improved → saveProvenPattern
      regressed → saveFailedExperiment
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
  ADD COLUMN IF NOT EXISTS outcome TEXT CHECK (outcome IN ('improved','flat','regressed','insufficient_data'));
```

## 6. 客户配置 vs 共享代码（层级门判定，见 §8）

现状代码里硬编码在共享目录的、必须挪进 `clients.seo_config` 的：
- `CTS_CLIENT_ID` 常量 → 改为遍历 `client_status='active' AND seo_config->>'meta_cycle_enabled' = 'true'` 的客户（对齐 `seo-patrol` 已有的批量遍历模式）
- repo 路径、`DATA_DIR`、meta 文件落地格式 → 客户配置
- 「NZ China-travel voice」品牌语气句 → 客户配置里的 `brand_voice` 字段
- `MAX_PAGES_PER_RUN=3`、`COOLDOWN_DAYS=30` → 客户配置可覆盖的默认值

Oztop 现有的独立实现（`oztop-seo-optimizer/route.ts` 内联逻辑）在本次不合并，**记为后续候选**：先让 CTS 这条新链路跑穣，验证一个月后再把 Oztop 切过来复用同一条 Inngest 链路（避免同时动两个客户的生产链路）。

## 7. 自动 vs 人工边界

| 动作类型 | 自动执行 | 理由 |
|---|---|---|
| 改标题/摘要 | ✅ | 可逆、范围小、14 天有回查兜底 |
| 申请索引 | ✅ | 无副作用、幂等 |
| 回归后改回去 | ✅ | 同"改标题"风险等级 |
| 内容重写 | ❌ 进看板 | 触碰客户数据红线 §8：对外内容须先 grounding 官网，需人过目 |
| 新建页面 | ❌ 进看板 | 同上，且涉及信息架构决策 |
| 加内链 | ❌ 进看板 | 触碰其他页面，影响范围超出单页 |

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
- **哪些学习仍只在 client-private memory，哪些有证据升级到 industry/global memory**：本设计的学习写入（`saveProvenPattern`/`saveFailedExperiment`）全部走 client-private 层；全局/行业层的升级遵循 memory 模块既有的 `checkShareable`/`assertShareable` 门槛，本设计不新增旁路。
