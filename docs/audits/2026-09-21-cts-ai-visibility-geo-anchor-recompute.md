# CTS AI 可见度：地域锚点补配 + 9-20 回填按新规则复算（已执行）

- 日期：2026-09-21
- 客户：CTS Tours NZ（`c0000000-0000-0000-0000-000000000000`）**只做这一个**
- 风险级：A（改生产数据库）
- 授权：PM 在本窗口亲口回「开始」（非转达）
- 前置：[2026-09-20 地域锚点闸门](./2026-09-20-ai-visibility-geo-anchor-gate.md)（代码已合并，merge commit 见 PR #1857）、
  [2026-09-20 历史名次回填](https://github.com/bigbigraydeng-maker/magic-engine/pull/1846)（137 条已于 2026-09-20 10:15–10:17 UTC 执行，PR 本身未合并，但生产数据已写）

---

## 一句话

**地域锚点闸门代码上线后，CTS 一直没有真正配上锚点词，等于闸门形同虚设。** 补配 `new zealand / nz / aotearoa / auckland` 之后，
按同一套方法把 9-20 回填的 137 条 + 当时排除的 7 条重新过一遍新规则：**137 条零变化，7 条排除清单里只有 1 条需要真的改库**
（另外 6 条当初排除时本来就没被错误标记过，一直是对的）。

## 发现：任务前提有误，已核实修正

任务交接时的说法是「9-20 的回填已经用旧规则改完，今天要按新规则重算」。核实发现两处需要澄清：

1. **PR #1846 在 GitHub 上确实还没合并**（`claude/happy-taussig-18a0c4` 分支，状态 OPEN），但 137 条数据本身
   **已经在 2026-09-20 10:15–10:17 UTC 真的写进生产库**（`b7d62573` 记录了执行结果，独立于 PR 合并状态）。
2. **地域锚点闸门代码已合并（PR #1857），但生产库 `clients.brand_geo_anchors` 直接查出来是 `null`**——
   全库 33 个客户一个都没配。这意味着即使把历史数据改对，下周系统再抓同样的问题，
   旧规则（无锚点约束）还会把「澳洲的中旅」重新错记成「提到了 CTS」。这一点原始任务描述里没提到，
   属于本次核实中新发现的前置缺口，已跟 PM 确认后一起处理。

## 复算结果

用生产库现状（读时 CTS 共 4031 条回答，比 9-20 时的 3827 条多了一周新数据）重跑
`resolveClientBrandRank`（已合并、含地域闸门的版本），身份跟 9-20 回填时相同，只是补上 `geoAnchors`：

| 检查项 | 结果 |
|---|---|
| 9-20 已改的 137 条，新规则下再变化的 | **0** |
| 9-20 排除的 7 条，新规则算出来是否都正确变成「未提及」 | **7 / 7**（全部算出 `client_brand_rank: null`，无一误伤）|
| 上面 7 条里，生产库现值本来就已经是 `null`（当初排除时未被误记，不用动）| **6 条**（`2fa4ddfe` `a16a88aa` `dbf5c1ea` `b71a6c4b` `d9e47341` `c07dc2df`）|
| 上面 7 条里，生产库现值仍是错的、真的需要改库 | **1 条**（`21dc3d0c-0de0-4d8b-8766-5b79f37d8472`，旧值排第 6 → 新值未提及）|
| 除 137 条和 7 条之外，其余所有 CTS 回答有没有被新规则碰到 | **0 条** |

**为什么 7 条里只有 1 条要写库**：当初排除机制是「跳过、不写」，不是「写成某个值」。这 6 条在 9-20 回填之前，
原始（未回填）状态本来就是 `client_brand_rank = null`——它们属于当时「79 条漏记」候选里因通名冒领嫌疑被摘出去的，
既然没被改过，也就没有被错误地从 null 改成假阳性。只有 `21dc3d0c` 是当时已经带着错误名次（第 6 名，
原文里被解析器硬塞了一句「Client brand to look for CTS Tours」）又被排除、所以一直挂着错值，这条才需要真的改。

## 已执行的两处写操作

1. `clients.brand_geo_anchors`（CTS）：`null` → `["new zealand","nz","aotearoa","auckland"]`
   （走跟 `PATCH /api/clients/[id]/brand-geo-anchors` 完全一样的 `normalizeForMatch` 归一化，未触发拒收表）。
2. `ai_visibility_runs.21dc3d0c-0de0-4d8b-8766-5b79f37d8472`：
   `client_brand_rank` 6 → `null`；`brands_mentioned` 从 6 条降到 5 条（去掉硬塞的 "CTS Tours" 那条）。

写之前两处旧值都存了底稿：`~/Documents/ME-backfill-backups/2026-09-21-cts-geo-anchor-and-single-row-fix/`
（`clients.brand_geo_anchors.before.json` + `ai_visibility_runs.21dc3d0c.before.json`），可按旧值手工写回撤回。

## 写完核对

- 全库 33 个客户里，配了地域锚点的只有 CTS 1 个，锚点值跟写入的一致。
- 用生产库现在的真实配置（不再是内存模拟）重扫 CTS 全部 4031 条回答，**0 条**跟库里现值不一致。
- 其他客户 `ai_visibility_runs` 总行数 2941，未被本次操作触碰（本次两处 UPDATE 都带 `client_id`/`id` 精确匹配，不影响其他行）。

## 明确不做的事（跟 PM 议定范围一致）

- 不补配 CTS 的中文地域锚点（如「新西兰」）。接口在保存时给出了警告——CTS 有中文别名但锚点全是英文，
  如果某条中文回答只写「新西兰」不写 "New Zealand"，靠中文别名认出来的提及会被判成「没提到」——
  这是已知、非阻塞的局限，留给 PM 之后决定要不要补。
- 不动其他 32 个客户。
- 不碰 `diagnostic_runs` / `diagnostic_findings` / `flywheel_metrics`，理由与 9-20 回填一致（见
  [9-20 回填计划](https://github.com/bigbigraydeng-maker/magic-engine/pull/1846) 的「明确不改的东西」一节）。

---

## Reuse Statement

- **复用了什么已有平台能力**：`src/lib/ai-tracker/client-brand-match.ts` 里已合并的 `resolveClientBrandRank`
  （含地域锚点闸门）原样调用，没有另写一份判定逻辑；锚点归一化用的是 `PATCH /api/clients/[id]/brand-geo-anchors`
  同一个 `normalizeForMatch` 函数，不是重新拍脑袋写校验规则；底稿/撤回的做法沿用 9-20 回填脚本的约定
  （持久路径、写前存旧值、`client_id`/`id` 双重限定）。
- **哪些是 platform-shared**：无新增，本次只是把已有的地域锚点闸门功能真正接到 CTS 头上。
- **哪些是 industry-specific**：无。
- **哪些是 client-specific**：CTS 的锚点词 `new zealand/nz/aotearoa/auckland`，只存在 `clients` 表 CTS 那一行。
- **有没有把客户名/客户 ID/行业判断写进 shared runtime**：没有，本次未改任何 `src/lib/` 代码，只做了配置写入和 1 行历史数据修正。
- **本次实现落点与之前判定是否一致**：一致——9-20 地域锚点闸门文档的 Platform Tier Classification（L1 规则扩展 + L4 客户配置）
  在本次生效环节没有变化，本次只是把「PM 待拍板项」里第 ② 项（#1846 重算后写历史数据）执行完。
