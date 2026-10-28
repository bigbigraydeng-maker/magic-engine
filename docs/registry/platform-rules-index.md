# 平台规则总索引

> 负责：卫青档案与本索引由文档维护；Check / Tune 的主人见下表，不在本文件改代码
> 范围：把散落的规则来源列在一张表里。各份原文仍在原处。
> 状态：已采用（只作索引）
> 日期：2026-10-28
> 最后核实：2026-10-28（手写。核对的是文件还在、条数对得上，不是逐条重审正文，也不是 git 历史）
> 风险：C（仅文档）
> 依据：GitHub issue #3125 评论 6466309083 第 1 步

这一页只有下面这一张表。`/dashboard/admin/agents` 用现成的表格解析器读它。列名不要改：`规则来源`、`归谁`、`路径`、`条数`、`进不进提示词`、`最后核实`。

条数是 2026-10-28 手点的：广告摘要数以 `[` 开头的行；手册数以文内加粗编号；经验手册数以二级标题；代码数以 `src/lib/ads-strategy/rules/` 里导出的数字门槛常量。候选经验的条数不抄进本表，页面上另计。

判定词只认 `src/lib/ads-strategy/baseline.ts` 的 `Verdict`：`healthy`、`watch`、`alert`、`insufficient_history`、`paused`。另一套（🟡、🔴、黄、红，以及档案里旧的「掉到 50% / 频次大于 2.5」）已废弃。

Check 的主人是现有归因任务，不是卫青，也不是诸葛亮。Tune 只经 `src/lib/memory/write-lesson.ts` 写候选（`isActive` 必须为 false），采纳人是 OPC。

| 规则来源 | 归谁 | 路径 | 条数 | 进不进提示词 | 最后核实 |
|---|---|---|---|---|---|
| 广告数字门槛 | 卫青 `weiqing` | `src/lib/ads-strategy/rules/` | 21 | 不进。代码直接判定 | 2026-10-28 |
| 广告健康档判定词 | 卫青 `weiqing` | `src/lib/ads-strategy/baseline.ts` | 5 | 不进。只认上面五个英文词 | 2026-10-28 |
| 广告操作手册草案 | 卫青 `weiqing` | `docs/sops/2026-10-10-ads-agent-playbook-and-rules-v1.0.md` | 68 | 不进。草案，未批准不进提示词 | 2026-10-28 |
| 广告规则摘要 | 卫青 `weiqing` | `docs/skill-cards/ME-ADS-RULES-DIGEST.md` | 134 | 不进。对账用的索引 | 2026-10-28 |
| 广告经验手册 | 卫青 `weiqing` | `docs/playbooks/ads/meta-general.md` | 42 | 不进。正文不是提示词 | 2026-10-28 |
| 社媒规则摘要 | 苏东坡 `sudongpo` | `docs/skill-cards/ME-SOCIAL-RULES-DIGEST.md` | 12 | 不进。对账用的索引 | 2026-10-28 |
| 社媒操作手册草案 | 苏东坡 `sudongpo` | `docs/sops/2026-10-19-social-agent-playbook-and-rules-v1.0.md` | 12 | 不进。草案，未批准不进提示词 | 2026-10-28 |
| 社媒经验手册 | 苏东坡 `sudongpo` | `docs/playbooks/social/README.md` | 26 | 不进。平台层二级标题 26；行业层与客户层另见该目录 | 2026-10-28 |
| SEO 操作手册草案 | 孔子 `kongzi` | `docs/sops/2026-10-11-seo-agent-playbook-and-rules-v1.0.md` | 69 | 不进。草案，未批准不进提示词 | 2026-10-28 |
| 平台候选清单 | 子牙 `ziya` | `docs/registry/platform-candidates.md` | 31 | 不进。候选不是已生效规则 | 2026-10-28 |
| 跨客户经验 | OPC | `src/lib/memory/write-lesson.ts` | 不抄 | 只有 is_active 为真才进。候选必须 isActive 为 false | 2026-10-28 |
| 广告漏斗体检 | 归因任务 | `src/lib/flywheel/attribution/job.ts` | 不抄 | 不进。Check 写 flywheel_outcomes，不写提示词 | 2026-10-28 |
