---
name: discovery-scan
description: >-
  Magic Engine 新客户 Discovery 段扫盘 · 并行派 8 分身（4-5 竞对 + 市场速写 + 深挖 + 本地媒体）
  拿真实公开数据，输出 3 份结构化 JSON（competitor_snapshots × N / market_context × 1 /
  local_media_channels × N）到本地。Use when: 用户说「跑 discovery / 扫竞对 / 新客户接入调研
  / competitor scan / client discovery / 帮 X 做竞争分析 / 战场地图 / 白地图」，或者用户
  给了客户名 + 3-5 个竞对名 + 目标地理 · 都触发本 skill。跑完调用 /synthesize-deck 出 HTML。
---

# /discovery-scan — 新客户 Discovery 扫盘

**DAPE-D（Discovery）段的手工前身**。给新客户第一周或客户换战场时用。派 8 个分身并行调研，
输出可直接给 /synthesize-deck 消费的 3 份结构化 JSON。

**全程在本地** · 不会自动上传任何数据到云端。如需同步进 ME 后台请显式跑 /sync-to-me。

---

## 什么时候跑

- 用户显式触发：`/discovery-scan`，或说「跑 discovery / 扫竞对 / 战场地图 / 客户 X 竞争分析」
- **隐式兜底**：用户给了「客户 X 是做 XX 的，主要在 XX 区，竞争对手是 A/B/C/D」这种输入就直接触发
- **拒绝跑的场景**：只想查一个网站的具体数据 → 用 WebFetch；查代码 → 用 Explore；查 ME 后台已有客户 → 直接 SQL

---

## 沟通规则（强制）

1. **用简体中文对话**（除非用户明确用英文）
2. **一次只问一个问题**，等回答再问下一个 · 不要一口气抛 6 个字段
3. **可以留空**：用户答不上来的字段存 `null` 并在最终 JSON `data_gaps` 里显式标出
4. **绝不替用户编数据 · 绝不假设业务方向**（CTS queenstown inbound / Oztop vinyl-shutters 编数据事故教训 · CLAUDE.md 硬约束）

---

## 输入准备（6 字段 checklist · 全程一句一句问）

按顺序问，直到全部拿齐或用户明确说"没有就跳过"：

### Q1 客户名 + 一句话业务 + Slug
- 例：`Roman Hu / 华人四语房产中介 / roman-hu`
- Slug 用 kebab-case，用于文件夹命名。若用户没给，从姓名推断并让他确认。

### Q2 客户所属公司 / 品牌
- 例：`Ray White Mission Bay · Head of Projects`
- 若客户是独立品牌，写 `独立 / 无 franchise`

### Q3 目标地理（国家 + 区域名 + 具体 suburbs）
- 例：`NZ · Auckland Bayside + Central Gold · Mission Bay/Kohimarama/St Heliers/Glendowie/Remuera/Meadowbank/Ellerslie`
- 有地图截图更好（存本地供 deck 用）

### Q4 竞争对手名单（3-5 个）
- 每个：姓名 + 可选公司 · 例：`Aaron Foss (Barfoot)` / `Sarah Liu (Bayleys)`
- 不足 3 个 → 提醒用户"竞争矩阵会很稀疏"，建议补齐再跑

### Q5 客户已知短板 / 期望（选填）
- 例：`想通过 Meta 视频 + WhatsApp 建漏斗`
- 影响处方阶段（后续 /synthesize-deck 会用）

### Q6 ME 客户 ID（选填）
- 若客户已在 ME 后台 → 输入 `client_id` UUID
- 有 → 后续 /sync-to-me 可自动同步进 ME 表
- 无 → 独立跑，JSON 只落本地

---

## 输出目录（提前告诉用户）

```
docs/clients/{slug}/discovery/{YYYY-MM-DD}/
├── competitors/
│   ├── {competitor-slug-1}.json
│   ├── {competitor-slug-2}.json
│   └── ...
├── market-context.json
├── local-media-channels.json
├── raw-reports/                 ← 8 分身原始报告 md（合成 deck 后可删）
│   ├── competitor-1.md
│   ├── competitor-2.md
│   ├── market.md
│   ├── deep-dive-meta.md
│   └── local-media.md
└── manifest.json                ← 索引 + 全部 gaps 汇总
```

如果用户在 Cowork 模式，改用 Cowork outputs 目录。

---

## 执行流程（严格按顺序）

### 阶段 1 · 广扫盘（4-5 分身并行 · 单条消息发多个 Agent 调用）

**关键**：一条消息里发 N 个 Agent 调用 · 并行不串行 · 每个分身独立跑。

**每份 prompt 骨架**（参考 `docs/sops/client-discovery-scan.md` 第三章）：

