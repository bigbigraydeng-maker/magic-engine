---
name: sanity-check
description: >-
  Discovery / deck 输出前的红线检查器 · 查 4 类硬伤：编数字（无来源数字）· 未标不确定项 ·
  跨地理搬案例 · 遗漏客户短板红线（如域名未 rebrand / 平台身份割裂）。Use when: 用户说
  「跑 sanity / 检查一下 / 输出前 QA / verify / 红线检查」或 discovery-scan / synthesize-deck
  跑完主动引导。前置：discovery-scan 或 synthesize-deck 已跑。
---

# /sanity-check — 输出前红线检查

**在 deck 交给客户之前跑一遍**，防止 ME 项目历史事故重演（CTS queenstown / Oztop vinyl 编数据 · Royal Heights 案例搬 Bayside 等）。

---

## 什么时候跑

- 用户显式：`/sanity-check {slug}`
- **隐式必跑**：`/deploy-deck` 触发前主动建议"要不要先 sanity check 一遍"
- 也可以跑 `/sanity-check --stage=discovery`（只查 discovery JSON）或 `--stage=deck`（只查 deck HTML）

---

## 4 类硬伤（按严重度排序）

### 🔴 1 · 编数字（最严重 · CLAUDE.md 硬约束）

**查什么**：
- 每一个数字（成交量 / GMV / 均价 / 粉丝数 / 房价 / CPM / 学区溢价 …）必须有 `source_url` 或明标 "typical range"
- 特别查 `competitor.recent_activity.*` / `market_context.median_prices.*.median_price` / `market_context.demographics.*_pct`
- 也查 deck HTML 里的数字，反查是否在 JSON source_links 里能溯源

**触发规则**：
- JSON 里出现数字但 `source_url` 缺失 → 🔴 red flag
- 数字明显整齐（如"20% 华人""$2M 均价""15 单成交"）而无 source → 🔴 red flag
- 数字后带模糊限定词但没标"typical" / "estimate" → ⚠️ yellow flag

**已知事故**：
- CTS 子牙假设"queenstown inbound 旅游"（实际是 outbound）→ 编业务方向
- Oztop 子牙编"vinyl / herringbone / shutters"5 品类页 + 编 18100/22200 搜索量 → 编数字

### 🔴 2 · 未标不确定项

**查什么**：
- Meta Ad Library 是 SPA 反爬 → 「是否付费 Meta 广告」如果不是 "unknown"，必须有 `verification_notes` 附直达 Ad Library URL
- LinkedIn HTTP 999 / RateMyAgent 403 / IG FB 精确粉丝需登录 · 这些字段若给了确切数字必须有登录后截图 or "estimated" 注释
- `data_gaps` 数组不能为空（"我啥都验证到了"是极罕见情况）

**触发规则**：
- 竞对 snapshot 里 `data_gaps` 空数组 → ⚠️ yellow flag（不太可能真啥都齐 · 让用户 review）
- 报告里出现"未确认""待核""可能"等词但 `data_gaps` 未捕获 → 🔴 red flag

### 🔴 3 · 跨地理 / 跨行业搬案例

**查什么**：
- 客户在新地理开工时（如 Roman 从 Royal Heights 跳 Mission Bay）· deck 里 case study 是否用了旧地理成交
- 客户跨行业（如律所换开新产品线）· deck 里案例是否用了旧行业

**触发规则**：
- deck HTML 里出现具体 suburb / project name → 反查 discovery `market_context.geography.suburbs` · 不在列表里 = 🔴
- deck 里 "$XXX 成交" / "XX% 增长" 类具体数字 → 反查是否来自本 client 本地理 · 不匹配 = 🔴

**已知事故**：
- Roman Hu case 差点用 Royal Heights 西区 case 假装 Bayside 东区

### 🔴 4 · 客户短板 / 红线遗漏

**查什么**：
- 客户跳槽 / 换品牌 → 检查 deck 是否列了"域名 rebrand / 平台身份同步 / 跳槽宣告"3 件事
- 客户换团队 → 检查是否列了"独狼状态 / 承接压力"
- 客户在受管制行业（房产 Housing / 金融 / 医疗 / 教育） → 检查是否列了广告合规限制
- 客户短板章节是否**只有武器没有短板**（诚实性检查）

**触发规则**：
- deck 武器 vs 短板章 · 武器数 > 3 而短板数 < 2 → ⚠️
- 客户信息里显式提到跳槽 / 换所 / 新战场 · deck 红线章无对应条目 → 🔴

---

## 执行流程

### 1. 读输入

- `docs/clients/{slug}/discovery/{latest-date}/manifest.json` + 全部 JSON
- `docs/clients/{slug}/deck/{latest-date}/index.html`（若已生成）

### 2. 跑 4 类检查 · 逐项列 finding

每个 finding 结构：

```
{
  "severity": "red" | "yellow",
  "category": "编数字" | "未标不确定" | "跨地理搬案例" | "短板遗漏",
  "location": "competitors/aaron-foss.json:recent_activity.deals_count",
  "issue": "值 28 · 无 source_url",
  "fix_suggestion": "1) 从 OneRoof 拿 URL 填 source_url；2) 若不确定改 null 并补 data_gaps"
}
```

### 3. 输出报告

```
Sanity check 完成 · 发现 {R} 处 red / {Y} 处 yellow

🔴 Red flags（必须修，不能上线）：
  1. [位置] [问题] → [修复建议]
  ...

⚠️ Yellow flags（建议修，可选）：
  1. [位置] [问题] → [修复建议]
  ...

修完后：
- 再跑本 skill 验证：`/sanity-check {slug}`
- 无 red flag 后：`/deploy-deck {slug}`
```

**关键**：
- 有任何 🔴 → 阻止 `/deploy-deck` 自动运行 · 用户必须显式说 "我知道了强制部署"
- 全绿 → 引导下一步 `/deploy-deck`

---

## 交互模式

**默认非交互**：只报告 finding · 不改文件。

**--fix 模式**：`/sanity-check {slug} --fix`
- 对 yellow flag 自动尝试修（补 null / 加"typical range" 标注）
- 对 red flag 交互式问用户，用户确认后再改

**--strict 模式**：`--strict` = 把 yellow 也当 red · 用于对外正式提案。

---

## Phase 兼容

Phase 1 后：本 skill 变成 `/sync-to-me` 的前置检查 · sync 前自动跑 · 有 red 拒绝 sync。

Phase 3 后：司马徽 agent 自动跑本检查 · 有 red 通知 FDE 手动 review · 不自动交付客户。
