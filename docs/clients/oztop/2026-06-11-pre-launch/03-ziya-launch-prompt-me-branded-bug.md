# 子牙 · ME Branded 识别 bug 修复 — 启动咒语

> **PM 操作**：另开 1 个新 Claude Code 窗口（在 ME 主仓 root，不在本 worktree），第一句话粘贴本文档 ## 启动咒语 一节
> **预估工时**：2 小时（含子牙复审 + 魏征 review）
> **影响范围**：所有客户 ME 后台 "Branded vs Non-Branded Traffic" 卡片显示
> **目标 PR title**：`fix(seo-intelligence): branded keyword detection should use clients.brand_aliases`

---

## 背景

2026-06-11 CTS Tours NZ + Oztop Building Supplies 同期跑 keyword gap 调研发现 ME 后台 "Organic Rankings" 卡片里 "Branded vs Non-Branded Traffic" 显示：

- **CTS**：Branded **0%** / Non-Branded 100%
- **Oztop**：Branded **0%** / Non-Branded 100%

但 GSC 真实数据：
- **CTS 28 天**：品牌词（cts tours / cts / ctstours / cts travel / cts tour 等）合计 149 clicks ≈ 总流量 630 的 **24%**
- **Oztop 28 天**：品牌词（oztop building supplies / oztop / oz top）合计 48 clicks ≈ 总流量 152 的 **31%**

---

## 根因推断

ME 当前的 branded 识别逻辑**没有使用** `clients.brand_aliases` 字段：

- 推测当前算法：用 `client.domain` substring（"ctstours" 或 "oztopbuildingsupplies"）匹配关键词
- 但 CTS 真实品牌词是 "cts" / "cts tours" / "china travel service"，都不包含 "ctstours" 这个连写串
- Oztop 同理 — 用户搜 "oztop" / "oz top"，但 domain 是 "oztopbuildingsupplies" 完整串

## 复用 pattern

2026-06-04 PR #336 已经为 **brand_search_volume** Goal 主指标接入 GSC clicks 时做过同一模式：
- 读 `clients.brand_aliases` 数组
- 对 keyword 做 substring 匹配 brand_aliases
- 命中任一 alias → 标 branded = true

**参见 memory**：`feedback_client_lp_must_use_client_domain.md`（"A2.2 GSC 品牌搜索量上线 (PR #336)"）

---

## 启动咒语（复制粘贴到新 Claude Code 窗口）

```
子牙，开 ME 平台 Branded vs Non-Branded 识别 bug 修复 PR。

背景：2026-06-11 CTS Tours NZ + Oztop Building Supplies 两个客户 keyword gap
调研同期发现 ME 后台 Organic Rankings 卡片里 "Branded vs Non-Branded Traffic"
显示 Branded 0% / Non-Branded 100%，但 GSC 真实数据 CTS 28 天 ~24% / Oztop
28 天 ~31% 都来自品牌词点击。

根因推断：DataForSEO ranked-keywords 或类似处理逻辑里 branded 识别没接
clients.brand_aliases 字段。当前可能只用 domain → "ctstours" /
"oztopbuildingsupplies" substring 匹配，但真实品牌词是 "cts" / "cts tours"
/ "oztop" 等，匹配不上。

复用 pattern：2026-06-04 PR #336 已为 brand_search_volume 接 GSC clicks
做过同模式（参见 memory: feedback_client_lp_must_use_client_domain.md
A2.2 brand_search_volume 接入），substring 匹配 brand_aliases 数组。

任务清单：
1) grep 整仓找 branded 识别逻辑（可能在 src/lib/seo-intelligence/ 或
   src/lib/dataforseo/ 或某个 Organic Rankings 卡片的 server handler 里）
2) 改成读 clients.brand_aliases 数组 + substring 匹配
3) **不要污染通用 isBrandedKeyword 函数**（CLAUDE.md 强约束）—— 新写或
   扩展 wrapper，传 brand_aliases 进去
4) 单测覆盖：
   - CTS 真实样本：cts tours / cts / ctstours / cts travel / cts tour
     应该都标 branded
   - Oztop 真实样本：oztop building supplies / oztop / oz top 都标 branded
   - 反例：china tours / flooring brisbane 标 non-branded
5) 前端 Organic Rankings 卡片可能要刷新（看 cache 时长），但不改前端逻辑
6) ROADMAP.md 登记到合适 Phase（grep diff 防误删别 Phase — 参见 memory:
   feedback_roadmap_diff_guard.md）
7) PR title: fix(seo-intelligence): branded keyword detection should use
   clients.brand_aliases

强约束：
- 走子牙架构复审 + 魏征代码挑刺 review（CLAUDE.md "大任务 ≥ 2 审"）
- 不动 Phase 21/22 其他模块
- migration 不需要（brand_aliases 字段已存在）
- service-role RLS 模板不涉及（不动 DDL）

完成证据：
1) CTS 客户后台 Organic Rankings → Branded 显示 ≈ 24%（vs 当前 0%）
2) Oztop 客户后台 Organic Rankings → Branded 显示 ≈ 31%（vs 当前 0%）
3) 所有单测 npm test 通过
4) npm run build 通过

走完开 PR 等 PM merge，不要自己 merge。
```

---

## 子牙做完后通知 PM 的步骤

子牙跑完 → 应该回报：
1. PR 链接（待 PM merge）
2. 改了哪几个文件
3. CTS / Oztop 后台 Branded % 真实截图（验证证据）
4. 单测输出
5. 跟其他 Phase 的潜在影响（应该无）

PM 看了截图 + PR diff OK 后 merge → Render 自动部署 → 24h 后所有客户 Branded 显示正常。

---

## 不要做的事

❌ 不要让子牙顺手修别的 bug（控制 PR 范围）
❌ 不要在同 PR 里改前端 UI（branded 显示更友好的颜色 / icon 等留下一轮）
❌ 不要动 isBrandedKeyword 通用函数的现有签名（影响别处）
❌ 不要 force push / 跳过 hook（CLAUDE.md 强约束）

---

**PM 启动后**：
- 新窗口跑起来后 → 你回本窗口告诉我子牙状态（开始了 / 卡了 / 完成了），我这边继续 Oztop 准备工作
- 子牙 PR 出来后 → 你 review 文档 + diff，OK 后 merge
- merge 24h 后 → 你跑 ME 后台 CTS + Oztop Organic Rankings 看 Branded % 是否真改了
