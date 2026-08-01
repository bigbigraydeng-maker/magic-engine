# Magic Lab Token 计费系统

> 🗄️ **已归档 2026-07-25 — 不要按这份做。**
> MLT（Magic Lab Token）计费体系已被 **MTC（Magic Token Coin）** 取代。
> `MLT` 在 `src/` 中 0 引用，`MTC` 在 58 个文件里。现行设计见 [../specs/PHASE_20_MTC_SPEC.md](../specs/PHASE_20_MTC_SPEC.md)。


> 版本：v2.0 — 2026-05-10  
> 适用：所有 Magic Lab 陪跑客户（首个客户：CTS Tours）

---

## 一、核心理念

**Magic Lab Token（MLT）** 是 Magic Lab 向客户收费的统一计量单位。  
所有服务——AI 内容生成、视觉素材制作、策略报告、平台搭建——都以 MLT 计量，客户按消耗量支付。

```
1 Magic Lab Token（MLT）= $0.10 NZD
```

Token 制的好处：
- **透明**：客户清楚知道每项工作值多少，不打闷包
- **灵活**：AI 内容 / 人工策略 / 平台搭建，同一单位衡量
- **可积累**：未用完的 Token 自动滚入下月，不会浪费
- **竞争力**：价格对标 Canva Pro、Adobe Express 等自助工具

---

## 二、套餐结构（保底 + 超额）

| 套餐名 | 月保底 MLT | 月费（NZD） | 超额单价 | 适用客户 |
|--------|-----------|------------|---------|---------|
| **Free** | 0 | $0 | — | 潜在客户试用，限轻量层 |
| **Starter** | 2,000 | $200 | $0.12/MLT | 小型品牌，偶发需求 |
| **Growth** | 10,000 | $1,000 | $0.12/MLT | 活跃客户，持续内容产出 |
| **Scale** | 20,000 | $2,000 | $0.12/MLT | 高频客户，多平台运营 |

**规则说明：**
- 保底月费在每月 1 日预付
- 超额 MLT 于下月 15 日随账单结算
- 未用完的 MLT 顺延至下月（无过期）
- 超额单价比保底高 20%（$0.12 vs $0.10）—— 鼓励客户升档

---

## 三、服务费率卡（Token Rate Card）

> 定价逻辑：AI 生成成本（实际 API 费用）× 合理利润倍数，对标市场自助工具价格。

### 3.1 内容生成（Content Engine / Strategy Engine）

| 服务 | MLT | NZD 等值 | API 实际成本 | 说明 |
|------|-----|---------|------------|------|
| 社媒帖子（单篇，含配文）| 5 | $0.50 | ~$0.002 | Instagram / Facebook / LinkedIn |
| 社媒系列（5篇/批次）| 20 | $2.00 | ~$0.01 | 同一主题批量，批量优惠 |
| 邮件通讯（完整 HTML）| 60 | $6.00 | ~$0.05 | 含主题行、正文、CTA |
| 邮件序列（3封 drip）| 150 | $15.00 | ~$0.12 | 含逻辑分支设计 |
| 博客文章（800–1,200 词，SEO）| 80 | $8.00 | ~$0.047 | 含关键词优化，Claude Sonnet |
| 双信号博客（1,500+ 词，SEO+GEO）| 120 | $12.00 | ~$0.08 | 含隐藏 GEO 指令块 |
| 月度内容日历（30天规划）| 80 | $8.00 | ~$0.05 | 含平台分配建议 |
| 元描述批量优化（每5篇）| 40 | $4.00 | ~$0.01 | 含关键词意图分析 |

### 3.2 视觉素材（Visual Studio / Video Studio / Avatar Studio）

| 服务 | MLT | NZD 等值 | API 实际成本 | 说明 |
|------|-----|---------|------------|------|
| AI 图片（单张）| 10 | $1.00 | ~$0.05 | Atlas Cloud / Flux-dev |
| 海报套装（4张，同主题）| 30 | $3.00 | ~$0.20 | 批量折扣 |
| 海报套装（12张，同主题）| 80 | $8.00 | ~$0.60 | 大批量折扣 |
| 短视频 Reels（15–30s）| 80 | $8.00 | ~$1.09 | Seedance 2.0 |
| 头像视频（30–60s，品牌人物）| 120 | $12.00 | ~$1.65 | HeyGen |

### 3.3 平台搭建 & 集成（Setup & Integration）

> 此类服务含人工配置时间，价格反映专业服务价值。

| 服务 | MLT | NZD 等值 | 说明 |
|------|-----|---------|------|
| 邮件平台搭建（Mailchimp / Klaviyo）| 200 | $20 | 含模板、列表、自动化流程 |
| 社媒排期平台配置（Publishing Hub）| 100 | $10 | Publer API 接入 |
| Airtable 内容工作台搭建 | 200 | $20 | 含结构设计 + 自动化 |
| API 集成（新平台接入）| 200–300 | $20–30 | 按复杂度评估 |
| 网站分析埋点（GA4 / Meta Pixel）| 150 | $15 | 含验证测试 |

### 3.4 策略 & 咨询（Strategy Engine）

| 服务 | MLT | NZD 等值 | 说明 |
|------|-----|---------|------|
| 品牌底稿（Master Brief）| 150 | $15 | 一次性，新客户建档 |
| AI 可见度月报（AI Tracker）| 80 | $8 | 含 5 个 AI 引擎数据 |
| GEO 指令集（5条指令）| 50 | $5 | AI 推荐优化 |
| 月度策略复盘（1小时）| 100 | $10 | |
| 竞争对手分析报告 | 120 | $12 | Keyword Intelligence 驱动 |
| 关键词策略报告 | 80 | $8 | 含 KD、月搜量、意图分析 |

