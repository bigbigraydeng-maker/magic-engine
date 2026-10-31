# Agent 自治运行计划 v1 — 从「等派活」到「有目标、有闹钟」

状态：PM 2026-09-24 拍板（`认`），执行走 DeepSeek，子牙审 · 风险分级见 §5 · 不新增能力线
Repository Fact Gate：`origin/main` = `8d3d84f9` · fetched 2026-09-24 23:50 NZST
Tier Classification：把广告支柱已落地的「信封内自治 + PM 日检」模式复制到其他支柱与运营 agent。机制层（信封、Kernel、pm-todo、Inngest）归平台底盘；各支柱「不问 PM 能做什么」归各自规则。不进 platform-candidates。
前置：广告支柱自治 spec —— [PR #1956](https://github.com/bigbigraydeng-maker/magic-engine/pull/1956)（`docs/specs/2026-09-24-ads-goal-driven-autonomous-impact-loop-v1.md`，**该 spec PR 尚未合并，合并前以 PR 为权威**；其 WP0 = PR #1960、WP1 = PR #1962 已合并，WP2 = PR #1979 已三人复审待合并，WP3 待做）· [`docs/agents/00-architecture.md`](../agents/00-architecture.md)

---

## 0. 一句话结论

问题不是 agent 太多，是 14 个 agent 全在「等人叫」。改法不是把人塞到谁底下，是给每个人**一个目标 + 一个闹钟 + 一条只有它能做的事**；结果一律进「今日待办」并署名。PM 只看总管和构建控制室，其余 agent 不占窗口。

## 1. PM 原话（2026-09-24）

> 我希望 Agent 能自己有目标以及工作。在 IMPACT 的模式之下，它们应该在大部分时间里能管好自己，甚至自己做决策。

> 除了常用的之外，剩下的很多 Agent 我也不知道它的作用，以及想不起来用它。

## 2. 自动化的五个零件（统一口径）

| 零件 | 人话 | 平台对应 |
|---|---|---|
| 闹钟 | 自己醒，不用人叫 | cron / Inngest / scheduled task / 事件触发 |
| 眼睛 | 醒来能读到数据，且知道数据全不全 | `ad_daily_insights` 等数据脊柱 + 完整性判定（如 `resolveCompleteness`） |
| 脑子 | 写死的判断规则，把「看到的」变成「该做什么」 | 纯函数规则（D1–D9 / O1–O3 / 信息完整闸门 / 分镜自检表） |
| 手 + 笼子 | 手＝能碰外部系统；笼子＝不问 PM 能做的范围，超出即停、能撤回 | Kernel ActionKey + `OutwardApproval.bounded` 信封 + rollback |
| 记性 | 做完过几天回看效果，好坏都记 | `flywheel_outcomes` + `client_proven_patterns` / `client_failed_experiments` |
| （通道） | 该问 PM 的写成三件套 | `src/lib/pm-todo/manual-items.ts`（what / how / href） |

## 3. 现状矩阵（2026-09-24）

| Agent | 闹钟 | 眼睛 | 脑子 | 手+笼子 | 记性 |
|---|---|---|---|---|---|
| 卫青 广告 | 有 | 有 | 有 | 有，开关未开（4 客户全 `observe`） | 无（WP3） |
| 孔子 SEO | 有（周） | 有 | 一半 | 有手（`page.apply_optimization_request`，`human_only`）；有闸门（信息完整闸门），无「不问就做」范围 | 一半 |
| 孟子 AI 可见度 | 有（周） | 有 | 一半 | 无（没有直接的手，处方转内容） | 无 |
| 苏东坡 社媒 | 一半（按排期） | 一半 | 有（配方对账、content-guard） | **规矩不允许自动发布**（Ray 授权、闸在外发那一步） | 无 |
| 司马迁 口碑 | 无 | 一半 | 无 | **规矩不允许自动执行**（口碑维度 FDE-only、GBP 发帖审批制） | 无 |
| 张骞 侦察 | 有（周） | 有 | 不需要 | 不需要 | 不需要 |
| 华佗 诊断 | 有（跟张骞） | 有 | 有 | 不需要 | 不需要 |
| 鲁班 执行 | 事件驱动 | 不需要 | 不需要（不判断） | 有（Kernel） | 一半（回读） |
| 马良 视觉 | 无 | 有 | 有（分镜自检表） | 不需要（只出裁决） | 一半 |
| 李白 文案 | 无 | 有 | 有（逐句溯源） | 不需要 | 一半 |

审查团（魏征、狄仁杰、板桥）：天生反应式，不设闹钟，改为**按改动内容自动被叫**（见 §4.2）。达芬奇：**撤**，其 7 个审查问题并入子牙设计审查清单（`docs/agents/10-ziya.md`）。

## 4. 目标名单（PM 已认）

> **2026-10-28 提示**：PM 批准了名单整合（张骞并入华佗、李白并入马良、狄仁杰与板桥并入审查团、孙子并入孔子、司马徽删除、司马迁休眠、新增「客人沟通」「记性」两个挂名位）。当前名单以 [`docs/agents/README.md`](../agents/README.md) 为准，本节下面的表未同步改。

### 4.1 支柱与运营

| 人 | 目标 | 多久醒 | 不问 PM 就能做 | 必须问 PM（进今日待办，署名） |
|---|---|---|---|---|
| 卫青 | 每客户每条广告的每结果成本可持续 | 每天，Meta 日数据拉完 | 信封内：暂停单条、砍/加预算 ≤20% 且不超日上限（仅 `autonomy_mode='bounded_auto'` 客户） | 加预算 >20%、关整个系列、换账户/付款、跨账户挪钱、目标完不成三选一 |
| 孔子 | 目标词排名与收录 | 每周二 | 巡检、诊断、出建议；改标题/摘要仅在信息完整闸门全绿 + 客户已开自动 + 先 dry_run 之后 | 闸门任一项缺、新话题新页面、动站点结构 |
| 孟子 | AI 回答里被提到/引用的比例 | 每周三 | 探测、算比例、「没测成 ≠ 零」；探测费用在预算闸内 | 内容处方（转苏东坡/李白）、探测预算超闸 |
| 苏东坡 | 按爆款配方产出可发候选 | 按客户内容排期 | 生成候选、配方对账表、分镜自检 | **任何发布** |
| 司马迁 | 评价不漏回、GBP 帖子按审批发 | 每周四 | 读评价、起草回复、起草帖子 | 发帖、回评一律审批 |
| 张骞 | 站点/关键词/AI 可见度/竞品数据新鲜 | 每周一，排华佗前 | 全部只读采集；竞品监控程序归他挂名，不新增人 | 采集撞 150 秒上限跑不完 |
| 华佗 | 每客户 6 支柱打分 + 问题清单 | 张骞跑完即跑 | 全部只读评分 | 无，交诸葛亮 |
| 鲁班 | 批准的动作真做出去、留回执 | 无闹钟，有授权 run 即干 | 只做已授权的 | 执行失败、回读对不上 |
| 马良 | 出片不出丑 | 每出一条片/一批图 | 逐镜 9 宫格自检，不过关不给 PM 看 | 不过关的片返工还是放弃 |
| 李白 | 客户文案句句可溯源、提示词库不烂 | 每出一篇文案 + 每月提示词体检 | 逐句标「官网可溯 / brief 可溯 / 未证实」 | 「未证实」句留不留 |

闹钟一律避开周五、周六（今日待办那两天不跑）；不用 7 的倍数天做提醒周期。

### 4.2 审查团（自动被叫）

| 人 | 触发 | 说明 |
|---|---|---|
| 魏征 | 任何 B/A 级 PR 进入审查 | 挑刺，意见回子牙汇总 |
| 狄仁杰 | 改动路径命中 A 级清单（`tools/ops-review-loop/src/risk.mjs`，已在仓库、未接线） | 攻击验证 |
| 板桥 | 改动碰到客户/PM 看得到的页面、邮件、报告；以及所有进今日待办的条目 | 人话审查 |

### 4.3 常驻可见

子牙、诸葛亮 + PM 自己的构建控制室。其余 agent 不占窗口。

### 4.4 代码对照（五列，2026-10-18 补）

> 来源：`docs/specs/2026-10-18-me-agent-standard-process-v1.0.md` 地基块 1。**只加列，不改上面 §4.1–§4.3 PM 已认的内容。** 只覆盖 §4.1 的运行时 Agent 和常驻的诸葛亮；§4.2 审查团产品里本来就没有代码，不填。
> 叫醒登记一列取自 `src/lib/cron/registry.ts` 的 `CRON_REGISTRY`（写 `jobName`，体检按它查 `cron_run_logs`）或 `src/lib/inngest/functions/index.ts` 的函数，2026-10-18 逐个核过；**没查到的写「未核」，不猜**。谁留谁撤谁改名由 PM 定。

| 名单上的人 | 代码入口 | 叫醒登记在哪 | 调不调模型 | 兼审查 | 代码实际在做 vs 名单写的 |
|---|---|---|---|---|---|
| 卫青 | `src/lib/ads-strategy/` | `google-data-pullback-daily`（定时，`registry.ts:157`）；D3 自动暂停为 Inngest 事件函数 `adsD3AutoPause`（不在登记表） | 不调（全目录零个文件调模型） | 否 | 名单目标一致；手册 `11-weiqing.md` 开头写用 Sonnet / Haiku，与代码不符 |
| 孔子 | `src/lib/seo-meta/` 等 | `seo-patrol-daily`（`:254`）；标题周循环 `seo-meta-cycle-step6-completed`（Inngest 定时，`:329`） | 未核 | 否 | 代码里不出现这个名字 |
| 孟子 | `src/lib/ai-tracker/` 等 | `ai-tracker-weekly`（`:121`） | 未核 | 否 | 同上 |
| 苏东坡 | `src/lib/factory/`、社媒 | `factory-publish-sweeper` / `factory-publish-worker`（`:147-148`）；日计划自动发帖 `cloud-daily-plan-auto-publish`（Inngest 定时，新西兰时间每小时第 20 分；不在定时登记表） | 未核 | **是** | 社媒发布全在内核外 |
| 司马迁 | `src/lib/inngest/functions/simaqian-reputation-weekly.ts` | `simaqian-reputation-weekly`（Inngest 定时，`:366`） | 未核 | 否 | — |
| 张骞 | `src/lib/zhangqian/` | `zhangqian-sweeper`（`:270`）；另有 discover / public-scan / register 接口触发 | 是 | 否 | 一致 |
| 华佗 | `src/lib/huatuo/` | **无闹钟**：处方生成 / refine 接口触发 | 是 | 否 | 名单写「6 支柱打分」，代码是开处方；6 维打分实际在 `src/lib/diagnostic/runner.ts` |
| 鲁班 | `src/lib/luban/`（入口 `execution/[itemId]/luban`、`clients/[id]/luban`） | **无闹钟**：人在执行项页面对话触发 | 是 | 否 | 名单写「只做已授权的」不准确：大模型可直接调 `publish_to_gbp` 发谷歌商家帖子，绕过内核（台账 `2026-10-18-luban-gbp-publish-bypasses-kernel`；目前无授权、零调用） |
| 马良 | `src/lib/maliang/render-check.ts`、`src/lib/assets/vision-analyzer.ts`、`storyboard-generator.ts`、`case-library/` | `maliang-render-check`（Inngest，`:436-438`） | 是（出片检查 Gemini，视觉分析 GPT-4o-mini） | **是** | 名单一致 |
| 李白 | `src/lib/blog/`、`src/lib/geo/`、`content/prompt-library-audit.ts` | `libai-prompt-library-monthly`（Inngest 定时，每月，`registry.ts:362`） | 是 | 否 | 待扩展 |
| 诸葛亮（常驻） | `src/lib/zhuge/` | `zhuge-weekly-recalculate`（`:271`）；另有 conduct 接口 | 是 | 否 | 两条路径：conduct 带记忆与工具，每周重算两样都不带 |

**名单上没有、代码里有**：孙子（`src/lib/seo-agent/`，只被 `seo-agent/plan` 接口调）——收不收由 PM 定。**CLAUDE.md 里有、名单和代码都没有**：司马徽（DAPE「发现」段）——留不留由 PM 定。

**两道开关前置闸**（地基块 4）：接通谷歌商家授权前，台账 `2026-10-18-luban-gbp-publish-bypasses-kernel` 须 verified；关广告演练开关前，台账 `2026-09-28-envelope-facts-cooldown-blind-to-kernel-own-changes` 须 verified。

## 5. 分批与风险分级（§11 三维打分已亮出）

| 批 | 内容 | 频率 / IMPACT / 收入 → 优先级 | 风险级 | 执行 | 复审 |
|---|---|---|---|---|---|
| **B0 本文档** | 本计划 + 撤达芬奇 + 子牙清单 | 前置，不打分 | C | 子牙（docs） | — |
| **B1 广告 WP3** | 接线：Inngest 链、孔明预检、韩信、Check、Tune、Jev、五段日报、`autonomy_mode`↔`client_automation_policies.mode` 同步、确认熔断落点 | 高 / 高 / 高 → **P0** | **A** | ME 广告构建控制（DeepSeek 执行） | 子牙 + 魏征（设计前后各一次），狄仁杰看同步开关 |
| **B2 三只闹钟** | 马良：每次出片自动 9 宫格自检 → 不过关不上待办；李白：每篇文案自动逐句溯源标注 + 每月提示词体检；司马迁：每周读评价、起草回复入待办（不发） | 中 / 中 / 中 → **P2** | B | ME 2.0 构建控制（DeepSeek 执行） | 子牙一次集中 |
| **B3 审查自动被叫** | 接线 `risk.mjs` → PR 事件 → 自动分派魏征/狄仁杰/板桥 | 高 / 中 / 低 → **P2** | **A**（碰 `.github/workflows`、`tools/ops-review-loop`） | 待 B1 稳定后 | 子牙 + 狄仁杰 |
| **B4 板桥待办人话闸** | 今日待办条目先过板桥改成人话 | 高 / 中 / 中 → **P2** | B | 待 B2 后 | 子牙 + 板桥 |
| **B5 孔子的笼子** | 给 SEO 改文案划「不问就能做」范围 | 待广告跑稳两周后再打分 | A | — | — |

顺序：B0 → B1 与 B2 并行 → 广告跑稳两周 → B3 / B4 → B5。**不一次全开。**

## 6. 红线（沿用，不放宽）

1. 发布、口碑执行、花钱类放宽：没有 PM 授权事件不做（fail-closed）。
2. 事实一律服务端读；提交方只说「动谁、改成什么」。
3. 读不到 = 不动，不给默认值。
4. 每个自动动作有回执、改前快照、撤回路径；该问 PM 的写三件套，不许死在日志里。
5. 客户名 / 行业判断不进 shared runtime；各支柱边界进各自 Playbook / Config。

## 7. Reuse Statement

- 复用：Kernel 信封机制、pm-todo 三件套、Inngest 编排范式、现有周任务（`flywheel-seo-weekly` / `ai-visibility-weekly` / `competitor-watch-weekly`）、分镜自检表与逐句溯源规则。
- 新增 platform-shared：无新机制；只是把已有零件按 agent 挂上闹钟与署名。
- industry-specific：无。client-specific：各客户的目标、上限、开关。
- 落点与 tier-gate 判定一致：不新建能力线。
