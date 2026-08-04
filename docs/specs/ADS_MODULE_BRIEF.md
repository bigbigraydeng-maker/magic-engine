# Magic Engine — 广告模块开发计划

> 模块：广告（Ads Intelligence）· 对外封装名：**Ads Intelligence**
> 创建日期：2026-05-12 · 状态：Phase 8.P 激活（原暂缓）
> 第一个测试客户：Mobilestation（NZ，Google Ads，34/100 健康度）

---

## 一、模块定位

广告模块是 Magic Engine 四大模块之一，核心价值：

**让客户在 ME 后台连接广告账户 → AI 自动诊断 → 简单问题一键 Fix → 复杂问题 Talk to Us**

与竞品工具的差异：
- ❌ 不是 BI 报表工具（不只看数据）
- ❌ 不是自动化投放平台（不接管预算决策）
- ✅ 是**诊断 + 行动建议 + 有界 Fix**的闭环系统
- ✅ 保留人工陪跑的专业门槛（复杂问题由 Magic Lab 处理）

---

## 二、平台接入优先级

| 优先级 | 平台 | 接入方式 | 当前状态 | 预计工期 |
|--------|------|---------|---------|---------|
| P1 | **Meta Ads** | Meta Marketing API v21 + MCP 已连接 | 🟢 可立即开始 | 2 周 |
| P2 | **Google Ads** | Google Ads API v17（GAQL）+ Developer Token | 🟡 需申请 developer token（1-2周审核） | 3 周（申请期并行开发 Mock） |
| P3 | **TikTok Ads** | TikTok Marketing API v1.3 | 🔴 需申请 API access | 后续 |
| P4 | **LinkedIn Ads** | LinkedIn Marketing API | 🔴 需申请 API access | 后续 |

**建议：** P1 Meta + P2 Google 并行规划，Meta 先上线，Google token 审核期间完成前端 UI。

---

## 三、数据库设计

### 3.1 新增表

```sql
-- 广告账户连接（每客户可连多个平台）
CREATE TABLE public.ad_accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  platform        text NOT NULL CHECK (platform IN ('google', 'meta', 'tiktok', 'linkedin')),
  account_id      text NOT NULL,      -- 平台账户 ID
  account_name    text,               -- 账户显示名
  currency        text DEFAULT 'NZD',
  timezone        text DEFAULT 'Pacific/Auckland',
  -- OAuth token（加密存储）
  access_token    text,               -- 加密后存储，应用层解密
  refresh_token   text,
  token_expires_at timestamptz,
  -- 状态
  status          text DEFAULT 'active' CHECK (status IN ('active', 'disconnected', 'error')),
  last_sync_at    timestamptz,
  error_message   text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  UNIQUE(client_id, platform, account_id)
);

-- 诊断运行记录
CREATE TABLE public.ad_diagnostics (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES clients(id),
  ad_account_id   uuid NOT NULL REFERENCES ad_accounts(id),
  platform        text NOT NULL,
  period_start    date NOT NULL,
  period_end      date NOT NULL,
  health_score    integer,            -- 0-100
  health_grade    text,               -- 优秀/良好/需改善/高风险
  -- 诊断维度 JSON
  dimensions      jsonb,              -- {conversion_tracking, campaign_structure, keywords, ...}
  -- 优先级建议
  p0_items        jsonb DEFAULT '[]', -- [{issue, impact, action, expected_result}]
  p1_items        jsonb DEFAULT '[]',
  p2_items        jsonb DEFAULT '[]',
  -- 元数据
  data_source     text DEFAULT 'api'  CHECK (data_source IN ('api', 'csv_upload')),
  raw_summary     jsonb,              -- 原始指标快照（花费、点击、CPC、CTR 等）
  report_url      text,               -- 生成的 Word 报告 Supabase Storage URL
  status          text DEFAULT 'complete' CHECK (status IN ('running', 'complete', 'failed')),
  created_at      timestamptz DEFAULT now()
);

-- Fix 行动记录
CREATE TABLE public.ad_actions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  diagnostic_id   uuid NOT NULL REFERENCES ad_diagnostics(id),
  client_id       uuid NOT NULL REFERENCES clients(id),
  ad_account_id   uuid NOT NULL REFERENCES ad_accounts(id),
  platform        text NOT NULL,
  action_type     text NOT NULL,      -- 'pause_keyword' | 'add_negative' | 'adjust_bid' | 'pause_ad' | ...
  action_payload  jsonb NOT NULL,     -- 具体操作参数（keyword_id, bid_adjustment 等）
  description     text,               -- 人读描述（"暂停亏损关键词 'mobile repair'，节省 NZ$45/月"）
  priority        text CHECK (priority IN ('P0', 'P1', 'P2')),
  status          text DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'executing', 'done', 'failed', 'dismissed')),
  approved_by     text,               -- 操作人
  executed_at     timestamptz,
  result          jsonb,              -- 执行结果（platform API response 摘要）
  error_message   text,
  created_at      timestamptz DEFAULT now()
);

-- 自动触发器
CREATE TRIGGER ad_accounts_updated_at
  BEFORE UPDATE ON public.ad_accounts
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
```

