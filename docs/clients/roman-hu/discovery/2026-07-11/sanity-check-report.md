# Sanity Check Report · Roman Hu Discovery · 2026-07-11

按 `plugins/me-client-discovery/skills/sanity-check/SKILL.md` 定义的 4 类硬伤逐项检查。

**总体结论**：**2 处 🔴 red · 6 处 ⚠️ yellow** · 需要修 red 才能进 /synthesize-deck 或 /deploy-deck。

---

## 🔴 Category 1 · 编数字

### 🔴 R1 · derived 数字未标 estimate

**位置**：
- `competitors/paul-neshausen.json:recent_activity.gmv = 91800000`
- `competitors/lawrence-yuan.json:recent_activity.avg_deal_size = 1464000`

**问题**：这两个数字都是**计算出来的**（不是直接从数据源拿到）：
- Paul GMV `91.8M` = 从 24 月合计 `$183.6M` / 2 推算 · 假设分布均匀
- Lawrence 均价 `1,464,000` = 从 `$41M / 28 单` 算出 · 但 homes.co.nz 未必给的是同一时段口径

**风险**：看起来像原始数据 · 未来 Analysis 段（华佗）读到会误当 authoritative

**修复**：
1. 加 `data_gaps` 条目：`"Paul 12 月 GMV 为 24 月 $183.6M 均分推算 · 非直接原始数据"`
2. 或改字段：`gmv_derived_from_24mo: true` + 相应 note
3. 最简单：把这类 derived 数字挪到 `data_gaps` 的注释里，本字段留 null

### ⚠️ Y1 · 精确数字缺 per-field source

**位置**：多处 · 如 Aaron `deals_count: 28` / `avg_deal_size: 2650000` / IG `followers: 4910`

**问题**：数字来源在 `source_links` 数组里（OneRoof / IG 页），但**不能一对一**看出"这个 28 来自哪个 URL"

**风险**：future 司马徽 或 FDE 想核实需要重新扫每个 source_link

**修复（Phase 1 优化项 · 不阻塞）**：schema 里加可选字段 `field_sources: {"recent_activity.deals_count": "https://oneroof.co.nz/..."}`

---

## 🔴 Category 2 · 未标不确定项

### ⚠️ Y2 · Lawrence paid_ads.meta_ads = "no" 过于自信

**位置**：`competitors/lawrence-yuan.json:paid_ads.meta_ads = "no"`

**问题**：note 里说"无个人 FB Page 事实 + Ad Library 无广告投放记录 = 判断可信度高"—— 但没**直接**看 Ad Library

**风险**：万一 Lawrence 用别的账号 or team 号投过 · false negative

**修复**：改成 `"unknown"` + 保留 verification_notes · 更严谨

### ✅ Passing checks

- 4 份 competitor JSON 都有非空 `data_gaps` 数组 ✓
- market-context.json `data_gaps` 有 4 条 ✓
- Aaron/Paul/Sarah 的 `meta_ads` 都标 "unknown" + 附直达 Ad Library 链接 ✓
- 平台反爬项（LinkedIn 999 / RateMyAgent 403 / IG FB 精确粉丝）全部在 data_gaps 里显式标出 ✓

---

## 🟢 Category 3 · 跨地理搬案例

**结论**：Discovery JSON 阶段暂无跨地理案例引用 · 通过。

**下一步检查**：deck HTML 生成后需要复查 —— 特别是**红线要点**"禁用 Royal Heights 案例假装 Bayside"必须在 v2 deck 里显式列出。

---

## ⚠️ Category 4 · 客户短板 / 红线遗漏

### ⚠️ Y3 · manifest.roman_key_flags 缺"Bayside 主流欧美 Kiwi 74%"警告

**位置**：`manifest.json:roman_key_flags`

**问题**：只列了"跨地理 + 独狼 + 未 rebrand"3 条红线 · 但**没列**"Bayside 74% 欧美 Kiwi · 华人身份是加分不是主战线"这条战略警告

**风险**：v2 deck 若把 Bayside 定位错为"华人主战场"就翻车

**修复**：manifest.roman_key_flags 加一条 `"strategic_warning": "Bayside 主流 74% 欧美 Kiwi · 华人身份是加分不是主战线 · 双漏斗 EN/中文 creative 独立跑不能共用"`

### ⚠️ Y4 · 缺 Head of Projects vs 普通 agent 的能力落差警告

**位置**：`manifest.roman_key_flags.unique_leverage`

**问题**：只说"Head of Projects = vendor 端独家杠杆" · 但**没警告** Roman 缺 vendor pitch deck / pre-launch database 这些能力 · 是**新工作职责需要新工具**

**风险**：Roman 不知道自己缺什么 · deck 里 lane 05 vendor 端方案落地会 delay

**修复**：加 `"leverage_prerequisite": "vendor 端需要新工具：pitch deck 模板 / pre-launch Chinese buyer DB / 楼花 CGI + 中文项目介绍视频能力 · 目前尚未搭建"`

### ⚠️ Y5 · Team Hu 独狼状态影响 90 天路线未量化

**位置**：`manifest.roman_key_flags.red_lines[2]`

**问题**：只说"独狼状态" · 未量化对 D1-90 承接压力的影响

**风险**：D31-60 起势期 WhatsApp 对话 60-100 条 Roman 一个人接得完吗？deck 里 KPI 需要打折扣或提示"招 1 个 assistant"

**修复（deck 阶段 · 不改 JSON）**：Lane 01 KPI 加"若维持独狼 · WhatsApp 对话上限 40 条/月 · 需招 assistant 才能到 100"

### ✅ Passing checks

- 30 天 3 件红线明确列出 ✓
- 跨地理危险显式警告 ✓
- 独家杠杆识别到位 ✓

---

## 修复建议（按顺序）

**必修**（🔴 · 阻塞 /synthesize-deck）：
1. R1 · 把 Paul GMV + Lawrence 均价的 derived 数字挪到 data_gaps · 字段留 null

**建议修**（⚠️ · deck 前修）：
2. Y2 · Lawrence meta_ads 改 "unknown"
3. Y3 · manifest 加 "strategic_warning" 字段
4. Y4 · manifest 加 "leverage_prerequisite" 字段

**Deck 阶段处理**（⚠️ · 到 /synthesize-deck 时处理）：
5. Y1 · 精确数字加 per-field source（Phase 1 优化项）
6. Y5 · Lane 01 KPI 加独狼折扣提示

---

## 修复完再跑一次本 skill 直到全绿

```
/sanity-check roman-hu
```

全绿后 → `/synthesize-deck roman-hu`（若需要 v2 deck）→ `/deploy-deck roman-hu`

---

## Meta（sanity-check 本身的验证结论）

本次 sanity-check 是**"读文本走 4 类检查规则"** 的心里/文字版 · 未来 sanity-check skill 真实现时应该：
1. Load 每份 JSON
2. Iterate 每个数字字段 · 反查 source_links / data_gaps 是否覆盖
3. Iterate `differentiators` / `weaknesses` · 检查平衡（不能只有武器无短板）
4. 交叉检查 client geography vs deck 案例地理
5. 输出结构化 finding JSON

Phase 2 后可以做成 `/dashboard/clients/[id]/discovery/quality-check` UI 一键跑。