---

## 四、Airtable 账本结构

建议在 Airtable 创建 **Magic Lab Billing** 工作区，包含以下三张表：

### Table 1: Clients（客户主档）

| 字段 | 类型 | 说明 |
|------|------|------|
| Client Name | Single line | 客户名称 |
| Plan | Select | Free / Starter / Growth / Scale |
| Monthly MLT Included | Number | 保底 MLT 数（如 10,000） |
| Monthly Fee (NZD) | Number | 月保底金额 |
| Overage Rate (NZD/MLT) | Number | 超额单价（默认 0.12） |
| MLT Balance | Formula | 累计剩余 MLT |
| Next Invoice Date | Date | 下次账单日 |

### Table 2: MLT Ledger（消耗流水）

| 字段 | 类型 | 说明 |
|------|------|------|
| Date | Date | 服务完成日期 |
| Client | Link → Clients | |
| Service Category | Select | Content / Visual / Setup / Strategy |
| Service Description | Long text | 具体工作描述 |
| MLT Used | Number | 本次消耗 |
| Deliverable URL | URL | 成果链接（可选） |
| Notes | Long text | 备注 |
| Invoice Month | Formula | 归属账单月 |

### Table 3: Monthly Invoices（月度账单）

| 字段 | 类型 | 说明 |
|------|------|------|
| Invoice ID | Auto Number | 自动编号 |
| Client | Link → Clients | |
| Invoice Month | Date | 账单月份 |
| Retainer Fee (NZD) | Number | 月保底金额 |
| MLT Included | Number | 保底包含 MLT |
| MLT Used | Rollup | 本月实际消耗（来自 Ledger） |
| Overage MLT | Formula | max(0, Used - Included) |
| Overage Amount (NZD) | Formula | Overage MLT × Overage Rate |
| Total Amount (NZD) | Formula | Retainer + Overage Amount |
| Status | Select | Draft / Sent / Paid |

---

## 五、CTS Tours 首张账单草稿（2026年5月）

**客户：** CTS Tours New Zealand  
**账单周期：** 2026 年 4 月（5 月 15 日开具）  
**套餐：** Growth（10,000 MLT 保底，$1,000 NZD/月）

| # | 服务 | 类别 | 日期 | MLT | NZD 等值 | 备注 |
|---|------|------|------|-----|---------|------|
| 1 | Mailchimp 邮件平台搭建 | Setup | 4月 | 200 | $20 | 含模板、列表、自动化序列 |
| 2 | 海报套装（12张，社媒用）| Visual | 4月 | 80 | $8 | AI 生成 + 品牌定制 |
| 3 | 品牌底稿建档（Master Brief）| Strategy | 4月 | 150 | $15 | 首次建档，一次性费用 |
| 4 | 月度内容日历（五月排期）| Content | 4月 | 80 | $8 | 30天内容规划 |
| 5 | SEO 元描述优化（21篇）| Content | 4月 | 160 | $16 | 全站 Guide 页面（≈ 4组 × 40 MLT） |
| — | **本月合计** | | | **670 MLT** | **$67** | |

**账单计算：**
```
套餐保底费用：$1,000 NZD（包含 10,000 MLT）
本月实际消耗：670 MLT（占保底的 6.7%）
剩余 MLT 结转：9,330 MLT → 滚入 6 月
超额金额：$0

5 月账单总额：$1,000 NZD
```

> ⚠️ 注：70% 的保底 MLT 尚未使用。建议与 CTS 明确下月计划（AI Tracker 月报、SEO 博客系列、下一批海报），让 Token 利用率达到 30-50%，体现套餐价值。
>
> 如有其他已完成工作（请对照 Airtable / 项目记录补全），可能需要调整 MLT 数量。建议在开票前对照项目日志逐一核对。

---

## 六、给客户的沟通话术

**介绍 Token 制时的标准说法：**

> "我们用 Magic Lab Token（MLT）来衡量服务量。每个 Token 相当于 $0.10 NZD 的服务价值。你的 Growth 套餐每月包含 10,000 个 Token，价值 $1,000 NZD。
>
> 举个例子：生成一篇 SEO 博客文章是 80 个 Token（$8），生成 12 张社媒海报是 80 个 Token（$8），写一整月的内容日历是 80 个 Token（$8）——跟 Canva Pro 差不多，但你得到的是为你量身定制的专业内容，而不是模板。
>
> 未用完的 Token 会滚入下月，不会浪费。"

---

## 七、执行路线图

| 阶段 | 时间 | 工作内容 |
|------|------|---------|
| **Phase 1（本周）** | 2026-05-10–15 | 建立 Airtable 账本 + 补录 4 月所有服务 + 开具 CTS 首张账单 |
| **Phase 2（6月）** | 2026-06 | 把 Magic Engine 操作日志自动写入 Airtable Ledger（API 对接） |
| **Phase 3（Q3）** | 2026-Q3 | 客户 Portal 查看自己的 MLT 余额 + 月度报告嵌入账单 |

---

*本文档由 Magic Lab 内部使用。客户可见版本请移除内部 API 成本注释。*  
*关联文档：[PLATFORM_ARCHITECTURE.md](./PLATFORM_ARCHITECTURE.md) · [ROADMAP.md](./ROADMAP.md)*
