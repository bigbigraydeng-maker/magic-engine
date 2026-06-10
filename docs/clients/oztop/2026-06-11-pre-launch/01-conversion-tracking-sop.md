# Oztop · Conversion Tracking 配置 SOP（Google Ads + Meta CAPI 双轨）

> **执行人**：PM + FDE（如需 WP 后台改）
> **预估工时**：4-6 小时（含 24h 数据观察）
> **完成证据**：4 个 conversion 事件在 Google Ads + Meta Events Manager 都能看到真实数据
> **触发**：Oztop Google Ads + Meta Ads 上线前**强制**完成（你已确认"先搭 Conversion 再投"）

---

## 0 · 总体架构

```
              用户在 Oztop 站点操作
                       ↓
          oztopbuildingsupplies.com.au
                       ↓
           ┌───────────┴───────────┐
           ↓                       ↓
      GTM 容器 (推荐)         WP plugin (替代)
   GTM-XXXXXXX                
           │                       │
           ├─→ Google Ads gtag     ├─→ Meta Pixel
           │   (Conversion fire)   │   (browser-side)
           │                       │
           └─→ Google Analytics    └─→ Meta CAPI
               (GA4)                   (server-side)
                                       
   ┌───────────────────────────────────────────┐
   │ 4 Conversion Events (统一)：                │
   │                                            │
   │ 1. Free Measure Booking (Primary, AU$500)  │
   │ 2. Quote Request        (Primary, AU$300)  │
   │ 3. Phone Call >30s      (Secondary, AU$200)│
   │ 4. WhatsApp Click       (Secondary, AU$100)│
   └───────────────────────────────────────────┘
```

**为什么 GTM**：一套配置同时打 Google + Meta + GA4，比"装 3 套独立 pixel"维护成本低很多。

**为什么 Meta CAPI 必须装**：2025 后 iOS 14.5+ + Safari ITP 让 browser-side Pixel 数据丢失 40%+。Server-side CAPI 是 Meta 推荐做法，**配 deduplication 后 + 浏览器 Pixel 形成双保险**。

---

## Step 1 · 前置准备（30 min）

### 1.1 · 拿到 4 个关键 ID

| 项 | 来源 | 谁拿 |
|---|---|---|
| Google Ads Conversion ID（AW-XXX）+ Conversion Label | Google Ads 后台建完 Conversion 后给 | PM 操作 |
| GA4 Measurement ID（G-XXXXXXX）| GA4 admin → Data Stream | PM（看 ME 之前是不是已有，建议复用） |
| Meta Pixel ID（XXXXXXXXXXX 15 位）| Meta Business Manager → Events Manager → Data Sources | PM 操作 |
| Meta Conversions API Access Token | Meta Events Manager → Settings → Generate Access Token | PM 操作 |

### 1.2 · GTM 容器

如果 Oztop 还**没**装 GTM：
- 在 https://tagmanager.google.com 建新容器
- 命名 "Oztop Building Supplies — Production"
- 拿 GTM-XXXXXXX
- 装到 oztopbuildingsupplies.com.au（详见 Step 2）

如果**已经**装了 GTM：
- 跳过这步，直接进 Step 3

### 1.3 · WP 后台 plugin 选型

**推荐方案**（最简单）：装 **Site Kit by Google**（WP 官方 plugin） + **PixelYourSite Pro**（Meta + GA4 + GTM 一站式）

或者纯手工：通过 GTM 注入 + WP code snippets plugin

⚠️ **强约束**：gtag / GTM 代码**必须装到 oztopbuildingsupplies.com.au**，**绝禁** 装在 ME 域名（红线）

---

## Step 2 · 装 GTM 到 WordPress 站（30 min）

### 2.1 · 装 plugin

WP 后台 → Plugins → Add New → 搜 "Google Tag Manager" → 装 **GTM4WP** 这个 plugin（开源 / 高评分）

### 2.2 · 配置 GTM4WP

GTM4WP → Settings：
- **Container ID**: `GTM-XXXXXXX`（粘贴 Step 1.2 的）
- **Container code on / off**: ON
- **Placement**: `<head>` 顶部 + `<body>` 顶部（GTM 标准做法）

### 2.3 · 验证 GTM 装好了

- 访问 https://www.oztopbuildingsupplies.com.au/ 首页
- 装 Chrome 扩展 **Google Tag Assistant Companion**
- 看到 GTM-XXXXXXX 已 fire = ✅

