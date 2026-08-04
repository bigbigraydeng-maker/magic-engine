# Phase 20 — Magic Token Coin & Self-Serve Portal

> **登记日期**：2026-05-25 · **状态**：方案已完成，待 PM 排期开工
>
> **决策来源**：2026-05-25 与 PM 完整讨论，所有关键决策已拍板

---

## 一、战略定位

Magic Engine 当前只服务 FDE 陪跑客户（人工建档、月度合约）。Phase 20 新增 **C 端自助层**，让 AU/NZ 本地商家从广告进来后，用 Magic Token Coin（MTC）自助体验和购买内容生成服务，形成 Tier 1 → Tier 2 → Tier 3 的完整漏斗。

```
┌─────────────────────────────────────────────────────┐
│ Tier 1：Discovery 免费层                            │
│ 入口：张骞 Discovery（广告落地页）                   │
│ 给客户：诊断报告 + 处方 + Master Brief              │
│ 成本：$0（注册赠 100 MTC，验证邮箱后发放）          │
│ 目的：Lead capture + 建立信任                      │
├─────────────────────────────────────────────────────┤
│ Tier 2：MTC 自助生成层 ⭐ Phase 20 核心             │
│ 入口：充值 MTC，自助使用所有内容生成功能             │
│ 给客户：图片 / Reels / SEO 博客 / 社媒内容 / 策略   │
│ 成本：按功能消耗 MTC，无月费                        │
│ 目的：转化变现 + 持续复购                          │
├─────────────────────────────────────────────────────┤
│ Tier 3：FDE 全托管层                               │
│ 入口：Talk to Us（情境触发）                        │
│ 给客户：FDE 全程操盘 Campaign，月度合约             │
│ 成本：月度合约（现有 FDE 体系）                    │
│ 目的：高客单 + 案例沉淀                            │
└─────────────────────────────────────────────────────┘

漏斗预期：Tier 1 大盘 → 10% 转 Tier 2 → 1% 升 Tier 3
```

**差异化护城河**（vs ChatGPT / 豆包）：
- Master Brief = 品牌记忆，一次建档，每次生成自动带入品牌 DNA，用户无需重复解释
- AU/NZ 本地化语料 + 地域信号（NZST / AEST / AU 英语拼写）
- 跨行业证明机制库，每接一个新行业客户，模板库就更厚一层
- 多功能一站式：图片 + 视频 + SEO 文章 + 社媒内容，同一品牌上下文

---

## 二、Magic Token Coin（MTC）设计

### 2.1 基础定价

```
$29 NZD = 300 MTC   （试水包，最低门槛）
$79 NZD = 1,200 MTC （主力包）
$199 NZD = 3,500 MTC（重度包）

1 MTC ≈ $0.097 NZD
注册赠送：100 MTC（验证邮箱后发放）
```

### 2.2 核心规则

- **无月费**：Tier 2 用户只买 MTC，不设月度订阅
- **有效期**：每次购买单独计时，自购买日起 12 个月，先买先过期（FIFO 扣款）
- **退款规则**：API 生成失败（Atlas Cloud / Seedance 返回错误）→ 100% 退还消耗的 MTC；生成成功但用户不满意 → 不退款，提供"重新生成"按钮（不扣费重试一次）
- **支付系统**：Stripe（一次性支付，非订阅）
- **防刷号**：注册后须验证邮箱，验证通过才发放 100 MTC

### 2.3 注册 100 MTC 的消耗路径设计

```
新用户进来 →
  张骞 Discovery（免费，不扣 MTC）
  诸葛亮处方（免费，不扣 MTC）
  Master Brief 建档（免费，不扣 MTC）
  Reels 提示词预览（免费，看到提示词）
    ↓
  生成 5 张图（消耗 50 MTC，剩 50）
    ↓
  "生成一条 Reels 需要 80 MTC，你还剩 50"
    ↓ 自然触发充值墙
  $29 试水包（300 MTC）
```

---

## 三、功能消费表（MTC Rate Card）

### 免费功能（不扣 MTC）