```
调研 [目标地理] 的 [客户所属行业] [竞对姓名]，用于为新客户 [客户名] 做竞争分析。

用 WebSearch + WebFetch 拿真实公开数据（不能编）。查以下 10 项：
1. 挂在哪家公司？
2. 主打区域 / 覆盖 suburb
3. 语言 / 目标客群
4. 网上能查到的近 12 月成交 / 客单 / GMV
5. 个人网站 / 落地页 URL · 用 dig 亲验 DNS · 是否自有域名
6. Facebook / Instagram / LinkedIn 有没有个人品牌账号 · 粉丝数 / 内容频率
7. YouTube / TikTok / 小红书 / WeChat 有没有？
8. 是否付费投 Meta 广告（Meta Ad Library https://www.facebook.com/ads/library/?country=NZ 搜姓名）
9. review / testimonial（GBP / RateMyAgent / 行业口碑）
10. 差异化定位 + 明显短板

输出严格按 competitor-snapshot.schema.json 结构的 JSON · 顶层字段：
competitor_name / scanned_at / source ("plugin_manual") / positioning_oneliner /
company / regions / audience / recent_activity / personal_domain / social_media /
paid_ads / reputation / differentiators / weaknesses / source_links / data_gaps

【硬约束】
① 查不到就明说 "无公开数据" · 存 null / 标 data_gaps · 绝不编
② 无法验证的项（Meta Ad Library SPA / LinkedIn 999 / IG 精确粉丝需登录）
   如实标 data_gaps · 给出用户 15 秒可核的直达链接
③ DNS 用 dig 亲验（不是 Google 快照）

600 字以内报告 · 报告末尾附一份合法的 JSON 块（用 ```json ... ``` 包起）
```

**同一条消息里另加**：
- 市场速写分身（geography 输入相同 · 输出按 market-context.schema.json）
- （可选）本地媒体扫盘分身（若用户目标是 B2C 本地服务业则必派）

派 4 个竞对 + 1 市场 + 1 本地媒体 = **6 个分身并行**。

### 阶段 2 · 深挖（1-3 分身补漏）

第一波报告到齐后，读一遍找**最重要的盲点**：

- 有竞对 Meta 广告未验证 → 派 1 个深挖 Meta Ad Library + FB 内容策略
- 客户身份变化（如跳槽换所） → 派 1 个挖新东家 / 新头衔 / 集团资产
- 华人段渠道未拿全（小红书 / 微信 / 天维网 / Chinese Herald / 中文电视电台）→ 派 1 个

**第二波 prompt 必带这句**（防止分身误 delegate 空退）：
> 你是这次调研的**唯一执行人**，不要再 delegate 给别的 agent，也不要说 "agent launched"。
> 直接用你手上的 WebSearch + WebFetch 工具亲自查、亲自写报告。

### 阶段 3 · 主 session 合成（不派分身 · 亲自做）

从每份分身报告的 ```json``` 块解析出结构化数据 · 组装：

1. 每个 `competitors/{slug}.json` → 一个 competitor snapshot
2. `market-context.json` → 一份 market context
3. `local-media-channels.json` → 一个 array 每条是 local media channel

**加两个衍生字段**（合成阶段主 session 做，分身不做）：
- `weaknesses` 里跨竞对提取"共同盲点"（如"全部无个人域名"）→ 客户可利用的攻击面
- `local-media-channels.json` 按 `roi_rank` 排序（1-5）

### 阶段 4 · 写 manifest.json

```json
{
  "client": {"name": "...", "slug": "...", "id": null},
  "scanned_at": "2026-07-11T09:30:00+13:00",
  "geography": {...},
  "competitors_count": 4,
  "local_media_count": 8,
  "all_data_gaps": [...],
  "next_step": "run /synthesize-deck"
}
```

### 阶段 5 · 输出给用户

```
Discovery 扫盘完成 ✅

📁 输出：docs/clients/{slug}/discovery/{date}/
📊 竞对：{N} 份 competitor-snapshot JSON
🌍 市场：1 份 market-context JSON
📻 本地媒体：{M} 个渠道
⚠️ 未验证项：{K} 条（见 manifest.json.all_data_gaps）

下一步：
- 出 deck：`/synthesize-deck {slug}`
- 部署链接：`/deploy-deck {slug}`
- 同步进 ME 后台（需 client_id + ME_API_URL 环境变量）：`/sync-to-me {slug}`

红线检查建议先跑：`/sanity-check {slug}`（防编数据 / 防跨地理搬案例）
```

---

## 已知限制（用户跑之前必知）

- **Meta Ad Library 是 SPA 反爬** · WebFetch 抓不到详情 · 老实标"需人工 15 秒核"
- **LinkedIn HTTP 999** · 只能拿 Google 快照
- **RateMyAgent HTTP 403** · 只能拿分数字，深挖 review 内容需登录
- **IG / FB 精确粉丝需登录** · 未登录只能标"存在 + 大致量级"
- **Stats NZ 细分族群 % suburb 级** JS-loading · WebFetch 拉不到 · 用总亚裔 % 代替
- **付费 MCP（Ahrefs / Similarweb / Apollo）** 需 OAuth · 非交互 session 不可用 · 报告里提醒用户后续授权重跑

---

## Phase 兼容路线（跟未来 ME 系统怎么接）

- **Phase 0（今天）**：Plugin 独立跑 · 输出到 `docs/clients/{slug}/discovery/`
- **Phase 1（下月）**：ME 加 3 张表 + `/api/discovery/scan-results` endpoint · plugin 通过 /sync-to-me 可选 POST
- **Phase 2（Week 4+）**：客户详情页 Discovery tab 直接读 3 张表
- **Phase 3（Q1 2027 后）**：司马徽 agent 自动化 · 写同 schema · plugin 变成"admin 手工重扫"补漏工具

**Schema 一次定死**：本 skill 输出的 JSON = 未来 ME 表结构 = 未来司马徽产出结构 · 零改动无缝接管。

详见 `docs/FUTURE-ME-COMPAT.md`。