---

## Step 3 · Google Ads 建 4 个 Conversion Action（45 min）

进 Google Ads → Tools → Conversions → "+ Create conversion action" → "Website" 类型。

### 3.1 · Conversion #1: Free Measure Booking（Primary）

| 字段 | 值 |
|---|---|
| Conversion name | `Free Measure Booking` |
| Category | **Lead** |
| Value | **Use the same value: AU$500** |
| Count | **One** (每个 lead 算 1 次) |
| Click-through window | **30 days** |
| View-through window | 1 day |
| Attribution model | **Data-driven**（如果不可用 → Last click） |
| Include in "Conversions" | ✅ ON |
| **Mark as Primary action** | ✅ ON |

→ Save → 拿到 Conversion ID `AW-XXXXXXXXXX` + Conversion Label（一长串 hash）

### 3.2 · Conversion #2: Quote Request（Primary）

同上结构，差别：
- name: `Quote Request`
- value: **AU$300**

### 3.3 · Conversion #3: Phone Call >30s（Secondary）

- name: `Phone Call 30s+`
- Category: **Lead**（不是 Phone calls — 用 Lead 类型方便统一）
- value: **AU$200**
- **Include in "Conversions"**: ✅
- **Mark as Primary**: ❌（这是 Secondary，不进 Smart Bidding 决策）

### 3.4 · Conversion #4: WhatsApp Click（Secondary）

- name: `WhatsApp Click`
- Category: **Lead**
- value: **AU$100**
- Primary: ❌

### 3.5 · 拿 4 组 ID

| Conversion | ID | Label |
|---|---|---|
| Free Measure | AW-XXX | abc123... |
| Quote Request | AW-XXX | def456... |
| Phone Call | AW-XXX | ghi789... |
| WhatsApp | AW-XXX | jkl012... |

**Conversion ID 全部相同**（同一 Google Ads 账户），Label 4 个不同。**复制粘贴存在文档**。

---

## Step 4 · 在 GTM 配 4 个 Google Ads Conversion Tag（1 h）

### 4.1 · Tag #1: Free Measure Booking

进 GTM 容器 → Tags → New → "Google Ads Conversion Tracking" 类型：
- Conversion ID: `AW-XXXXXXXXXX`
- Conversion Label: Free Measure label
- Conversion Value: `500` (AUD)
- Currency: `AUD`
- **Triggering**: Page View where Page URL contains `/thank-you/` AND Referrer contains `/contact/`

⚠️ **WordPress thank-you 页要建好**：Oztop sitemap 显示 `/contact/` 是表单页，**没有独立 /thank-you/ 页面**。FDE 要在 WP 建一个 `/contact/thank-you/` 页：
- WP 后台 → Pages → Add New → Title "Thank You"
- URL slug: `thank-you`
- 内容："Thanks — your free measure request has been received. Our Brisbane team will contact you within 24 hours."
- Publish

然后改 `/contact/` form 提交后 redirect 到 `/contact/thank-you/`：
- 看 Oztop 用的什么 form plugin（推测 WPForms / Contact Form 7 / Gravity Forms）
- 在 form 设置里加 "Confirmation → Redirect → URL `/contact/thank-you/`"

### 4.2 · Tag #2: Quote Request

跟 #1 同模式，差别：
- Conversion Label: Quote Request label
- Value: 300
- Trigger: Page URL contains `/quote-thank-you/`（FDE 同上建独立 thank-you 页）

或者**简化方案**（一个 thank-you 页带 query param 区分）：
- thank-you 页 URL = `/contact/thank-you/?type={measure|quote}`
- Trigger: Page URL contains `/thank-you/?type=measure`（Tag 1）/ `/thank-you/?type=quote`（Tag 2）

### 4.3 · Tag #3: Phone Call >30s

**有两种实现方式**：

**A. 用 Google Ads Call Extension（推荐）**：
- Google Ads 后台 → Assets → Calls → 加 Oztop 电话 07 3416 6458
- 设 "Minimum call duration" = 30s
- Google 自动 track，**不需要 GTM Tag**
- ✅ 优势：电话直接来源 Google 转介，归因清晰

**B. 用 GTM Click Listener**（如果用户从网站直接点 `tel:` link）：
- GTM → Trigger → Click → Just Links → 触发条件 `Click URL` matches RegEx `^tel:`
- Tag fire 即记 conversion（注意：无法判断通话时长 → 准确度低）