| 功能 | 说明 |
|------|------|
| 张骞 Discovery（网站扫描 + 6维诊断） | Lead capture 核心入口 |
| 诸葛亮处方（策略处方报告） | 诊断结果 + 行动建议 |
| Master Brief 首次建档 | 品牌 DNA 档案，一次性 |
| Reels 提示词预览（纯文字，不生成视频） | 体验门槛，诱导充值生成视频 |

### 策略规划（Strategy Engine）

| 功能 | MTC | NZD 等值 |
|------|-----|---------|
| Master Brief 更新 / 刷新 | 20 | ~$1.94 |
| 月度 Marketing Plan（30天） | 30 | ~$2.91 |
| 竞争对手分析报告 | 40 | ~$3.88 |
| 关键词策略报告 | 30 | ~$2.91 |
| GEO 指令集（5条 AI 推荐优化） | 20 | ~$1.94 |

### 文字内容生成（Content Engine）

| 功能 | MTC | NZD 等值 | 说明 |
|------|-----|---------|------|
| 社媒单帖（含配文 + CTA） | 5 | ~$0.49 | Instagram / Facebook / LinkedIn |
| 社媒系列（5篇，同主题批量） | 20 | ~$1.94 | 批量折扣，省 5 MTC |
| 月度内容日历（30天排期） | 30 | ~$2.91 | 含平台分配建议 |
| SEO 博客文章（800–1,200 词） | 40 | ~$3.88 | Claude Sonnet，含关键词优化 |
| 双信号博客（1,500+ 词，SEO + GEO） | 60 | ~$5.82 | 含隐藏 GEO 指令块，核心差异化产品 |
| 元描述批量优化（每 5 篇） | 15 | ~$1.46 | 含关键词意图分析 |

### Visual Studio（AI 图片）

| 功能 | MTC | NZD 等值 | 说明 |
|------|-----|---------|------|
| AI 图片 单张 | 10 | ~$0.97 | Atlas Cloud / Flux-dev |
| 海报套装（4张，同主题） | 30 | ~$2.91 | 省 10 MTC vs 单张×4 |
| 海报套装（12张，同主题） | 70 | ~$6.79 | 省 50 MTC，大批量折扣 |

### Video Studio（Seedance 2.0 图生视频）

| 功能 | MTC | NZD 等值 | 说明 |
|------|-----|---------|------|
| Storyboard 生成（9格，含提示词） | 5 | ~$0.49 | 视频制作前置步骤 |
| Reels 视频（封顶 15s，I2V） | 80 | ~$7.76 | Seedance 2.0，核心付费产品 |

### SEO 工具（Keyword Intelligence）

| 功能 | MTC | NZD 等值 |
|------|-----|---------|
| SEO Gap 分析 | 30 | ~$2.91 |
| AI 可见度追踪月报（AI Tracker） | 40 | ~$3.88 |

### 暂缓 / 保留 FDE 专属

| 功能 | 原因 |
|------|------|
| 鲁班 Kanban | 全部导流 FDE，不对 Tier 2 开放 |
| 邮件 / Newsletter 营销 | 服务商未定，暂缓 |
| 文章发布到网站（WordPress / Shopify） | 用户自行复制，不开发此功能 |
| HeyGen 头像视频 | 暂不对 C 端开放 |

---

## 四、数据库设计

### 4.1 `clients` 表（扩展现有）

新增字段：

```sql
ALTER TABLE clients
  ADD COLUMN source TEXT NOT NULL DEFAULT 'fde'
    CHECK (source IN ('fde', 'self_serve')),
  ADD COLUMN stripe_customer_id TEXT,
  ADD COLUMN email_verified_at TIMESTAMPTZ;
```

### 4.2 `mtc_purchases` 表（新建）

```sql
CREATE TABLE mtc_purchases (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  stripe_payment_intent_id TEXT UNIQUE,           -- Stripe 幂等键
  package_key           TEXT NOT NULL,             -- 'starter_29' | 'growth_79' | 'scale_199'
  amount_nzd            NUMERIC(8,2) NOT NULL,
  mtc_amount            INT NOT NULL,              -- 购买的 MTC 数量
  mtc_remaining         INT NOT NULL,              -- 剩余可用 MTC（FIFO 扣减后更新）
  purchased_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at            TIMESTAMPTZ NOT NULL,      -- purchased_at + 12 months
  status                TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'refunded', 'expired')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mtc_purchases_client_expires
  ON mtc_purchases(client_id, expires_at)
  WHERE status = 'completed';
```