### 3.2 关键设计决策

- **Token 加密**：access_token / refresh_token 在应用层用 AES-256 加密，密钥存 `AD_TOKEN_ENCRYPTION_KEY` 环境变量，数据库存密文
- **多账户**：同一客户可连多个平台多个账户（如一个客户有 Google + Meta 两个账户）
- **CSV 兜底**：`data_source = 'csv_upload'` 允许在 API 未接通时上传 CSV 完成诊断（已有 Cowork 插件实现）

---

## 四、API 路由设计

```
# 账户连接 OAuth 流程
GET    /api/clients/[id]/ads/connect/[platform]        → 生成 OAuth 授权 URL，跳转平台
GET    /api/ads/callback/[platform]                    → OAuth callback，存储 token
DELETE /api/clients/[id]/ads/accounts/[accountId]      → 断开账户连接

# 账户管理
GET    /api/clients/[id]/ads/accounts                  → 列出已连接账户
PATCH  /api/clients/[id]/ads/accounts/[accountId]      → 更新账户配置

# 诊断
POST   /api/clients/[id]/ads/diagnose                  → 触发 API 诊断（异步）
GET    /api/clients/[id]/ads/diagnostics               → 诊断历史列表
GET    /api/clients/[id]/ads/diagnostics/[diagId]      → 单次诊断详情
POST   /api/clients/[id]/ads/diagnostics/upload        → CSV 上传触发诊断（兜底）

# Fix 操作
GET    /api/clients/[id]/ads/diagnostics/[diagId]/actions → 可执行 Fix 清单
POST   /api/clients/[id]/ads/actions/[actionId]/execute   → 执行单个 Fix
POST   /api/clients/[id]/ads/actions/batch-execute         → 批量执行（勾选多个）
PATCH  /api/clients/[id]/ads/actions/[actionId]            → 更新状态（dismiss 等）
```

---

## 五、前端页面设计

```
/dashboard/clients/[id]/ads
├── Tab 1: 账户连接 (Connected Accounts)
│   ├── Platform 卡片（Google / Meta / TikTok / LinkedIn）
│   ├── 已连接：显示账户名 + 最后同步时间 + 断开按钮
│   └── 未连接：Connect 按钮 → OAuth 跳转
│
├── Tab 2: 诊断 (Diagnostics)
│   ├── 健康度总分卡（大字显示 34/100 高风险）
│   ├── 9 维度雷达图 / 进度条
│   ├── 历史诊断列表（按时间）
│   └── [运行诊断] 按钮 → 触发 API or CSV 上传
│
└── Tab 3: 行动建议 (Action Center)
    ├── P0 优先处理（红色）
    ├── P1 近期处理（黄色）
    ├── P2 计划优化（蓝色）
    └── 每条建议：描述 + 预期收益 + [Fix] / [Talk to Us] 按钮
```