**建议 A + B 都装**，A 记电话扩展点击 + B 记网站 tel link 点击。

### 4.4 · Tag #4: WhatsApp Click

- GTM → Trigger → Click → All Elements → Click URL matches RegEx `wa\.me|api\.whatsapp\.com|whatsapp://`
- Conversion Tag 同模式，Label = WhatsApp label，Value = 100

### 4.5 · GTM Publish

GTM → Submit → 命名 "Initial conversion tracking — 2026-06-11" → Publish

---

## Step 5 · Meta Pixel + CAPI 接入（1.5 h）

### 5.1 · Meta Pixel（browser-side）

进 Meta Events Manager → Data Sources → Pixel → Set up new pixel
- Name: "Oztop Building Supplies Pixel"
- 拿 Pixel ID（15 位数字）

**装 Pixel 到 WP**（两种方式）：

**A. 用 PixelYourSite Pro**（推荐）：
- WP 后台 → Plugins → Add New → 搜 "PixelYourSite" → 装免费版 + 升级到 Pro（AU$70/年）
- PixelYourSite → Settings → Facebook → Add Pixel ID
- 自动 fire `PageView` + 配置 4 个 Lead 事件（Free Measure / Quote / Phone Call / WhatsApp）

**B. 通过 GTM**：
- GTM → Tag → Custom HTML
- 粘贴 Meta Pixel base code（从 Meta Events Manager 拿）
- Trigger: All Pages

### 5.2 · 配 Meta Pixel 4 个 Event（对应 4 个 Conversion）

按 Meta 标准事件命名：

| Oztop Conversion | Meta Event Name | Value | Currency |
|---|---|---|---|
| Free Measure Booking | `Lead` (custom_data: `content_name: 'free_measure'`) | 500 | AUD |
| Quote Request | `Lead` (custom_data: `content_name: 'quote_request'`) | 300 | AUD |
| Phone Call 30s+ | `Contact` (custom_data: `content_name: 'phone_call'`) | 200 | AUD |
| WhatsApp Click | `Contact` (custom_data: `content_name: 'whatsapp'`) | 100 | AUD |

**关键**：所有 4 个 event 都要带：
- `event_id`: UUID（用 `crypto.randomUUID()` 生成）—— **CAPI deduplication 的关键**
- `value`: 数字
- `currency`: AUD

### 5.3 · Meta Conversions API (CAPI, server-side)

⚠️ **CAPI 是核心** — 没 CAPI 的话 iOS 14.5+ 用户的 conversion 丢失 40%+

**推荐方案**：**PixelYourSite Pro** 自带 CAPI 支持
- 进 PixelYourSite → Facebook → API Access Token → 粘贴 Step 1.1 拿的 Access Token
- 启用 "Send events via Conversions API"
- 选择"Use the same events as Pixel" + **启用 Event Deduplication**（用 event_id 去重）

**替代方案 1**：用 Meta 官方 "Conversions API Gateway"（更稳定但需要 server 资源）

**替代方案 2**：纯手工 — WP plugin "Facebook for WooCommerce" 自带 CAPI（但跟 Oztop 自建 form 集成差）

### 5.4 · 验证 Meta Pixel + CAPI

进 Meta Events Manager → Test Events → 输入 Oztop URL → 在 Oztop 站点走一遍：
1. 访问首页 → 看到 `PageView` event 同时有 **Browser** 和 **Server** 两个来源 ✅
2. 填 contact form 提交 → 看到 `Lead` event，**Event Deduplication** 显示绿勾（说明 event_id 配对成功）
3. 点 WhatsApp → 看到 `Contact` event

---

## Step 6 · 端到端验证（30 min）

### 6.1 · Free Measure Booking 走一遍

1. 访问 https://www.oztopbuildingsupplies.com.au/contact/
2. 填表 → 提交
3. 跳转到 `/contact/thank-you/`
4. **Google Tag Assistant Companion** 应该亮：
   - GTM-XXXXXXX 已 fire ✅
   - Google Ads Conversion (Free Measure) 已 fire 绿勾 ✅
   - Conversion Value: 500 AUD ✅
5. **Meta Events Manager → Test Events** 应该显示：
   - `Lead` event 来自 Browser + Server 双源 ✅
   - Deduplication 绿勾 ✅
   - Value: 500 AUD ✅