### 4.3 `mtc_ledger` 表（新建）

```sql
CREATE TABLE mtc_ledger (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  purchase_id       UUID REFERENCES mtc_purchases(id), -- FIFO 关联的具体购买批次
  direction         TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
  service_key       TEXT NOT NULL,   -- 'blog_seo' | 'blog_dual_signal' | 'image_single' | 'reels_video' | ...
  mtc_amount        INT NOT NULL,    -- 消耗或退还的 MTC 数量（正整数）
  reference_id      UUID,            -- 关联内容 ID（如 blog_posts.id / image 生成 ID）
  source            TEXT NOT NULL DEFAULT 'auto'
    CHECK (source IN ('auto', 'manual', 'refund', 'bonus')),
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mtc_ledger_client ON mtc_ledger(client_id, created_at DESC);
```

### 4.4 `stripe_events_log` 表（新建，幂等保护）

```sql
CREATE TABLE stripe_events_log (
  stripe_event_id   TEXT PRIMARY KEY,   -- Stripe event.id，天然唯一
  event_type        TEXT NOT NULL,
  processed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status            TEXT NOT NULL CHECK (status IN ('processed', 'skipped', 'failed')),
  error_message     TEXT
);
```

### 4.5 MTC 余额计算逻辑（FIFO）

```typescript
// src/lib/mtc/balance.ts
// 余额 = 所有未过期购买批次的 mtc_remaining 之和
async function getMtcBalance(clientId: string): Promise<number> {
  const { data } = await supabase
    .from('mtc_purchases')
    .select('mtc_remaining')
    .eq('client_id', clientId)
    .eq('status', 'completed')
    .gt('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: true }) // 先过期的先用
  return data?.reduce((sum, p) => sum + p.mtc_remaining, 0) ?? 0
}

// 扣款时从最早过期的批次开始扣
async function deductMtc(clientId: string, amount: number, serviceKey: string, referenceId?: string) {
  // 1. 锁定最早过期且有余量的批次
  // 2. 更新 mtc_remaining
  // 3. 写入 mtc_ledger（direction: 'debit'）
  // 4. 若余量不足，跨批次扣减
}
```

---

## 五、开发批次

### Phase 20.A — 地基（约 1 周，5 个 commit）

| ID | 任务 | 依赖 |
|----|------|------|
| **P20.A.1** | DB migrations：`clients` 扩展 + `mtc_purchases` + `mtc_ledger` + `stripe_events_log` | — |
| **P20.A.2** | Stripe 产品配置（3个价格点）+ Webhook handler（`/api/stripe/webhook`）+ `stripe_events_log` 幂等保护 | P20.A.1 |
| **P20.A.3** | 自助注册 API（`POST /api/auth/register`）+ 邮箱验证（`POST /api/auth/verify-email`）+ 验证后自动发放 100 MTC bonus | P20.A.1 |
| **P20.A.4** | MTC 余额 API（`GET /api/mtc/balance`）+ FIFO 扣款函数（`src/lib/mtc/deduct.ts`）+ 退还函数（`src/lib/mtc/refund.ts`） | P20.A.1 |
| **P20.A.5** | Stripe Checkout Session 创建（`POST /api/mtc/checkout`）+ 支付成功后写入 `mtc_purchases` | P20.A.2 |

**M1 验收**：`npm run build` 通过 + Supabase 后台可见 3 张新表 + Stripe test mode 支付成功后 `mtc_purchases` 有记录

### Phase 20.B — 用户界面（约 1 周，5 个 commit）

| ID | 任务 | 依赖 |
|----|------|------|
| **P20.B.1** | 自助注册 / 登录页（`/register` + `/login`，self_serve 用户专用，独立于 FDE 后台） | P20.A.3 |
| **P20.B.2** | MTC 钱包页（`/dashboard/wallet`）：余额显示 + 消耗历史 + 充值按钮（跳 Stripe） | P20.A.4/5 |
| **P20.B.3** | Stripe Checkout 完整流程：跳转 → Stripe 托管页 → 支付成功跳回 `/dashboard/wallet?success=1` | P20.A.5 |
| **P20.B.4** | 各生成 API 接入 MTC 扣费：前置余额检查（不足则 422 + 提示充值）+ 生成成功后自动扣款 | P20.A.4 |
| **P20.B.5** | 生成失败自动退还：捕获 Atlas / Seedance API 异常 → 调 `refund.ts` → 写 `mtc_ledger`（direction: 'credit'） | P20.B.4 |

