# 2026-06-11 夜·两窗口工作交接 + 明早开工指南

> **本窗口**：诸葛亮（pensive-grothendieck-10aef6 worktree） — CTS + Oztop 调研 + SOP
> **子牙窗口**：你今晚要开的新 Claude Code 窗口 — ME branded bug 修复
> **目的**：①两窗口对齐避免明天打架 ②你明早一句"开工"我就接得上

---

## 一、本窗口今天做了什么（诸葛亮）

**全部 push 到 `claude/pensive-grothendieck-10aef6` 分支 → [PR #453](https://github.com/bigbigraydeng-maker/magic-engine/pull/453)**

### 1.1 · 13 个新文档 + 3 段 SQL/Airtable 改动

| 类别 | 路径 | 状态 |
|---|---|---|
| **SOP（可复用）** | `docs/sops/keyword-gap-attack-playbook.md` | ✅ 已 push |
| **CTS 调研 v1+v2+v3** | `docs/clients/cts/2026-06-11-keyword-gap/00→06.md` (6 文件) | ✅ 已 push |
| **Oztop 调研 v1** | `docs/clients/oztop/2026-06-11-keyword-gap/00→04.md` (5 文件) | ✅ 已 push |
| **Oztop pre-launch** | `docs/clients/oztop/2026-06-11-pre-launch/01-03.md` (3 文件) | ✅ 已 push |
| **DB 改动** | `clients.competitor_domains` Oztop 更新成 Carpet Call + Carpet Court + 3 个 AU flooring | ✅ 已 apply |
| **Airtable** | CTS Decisions Log `rec2thylEqruw8QoL` (In Progress) / Oztop `recIqtQ9l4T7A9r1x` (Blocked) | ✅ 已写 |

### 1.2 · 关键决策记录

- **PR #453 包含两个客户全部工作** — 明天 merge 还是分批 merge PM 决定
- **Oztop 竞品已重配**：carpetcall + carpetcourt + theflooringguys + floorworld + beaumont-tiles（删了 Bunnings/Reece/Beaumont/TileTrends）
- **CTS 预算 NZ$3,000**（推荐 Google 7 : Meta 3 = NZ$2,100 + NZ$900）— 待 PM 拍最终比例
- **执行顺序锁定**：先 Oztop SEO + Conversion → 再 Oztop Ads → CTS 等 Oztop 上产后再动

### 1.3 · 当前 worktree 状态

```
分支：claude/pensive-grothendieck-10aef6
最新 commit：ed81e4b chore: pre-commit hook timestamp bump
工作树：干净
跟远程：同步
```

---

## 二、子牙窗口今晚要做什么（你贴启动咒语后）

**位置**：你另开 1 个 Claude Code 窗口在 ME 主仓 root（**不在** pensive-grothendieck-10aef6 worktree 里）

**启动咒语**：完整版在 [docs/clients/oztop/2026-06-11-pre-launch/03-ziya-launch-prompt-me-branded-bug.md](docs/clients/oztop/2026-06-11-pre-launch/03-ziya-launch-prompt-me-branded-bug.md) 里 ` ``` ` 包好那一段，直接复制粘贴。

**子牙做的事**（一句话）：
> 修 ME 后台 "Branded vs Non-Branded Traffic" 卡片显示 0% 的 bug —
> 让 branded 识别接 `clients.brand_aliases` 字段，复用 PR #336 的
> substring 匹配 pattern。

**子牙不会动的范围**（避免跟诸葛亮冲突）：
- ❌ 不动 `docs/clients/cts/` 任何文件
- ❌ 不动 `docs/clients/oztop/` 任何文件
- ❌ 不动 `docs/sops/` 任何文件
- ❌ 不动 Airtable
- ❌ 不动 ROADMAP 别的 Phase 章节（只在自己 Phase 登记下 1 行）
- ✅ 只动 `src/lib/seo-intelligence/` 或 `src/lib/dataforseo/` 相关 .ts
- ✅ 加 .test.ts 测试文件
- ✅ ROADMAP.md 加 1 行登记 + CLAUDE.md 时间戳 hook 自动改

**子牙独立工作 worktree**：
- 子牙会 `git worktree add` 自己的隔离工作区
- 不污染 pensive-grothendieck-10aef6（本窗口的）
- 不污染 main

---

## 三、两窗口工作衔接（明天的接力棒）

### 3.1 · 子牙完工后会输出什么

子牙跑完会给你 5 样东西（按 03-ziya-launch-prompt-me-branded-bug.md 末尾约定）：

1. **PR 链接**（独立的，不混 PR #453）
2. **改了哪几个文件**（应该 < 5 个 .ts + 1-2 个 .test.ts）
3. **CTS 后台 Organic Rankings Branded% 真实截图**（验证证据）
4. **Oztop 后台 Organic Rankings Branded% 真实截图**（同上）
5. **单测 + build 输出**

### 3.2 · 明天你说"开工"我要接的 5 件事（按优先级）

```
诸葛亮明天开工清单
======================

P0 ─ BLOCKING ──────────────────────────────
[ ] 1. 子牙 PR review 后是否 merge？
       - 你看完子牙截图 + diff → OK 后 merge → Render 自动部署
       - merge 24h 后跑 ME 后台 CTS/Oztop Branded% 是否真改了
       - 如果没改 → 重新开 ticket

[ ] 2. CTS Google/Meta 月预算分配比例
       - 选项 A 7:3 (Google 2,100 + Meta 900) ← 诸葛亮推荐
       - 选项 B 3:7 (Google 900 + Meta 2,100)
       - 选项 C 5:5
       - 别的
       → 选定后我更新 02-google-ads-plan.md v4

P1 ─ Oztop 主线 ───────────────────────────
[ ] 3. Oztop v2 keyword gap 截图（competitor 已重配 ✅）
       - 进 ME 后台 → Oztop 客户 → SEO Intelligence → Keyword Gap
       - 等 60s cache 过 → 跑一次 → 截图
       - 我补 v2 真实 KD/Volume 数据 + 修 02-google-ads-plan.md
       - 注意筛除 shutters/curtains/blinds 类（Carpet Call/Carpet Court 卖
         但 Oztop 不卖）

[ ] 4. Oztop SEO 改造启动（按 02-wordpress-seo-rewrite-manual.md）
       - 先备份 WP 站
       - 改第 1 页 /tile-sizes-explained-... (30 min，最高 ROI)
       - 改完截图 + GSC fetch 报我
       - 我看后再开第 2-6 页

[ ] 5. Oztop Conversion tracking 启动（按 01-conversion-tracking-sop.md）
       - Step 1 拿 4 个 ID（Google Conversion + GA4 + Pixel + CAPI Token）
       - Step 2 装 GTM
       - Step 3 建 4 个 Google Conversion Action
       - 跟 #4 并行做 — Conversion 不影响 SEO 改造

P2 ─ CTS 排期（Oztop 上产后才动）────────────
[ ] CTS 5 个落地页改造（02→05 文档全准备好了，等 Oztop 跑通后开工）
[ ] CTS Conversion 修复（同 Oztop SOP 通用流程）
[ ] CTS Meta CAPI 接入（同上）
[ ] CTS Campaign 3 Display Remarketing 上线
[ ] 李白窗口写 CTS 2 篇 P0 blog（holidays + airfare）

P3 ─ 待 v2 数据后讨论 ───────────────────────
[ ] Oztop Day 1 Ads checklist (Conversion 跑通 + 落地页 #2 修好后)
[ ] CTS Google/Meta 创意分配
```

### 3.3 · 我明早第一句话期待你说什么

理想格式：

```
开工。

子牙窗口状态：[完成 / 还在跑 / PR 已 merge / 失败]
→ [如果完成] CTS Branded ≈ __% / Oztop Branded ≈ __%

CTS Google/Meta 分配：[A 7:3 / B 3:7 / C 5:5 / 自定 G:M = __:__]

今天我先做：[2 / 3 / 4 / 5 / 别的]
```

我看了立刻接上不用你再解释一遍上下文。

---

## 四、应急情况

### 子牙窗口卡住怎么办

- **症状 1**：子牙说找不到 branded 识别逻辑 → 它要 grep 整仓 + 你给它 PR #336 的 commit hash 参考（`git log --all --grep="brand_search_volume"` 找）
- **症状 2**：子牙改完后 ME 后台还是 0% → cache 没过期。Render 部署 + 等 24h 自然过期，或者重启 Render service
- **症状 3**：子牙 PR 包了太多东西 → 你回它 "split this PR，brand 识别 bug 单独开"
- **症状 4**：单测没写 → 你回它 "走 tdd-guide agent，CLAUDE.md 强约束 80% 覆盖"

### 本窗口（诸葛亮）今晚睡觉前还要做什么

**什么都不用做**。工作树干净，PR 已 push，13 个文档全在 git 里。
明天你回来直接说 "开工" 我接得上。

---

## 五、关键文件速查（明天找不到时）

| 想做 | 看这个文件 |
|---|---|
| Oztop WP 改 SEO | `docs/clients/oztop/2026-06-11-pre-launch/02-wordpress-seo-rewrite-manual.md` |
| Oztop 装 Conversion | `docs/clients/oztop/2026-06-11-pre-launch/01-conversion-tracking-sop.md` |
| 子牙启动咒语 | `docs/clients/oztop/2026-06-11-pre-launch/03-ziya-launch-prompt-me-branded-bug.md` |
| Oztop 调研结论 | `docs/clients/oztop/2026-06-11-keyword-gap/00-research-summary.md` |
| CTS 调研结论 | `docs/clients/cts/2026-06-11-keyword-gap/00-research-summary.md` |
| CTS 预算更新 | `docs/clients/cts/2026-06-11-keyword-gap/06-budget-update-nz3000.md` |
| 通用 SOP（其他客户复用）| `docs/sops/keyword-gap-attack-playbook.md` |
| 本交接文档 | `docs/session-handoff-2026-06-11-night.md` ← 你正在看 |

---

## 六、提醒（不重要但容易忘）

- ⚠️ 子牙窗口跑完后**别让它自己 merge PR** — 你看了截图 + diff OK 才 merge
- ⚠️ 子牙 PR merge 后 Render 部署 ≈ 5-10 min，**24h 后**再去看 ME 后台 Branded 数字（cache 过期）
- ⚠️ Oztop WP 改写每页改完**必须 GSC URL Inspection → Request indexing**，否则 Google 不会主动重爬
- ⚠️ CTS 预算 NZ$3,000 升级前必须修 Conversion，**0 Conversion = NZ$3,000 烧光看不懂**

---

**Good night PM。明天见。**

— 诸葛亮（pensive-grothendieck-10aef6 worktree）
2026-06-11 03:50 NZST