### 6.2 · 24 小时后回 Google Ads 后台

24h 后看 Google Ads → Conversions：
- 4 个 Conversion Action 列里 "Conversions" 列出现 ≥1 真实数字
- 不能是 "—" 也不能 0

### 6.3 · 24 小时后回 Meta Events Manager

Meta Events Manager → Diagnostics 应该全绿：
- ✅ Pixel matching
- ✅ CAPI receiving events
- ✅ Event Deduplication active
- ✅ EMQ (Event Match Quality) ≥ 6.0（参数齐全）

如果 EMQ < 6 → 没传 Advanced Matching 参数（email / phone / first_name 等）→ 回 PixelYourSite 启用 Advanced Matching

---

## Step 7 · 常见踩坑（一次配清楚）

### 坑 1：thank-you 页不存在或没 redirect

→ Conversion 永远 fire 不了。**Step 4.1 必须先建 /thank-you/ 页 + form 设 redirect**

### 坑 2：gtag 装在 ME 域名（红线违反）

→ 严重违反 PM 强约束。**gtag/GTM 只装 oztopbuildingsupplies.com.au，不装任何 magicengine.* 域名**

### 坑 3：Meta CAPI 漏配 event_id

→ Pixel + CAPI 双计数 = 数据翻倍。**Event Deduplication 必须用同一 event_id**

### 坑 4：WhatsApp button URL 没规范

如果 Oztop 的 WhatsApp button 是图片不是 `wa.me` link → GTM Click Trigger 抓不到。
→ FDE 把 button 改成 `<a href="https://wa.me/61734166458">WhatsApp Us</a>`

### 坑 5：Phone Call 数据 30 天后才稳定

Google 电话扩展数据有延迟 + 取决于 SIM region。第 1 周不要看 phone conversion 数字下结论。

### 坑 6：iOS 用户 conversion 漂移

iOS 14.5+ App Tracking Transparency → 部分 Pixel 数据漂。CAPI 是补救但不是完全恢复。**Smart Bidding 学习期 14 天里看 Google 的转化数据为准（Google Smart Bidding 内部有 modeling 补漂）**

---

## Step 8 · ID + Token 存档（给本文档 PM 填空）

```
================================================
Oztop Conversion Tracking — 配置档案
日期：2026-06-XX
================================================

Google Ads:
- Account ID:           ___-___-____
- Conversion ID:        AW-______________
- Conversion Labels:
  - Free Measure:       ______________
  - Quote Request:      ______________
  - Phone Call 30s+:    ______________
  - WhatsApp Click:     ______________

Google Tag Manager:
- Container ID:         GTM-_______
- Workspace:            Production
- Published version:    v1.0 (2026-06-XX)

Meta:
- Pixel ID:             _______________
- CAPI Access Token:    (存 Render env: META_CAPI_TOKEN_OZTOP)
- Conversions API Gateway: (如使用)
- Test Event Code:      TEST______（仅测试期用）

GA4:
- Property ID:          ____________
- Measurement ID:       G-__________

WordPress:
- GTM4WP plugin:        v____
- PixelYourSite Pro:    v____
- Thank-you page URL:   /contact/thank-you/

================================================
PM 验证签字：_____________  日期：_______
================================================
```

---

## Step 9 · 配置完成后 → 才能上 Ads（强约束）

不允许任何 Campaign Enabled 之前 4 个 Conversion 还在 "—"。

Day 1 上 Ads 前再走一遍 Step 6 端到端验证。**0 Conversion = 0 Smart Bidding = NZ$3,000 月预算燃烧**。

---

## 跟 CTS Conversion 的关键差异

| 维度 | CTS | Oztop |
|---|---|---|
| Conversion 数 | 1 个（询盘 form）| 4 个 |
| Conversion 平均价值 | 整个 trip lead = NZ$300（询盘 → 14-90 天定团转化率 ~5%） | Free measure = AU$500 / Quote = AU$300 |
| Phone Call | 不重要（旅游决策周期长，更靠 email/form）| 重要（装修周期短，电话是常用 lead 渠道）|
| WhatsApp | 不用 | 用（Brisbane 装修业主常用）|
| Meta CAPI 紧迫度 | 中（Meta 投放已在，但量少）| 高（Meta 是主流量来源之一）|
| Thank-you 页结构 | 单一 /thank-you | 多 thank-you（measure / quote）或带 query param |