**M2 验收**：注册 → 验证邮箱 → 看到 100 MTC 余额 → 充值 $29 → 余额变 400 → 生成一张图 → 余额减 10

### Phase 20.C — 收尾（约 3–4 天，4 个 commit）

| ID | 任务 | 依赖 |
|----|------|------|
| **P20.C.1** | Talk to Us 情境触发：连续 3 次生成视频 / 消耗超 500 MTC / SEO 分析发现重大缺口 → 弹出 FDE 咨询入口 | P20.B.4 |
| **P20.C.2** | Magic Lab Class 入口：诸葛亮处方页面旁嵌入 Skool 课程卡片（静态链接，不需要集成） | P20.B.1 |
| **P20.C.3** | MTC 过期预警邮件：到期前 30 天发邮件提醒（Resend，在 handler 内部初始化） | P20.A.1 |
| **P20.C.4** | 管理员视图：`/admin/self-serve-users`，列出所有 `source = 'self_serve'` 用户、余额、充值记录 | P20.B.2 |

**M3 验收**：完整用户路径跑通（注册 → 体验 → 充值 → 生成 → Talk to Us 触发）+ 管理员能查所有 C 端用户

---

## 六、技术约束

- Stripe 客户端 **必须在 handler 内部初始化**，不在模块顶层（与项目规范一致）
- `stripe_events_log` 保证 Webhook 幂等，同一 `event_id` 只处理一次
- MTC 扣款必须在数据库事务内完成（防止并发超扣）
- 自助注册用户与 FDE 客户共用 `clients` 表，通过 `source` 字段区分
- 所有 `/api/mtc/*` 路由必须通过 `requireSession()` + 校验 `client_id` 归属（Phase 19 IDOR 修复标准）
- Stripe webhook 签名必须验证（`stripe.webhooks.constructEvent`），防止伪造请求

---

## 七、不做清单

- ❌ 月度订阅制（Tier 2 只有 Token 包，无月费）
- ❌ 鲁班 Kanban 对 C 端开放（全部导流 FDE Talk to Us）
- ❌ 邮件 / Newsletter 营销功能（服务商未选定）
- ❌ 文章一键发布到网站（用户自行复制，不开发）
- ❌ HeyGen 头像视频对 C 端开放
- ❌ Token 共享 / 转赠（账户隔离）
- ❌ 退款到银行卡（只退回 MTC 余额，不做法币退款）
- ❌ 多货币支持（只支持 NZD，Phase 20 范围内）

---

## 八、前置验证（开发前必做）

**双信号博客质量验证**（无需代码，纯手动）：

选取 CTS Tours 一个真实 SEO 关键词（月搜量 100–1,000，KD < 40），用现有 Blog Studio 生成一篇双信号博客，对照以下检查清单：

| 检查项 | 标准 |
|--------|------|
| 字数 | 1,500+ 词 |
| 语言 | AU/NZ 英语拼写（colour / organise / travelling） |
| 关键词密度 | 主词出现 3–5 次，不堆砌 |
| GEO 指令块 | 文末有隐藏指令，含品牌名 + 地域标签 |
| 结构 | H1 含主词，H2 覆盖长尾，有 FAQ 段落 |
| 品牌声音 | 与 CTS Master Brief 调性吻合 |
| 本地信号 | 提到 New Zealand / NZ 不少于 5 次 |

验证通过后，双信号博客功能才正式开放给 C 端。

---

## 九、关联文档

- [ROADMAP.md](../ROADMAP.md) — Phase 20 摘要条目
- [archive/BILLING_TOKEN_SYSTEM.md](../archive/BILLING_TOKEN_SYSTEM.md) — MTC 原始设计文件（FDE 版本参考）
- [ARCHITECTURE.md](../ARCHITECTURE.md) — 技术架构总览
- [CLAUDE.md](../../CLAUDE.md) — 当前焦点与工作协议