---

## 六、Fix vs Talk to Us 边界定义

### ✅ Fix（系统可安全自动执行）

| 操作 | 平台 | API 调用 | 可逆 |
|------|------|---------|------|
| 暂停亏损关键词 | Google | `mutate_keywords` | ✅ |
| 添加否定关键词 | Google | `mutate_campaign_criteria` | ✅ |
| 暂停深夜时段出价 | Google | `mutate_ad_group_bid_modifiers` | ✅ |
| 暂停亏损广告 | Meta/Google | 对应 API | ✅ |
| 调整设备出价（±20%以内） | Google | `mutate_campaign_bid_modifier` | ✅ |
| 添加受众信号（PMax） | Google | `mutate_asset_groups` | ✅ |

### 🔴 Talk to Us（需要 Magic Lab 人工介入）

- 广告系列结构重组（拆分 / 合并）
- 月度预算重新分配（超过 ±30%）
- 创意素材更换（需要新设计）
- 投放策略调整（手动出价 ↔ 智能出价）
- 账户审核问题（广告被拒）

---

## 七、开发阶段计划

### Stage 1：CSV 诊断上线（2 周，可立即开始）

**目标**：把 Cowork 插件的诊断能力迁移进 ME Dashboard，无需 API 连接

- [ ] **S1.1** 新建数据库表（ad_accounts, ad_diagnostics, ad_actions）
- [ ] **S1.2** CSV 上传 API：`POST /api/clients/[id]/ads/diagnostics/upload`
  - 解析 15 种 Google Ads CSV 格式
  - 运行 9 维度诊断（复用 Cowork 插件逻辑，Node.js 重写为 TypeScript）
  - 计算健康度评分（NZ 市场基准）
- [ ] **S1.3** 前端：Ads Tab 基础框架 + CSV 上传 UI + 诊断结果展示
- [ ] **S1.4** 诊断报告：在 ME 内生成 Word 报告（复用现有 docx 生成逻辑）
- [ ] **S1.5** 用 Mobilestation 数据端到端验证

**交付物**：ME Dashboard 内可上传 CSV → 看诊断结果 → 下载报告

---

### Stage 2：Meta Ads OAuth 接入（2 周）

**目标**：客户在 ME 后台连接 Meta 广告账户，实时拉取数据

- [ ] **S2.1** Meta OAuth 流程（Facebook Login → 权限 `ads_read, ads_management`）
  - `GET /api/clients/[id]/ads/connect/meta` → 跳转 Facebook OAuth
  - `GET /api/ads/callback/meta` → 存储加密 token
- [ ] **S2.2** Meta Ads 数据拉取（Marketing API v21）
  - 拉取 campaigns / ad_sets / ads 层级数据
  - 拉取 insights（花费、点击、CPM、CTR、转化）
  - 拉取 account insights（30天时序）
- [ ] **S2.3** Meta 诊断引擎（基于 Google Ads 诊断框架适配）
  - Meta 特有维度：像素配置、受众质量、广告素材多样性、CPM vs 同行
  - Meta 基准值（NZ 市场：CPM / CTR / ROAS）
- [ ] **S2.4** Meta Fix 执行（API 写操作）
  - 暂停表现差的 Ad Set / Ad
  - 添加受众排除
  - 调整出价策略（预算限额）

**交付物**：客户点击 Connect Meta → 系统自动拉取并诊断 → 一键 Fix 简单问题

---

### Stage 3：Google Ads API 接入（3 周，含申请期）

**前提**：Developer Token 申请（官方审核约 1-2 周，申请地址：Google Ads API Center）

- [ ] **S3.0** 立即提交 Developer Token 申请（不阻塞其他开发）
- [ ] **S3.1** Google OAuth 流程（scope: `https://www.googleapis.com/auth/adwords`）
- [ ] **S3.2** Google Ads API 客户端（GAQL 查询封装）
  - 复用 Cowork 插件的 9 维度诊断逻辑，转为 GAQL 实时查询
  - 替换 CSV 解析逻辑，保持诊断框架不变
