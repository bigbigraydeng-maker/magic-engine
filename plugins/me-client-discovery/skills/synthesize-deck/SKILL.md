---
name: synthesize-deck
description: >-
  读 discovery-scan 输出的 JSON（competitors + market-context + local-media-channels），
  套 deck-template.html 生成一份中文 HTML 提案 deck（Roman Hu 案例的通用化模板）· 8 章结构：
  战场 / 白地图 / 武器 vs 短板 / 处方三线漏斗 + 独家杠杆 / 预算数字 / 90 天路线 / KPI 预算 /
  红线。Use when: 用户说「出 deck / 生成方案 / synthesize / 出提案 / 合成报告」，或者
  discovery-scan 刚跑完主动引导下一步。前置：discovery-scan 已在
  docs/clients/{slug}/discovery/{date}/ 落好文件。
---

# /synthesize-deck — JSON → 中文 HTML deck

把 /discovery-scan 输出的结构化 JSON 合成一份可直接交给客户看的中文 HTML deck。
排版参照 Roman Hu 案例（`public/decks/roman-hu-plan/dist/index.html`）· 中文数字 markers
壹贰叁 · Ray White navy accent · 竞争矩阵 table · 90 天 timeline · 预算表。

---

## 什么时候跑

- 用户显式：`/synthesize-deck {slug}` 或 `/synthesize-deck`（自动挑最新一份）
- 隐式：discovery-scan 跑完后主动询问"要不要立刻出 deck"

**拒绝跑的场景**：
- discovery-scan 输出不存在 → 先跑 `/discovery-scan`
- competitors_count < 3 → 竞争矩阵会很稀疏，建议先补齐竞对

---

## 输入准备

用户不需要额外提供什么，只需要给 client slug（如 `roman-hu`）。若省略，扫 `docs/clients/*/discovery/*/` 找最新的。

**可选深入问**（如果 discovery-scan 没拿到）：
- 客户品牌色（用于 deck CSS token · 如 Ray White navy #002542）· 若无 → 默认 Magic Engine 色系
- 客户 Head-of-X 类特殊头衔 · 若有 → 独家 lane 5 vendor 端叙事
- 客户已有资产（个人域名 / TV 主持背景 / 多语能力）· 若有 → 武器盘点章节强化

---

## 执行流程

### 1. 读输入

```
docs/clients/{slug}/discovery/{latest-date}/
├── manifest.json
├── competitors/*.json         → 全部读进内存
├── market-context.json
└── local-media-channels.json
```

### 2. 生成"竞争白地图矩阵"（deck 第贰章 · 最关键）

**这一步在主 session 做，不派分身**。跨竞对对比找"全部撞同一堵墙"的行：

维度清单（可扩可减）：
- 独立个人域名
- 中英/多语能力
- 小红书
- 微信公众号 / 视频号
- 抖音 / TikTok
- 付费 Meta 广告
- 教育型内容
- WhatsApp Business 承接
- Google Business Profile 运营

**规则**：某维度上 4/4 竞对都是 ✗ = 客户的白地图机会点 · deck 里高亮 gold 色。

### 3. 生成"客户武器 vs 短板"（deck 第叁章）

**必须诚实**（CLAUDE.md 硬约束）：
- 武器：从用户 Q5 输入 + Q2 头衔 + Q6 客户 ID 关联的 master_brief（若有）反推
- 短板：不能省略。**每个客户都有短板**。跨地理搬案例 / 域名未 rebrand / 团队缺员 / 品牌资产割裂等都是常见红线。
- 若用户没给短板信息 → **主动问一句** "客户 X 目前有没有… ①身份 / 平台没同步的地方？②案例是否能直接搬到新地理？③团队是否完整？" 拿到答案再落笔

### 4. 生成"多线漏斗处方"（deck 第肆章）