- [ ] **S3.3** Google Fix 执行（mutate 操作）
  - 实现上表中所有 Fix 类型
  - 每次 Fix 前写入 `ad_actions` 记录（审计日志）
  - Fix 后自动标记对应 P0/P1/P2 建议为 done

**交付物**：Google Ads 账户实时诊断 + 一键 Fix（覆盖 P0 全部 3 种场景）

---

### Stage 4：Talk to Us 流程（1 周）

**目标**：复杂问题有标准化交接流程，不只是"联系我们"

- [ ] **S4.1** Talk to Us 点击 → 创建内部工单（写入数据库，关联诊断记录）
- [ ] **S4.2** 自动生成工单摘要（AI 总结诊断背景 + 客户问题）
- [ ] **S4.3** 通知系统（内部 Slack / Email）
- [ ] **S4.4**（可选）客户侧简单反馈表单

---

## 八、新增环境变量

```env
# 广告平台 OAuth
META_APP_ID=              # Facebook Developer App ID
META_APP_SECRET=          # Facebook Developer App Secret
META_REDIRECT_URI=https://magic-engine.onrender.com/api/ads/callback/meta

GOOGLE_ADS_CLIENT_ID=     # Google OAuth 2.0 Client ID
GOOGLE_ADS_CLIENT_SECRET= # Google OAuth 2.0 Client Secret
GOOGLE_ADS_DEVELOPER_TOKEN=  # 申请获得
GOOGLE_ADS_REDIRECT_URI=https://magic-engine.onrender.com/api/ads/callback/google

# Token 加密
AD_TOKEN_ENCRYPTION_KEY=  # 32 字节随机密钥（openssl rand -base64 32）
```

---

## 九、NZ 市场基准（广告模块专用）

> 已在 Cowork 插件 benchmarks.md 中定义，复用到 ME 内部 `src/lib/ads/benchmarks.ts`

| 指标 | 优秀 | 良好 | 警告 | 危险 |
|------|------|------|------|------|
| Search CTR | >8% | 5-8% | 2-5% | <2% |
| PMax CTR | >3% | 1.5-3% | 0.8-1.5% | <0.8% |
| Search CPC | <NZ$1.00 | $1.00-1.50 | $1.50-2.50 | >NZ$2.50 |
| 转化率 | >3% | 1-3% | 0.3-1% | <0.3% |
| 有效关键词占比 | >60% | 40-60% | 20-40% | <20% |
| PMax 预算占比 | 50-70% | 70-85% | >85%无转化数据 | — |

---

## 十、与其他模块集成点

```
广告模块 ─────────────────────────── 数据模块（月报）
ad_diagnostics.health_score       ─→ 月报广告板块（健康度趋势）
ad_diagnostics.p0_items           ─→ 月报行动摘要
ad_actions（done 状态）           ─→ 月报"本月优化了什么"

广告模块 ─────────────────────────── SEO 模块
ad_diagnostics.raw_summary.keywords ─→ 识别高 CPC 词 → Keyword Intelligence 查询有机机会
（广告烧钱但 SEO 有机会 → 内容策略建议）

广告模块 ─────────────────────────── 社媒模块
Meta Ads 受众数据 → 社媒内容方向参考（哪类受众转化好）
```

---

## 十一、参考资料

- Cowork 插件（已完成的诊断逻辑）：`outputs/magic-engine-ads-diagnostics/`
- Mobilestation 诊断报告（验证用）：`Mobilestation_GoogleAds诊断报告_20260512.docx`
- Google Ads API Developer Token 申请：https://ads.google.com/aw/apicenter
- Meta Marketing API 文档：https://developers.facebook.com/docs/marketing-api
- NZ 市场基准定义：`outputs/magic-engine-ads-diagnostics/skills/ads-diagnostic/references/benchmarks.md`