**至少 3 线 + 1 独家**：
1. Lane 01 · Meta / 付费媒体漏斗（视频 ThruPlay + WhatsApp 承接 · 房产 Housing 类广告特殊约束）
2. Lane 02 · GEO / AI 可见度（romanhu.com 双语 blog · 中文平台署名专栏 · GBP）
3. Lane 03 · 官网 + Suburb landing page
4. Lane 04 · 本地媒体矩阵（用 local-media-channels.json 按 roi_rank 排序）
5. Lane 05 · **独家杠杆**（客户有特殊头衔 / 独家资源时才出 · 如 Head of Projects vendor 端）

**别硬凑 5 lane**：客户没独家资源就 4 lane · deck 里 lane 只放真的能干的。

### 5. 生成"预算数字模型"（deck 第伍章）

三档 NZ$ 预算表 + 打平模型：
- CPM / CPMTP / CPL 参考区间
- 传统获客 CPL vs Meta CPL 对比
- 单笔佣金 / 客单价 × 12 月打平计算

**数字来源**：优先用市场速写里的实际值；没有 → 引用 NZ 房产 / 服务业公开基线；再没有 → 明标"典型区间需要按客户实际投放校准"。

### 6. 生成"90 天路线"（deck 第陆章）

- D1-D7：红线抢救期（rebrand / 平台身份同步 / 跳槽宣告等）
- W2-W4：地基期
- D31-60：起势期
- D61-90：转化期

**红线抢救期必须列客户 3-5 条真实红线**（从武器 vs 短板章的短板导出）。

### 7. 生成"KPI + 月预算"（deck 第柒章）

- 12 个 KPI 数字（ThruPlay 池 / WhatsApp 对话 / Free consult 见面 / 首单 / 官网 organic / 小红书粉 / 视频号粉 / GBP review 等）
- 月度预算表 · 分项汇总

### 8. 生成"红线 · 30 天必做 3 件事"（deck 第捌章）

从短板章挑最紧急 3 条 · 每条独立 red callout · 后果说清楚（如"每晚 1 天送客给旧东家"）。

### 9. 套模板 · 输出 HTML

读 `plugins/me-client-discovery/templates/deck-template.html` · 用 mustache-style `{{tokens}}` 替换。

**CSS token 替换**：
- `--deep`（客户品牌 navy） → 客户品牌色 或 默认 #002542
- `--gold`（华人段 accent） → 默认 #A88342（服务业若非华人向可改）
- `--signal`（红线警报） → 默认 #C63A21

输出到：`docs/clients/{slug}/deck/{YYYY-MM-DD}/index.html`

同目录写 `_headers`（noindex + 缓存策略）· 供 /deploy-deck 打包用。

### 10. 输出给用户

```
Deck 合成完成 ✅

📁 输出：docs/clients/{slug}/deck/{date}/index.html
🎨 品牌色：{--deep} + {--gold}
📄 章节：8 章 · 竞争矩阵 {N}×{维度数} · 独家 lane：{有/无}

本地预览：`open docs/clients/{slug}/deck/{date}/index.html`

下一步：
- 部署公开链接：`/deploy-deck {slug}`
- 输出前先检查：`/sanity-check {slug}`
```

---

## 硬约束（CLAUDE.md 强约束的延续）

1. **绝不用其他客户案例代替本客户案例**（如把 Royal Heights 数据当 Bayside 用）
2. **数字必须有来源**（本次 discovery-scan JSON 或客户提供）· 无 → 标"typical range，需实际投放校准"
3. **短板章必须诚实**（不能只写武器不写短板）
4. **红线章必须列具体后果**（不是抽象说"重要" · 是"每晚 1 天送客给旧东家"）
5. **本地媒体章必须用 discovery-scan 的真实渠道**，不能替换成通用建议

## 未来 ME 兼容

Phase 2 后，`/synthesize-deck` 应该从 ME 后台 API 直接读 3 张表数据（而非本地文件）。
现在预留的合成逻辑 100% 通用 · Phase 2 只需在 Skill 里加一个"数据源=api"分支。
