# SOP · Client Tracking Onboarding (Meta + Google Ads)

> **Owner**：Magic Engine · **Scope**：所有跑 Meta / Google Ads 的客户 · **Version**：v1（2026-07-20）
> **触发时机**：新客户签约后 T-0 · 老客户跑广告出「click ≠ conversion」时立刻 audit
> **成功标准**：Events Manager Test Events 看到 browser + server 双通道 Lead，Tag Assistant 绿勾

---

## 0 · 为什么必须做这个 SOP

**CTS 血泪案例（2026-06-10）**：Google Ads Campaign 上线 3 天，跑出 **9 click / 0 conversion**。
- 根因：品牌防御流量走 tour 询盘 → `/thank-you`，但**这条路径没有任何转化事件**
- 代价：3 天广告费 + 半天诊断 + 修 3 个文件 + PR review + 部署
- 教训：**追踪没验证就跑广告 = 烧钱**

**行业均值**：无 CAPI 时 Meta 追踪率 60-65%（Safari ITP / iOS 14+ ATT / Adblock 屏蔽 30-40%）。
**装了 CAPI 后**：追踪率 90%+，Meta 广告算法 CPL 直降 20-40%。

⇒ 追踪必须在**投第一块钱广告之前**验完。

---

## 1 · 6 步 Checklist

每步都有**证据要求**（截图 / DevTools / curl / 真实 fire）。任何一步没证据 = 步骤未完成，不许推进下一步。

| # | 步骤 | 工时 | 完成证据 |
|---|------|------|------|
| 1 | Business Manager 架构 4 asset 就位 | 1h | BM 截图 · Ownership 矩阵 |
| 2 | Domain Verification | 30 min | Meta 后台 Verified 绿标 + `curl` 验证 |
| 3 | Meta Pixel 客户端 + PageView + Lead（含 `eventID` 去重） | 2h | Pixel Helper 显示 fire 绿勾 |
| 4 | **Meta CAPI 服务端**（本 SOP 最重要一步） | 2h | Events Manager Test Events **browser + server 双通道** |
| 5 | Custom Conversion "Lead" 建 + Ad Account 关联 | 30 min | Ads Manager 优化目标可选 Lead |
| 6 | 24h 真实数据观察 + 浏览器实证 | 24h | 真实 Lead 记录 ≥ 1 条 |

**总工时 6h**（不含 24h 等待）· 分摊到客户 onboarding 头一周内。

---

## 2 · Step 1 · Business Manager 架构

### 目标：4 个 asset 归属清晰，客户与代理边界不模糊

| Asset | 归属 | 命名规范 |
|-------|------|------|
| Facebook Page | 客户拥有 → agency (Magic Engine BM) 有 admin 权限 | 客户品牌名 |
| Meta Pixel | agency 建 → owner = 客户 or agency（视合约） | `{ClientName} Pixel` |
| Ad Account | agency 建 → owner = 客户 or agency（视合约） | `{ClientName}` |
| Domain | 客户拥有 → 验证到 agency BM | `{clientdomain.tld}` |

### 关键决策：Ad Account owner
- **客户是长期客户 · 有可能自己接手** → owner = 客户（客户可 revoke agency）
- **代运营模式 · 我们收 revenue share** → owner = agency BM（客户看数据只读）

### 完成证据
截图 BM 的 4 个 Settings 页（Pages / Pixels / Ad Accounts / Domains）显示新客户 asset 都在列。

---

## 3 · Step 2 · Domain Verification

### 为何必须
Meta 只让 **verified domain** 跑 Aggregated Event Measurement 优先级、Facebook Shops、以及自 iOS 14.5 起的很多广告目标。**没 verify = 追踪自 iOS 用户直接砍半**。

### 3 种方法（推荐从上到下）

**A · Meta Tag（首选 · 静态站/SPA/SSR 都通用）**

从 Business Settings → Brand Safety → Domains → Add → 拿到 tag：
```html
<meta name="facebook-domain-verification" content="{16-char-token}" />
```

放到**首页 `<head>`**（不是所有页 · 只需根 URL）。Meta 会 crawl `https://{domain}/`。

**B · DNS TXT Record**：ClientOps 走 registrar / Cloudflare DNS Console。适合完全没代码 access 的场景。

**C · HTML File Upload**：把 Meta 给的文件上传到 `/{token}.html`。极静态托管场景（Cloudflare Pages / Netlify）用。

### 完成证据
```bash
# 部署后 curl 验证 tag 上线
curl -sSL -A "facebookexternalhit/1.1" https://{domain}/ | grep facebook-domain-verification
# 期望输出：
# <meta name="facebook-domain-verification" content="xxx" />
```
然后 Meta 后台点 **验证网域** → 状态变绿 **Verified** ✓。

### 常见坑
- Cloudflare Pages 缓存旧 build → `curl -H "Cache-Control: no-cache" "?bust=$(date +%s)"` 绕过验证真上线了
- 从 feature branch 部署但生产走 main → 部署完 verify 之前先确认 `origin/main` 已包含改动
- Meta tag 放到 `<body>` 里 or 由 JavaScript 动态注入 → **验证失败**（Meta 只读服务端 SSR HTML head）

---

## 4 · Step 3 · Meta Pixel 客户端 · Lead 事件 + eventID 去重

### 为何 eventID 关键
CAPI（Step 4）会重复发同一个 Lead 事件到 Meta。**没 eventID = Meta 计双份 Lead = 假的 conversion 数**。
有 `eventID` = Meta 用它 dedupe，客户端 + 服务端算一个 Lead。

### 客户端代码（三种 stack）

**Next.js（推荐结构）**：
```tsx
// src/components/marketing/MetaPixelScripts.tsx
import Script from 'next/script'
const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim()

export default function MetaPixelScripts() {
  if (!pixelId) return null
  return (
    <>
      <Script id="meta-pixel-init" strategy="afterInteractive">{`
        !function(f,b,e,v,n,t,s){/* 标准 Pixel base code */}(window, document,'script',
          'https://connect.facebook.net/en_US/fbevents.js');
        fbq('init', '${pixelId}');
        fbq('track', 'PageView');
      `}</Script>
    </>
  )
}
```

**Lead 事件触发**（Contact Form / Thank You 页）：
```tsx
// src/lib/analytics/lead-conversion.ts
export function fireLeadConversion(source: string) {
  const eventID = crypto.randomUUID()  // 关键：CAPI 用同一个 ID 去重

  // 双通道 fire
  window.gtag?.('event', 'conversion', {
    send_to: 'AW-XXX/YYY',
    value: 1,
    currency: 'NZD',
    transaction_id: eventID,
  })
  window.fbq?.('track', 'Lead', { value: 1, currency: 'NZD' }, { eventID })

  // 传给 CAPI（Step 4 用）
  fetch('/api/lead-event', {
    method: 'POST',
    body: JSON.stringify({ eventID, source, value: 1, currency: 'NZD' }),
  })
}
```

**静态 HTML（WP / Cloudflare Pages 直发）**：把上面的 base code 放 `/meta-pixel.js`，每页 `<script src="/meta-pixel.js"></script>`。参考 `magic-engine/website/meta-pixel.js`。

**WordPress**：装 [Facebook for WooCommerce](https://wordpress.org/plugins/facebook-for-woocommerce/) 插件 · 后台填 Pixel ID · Conversions API 开关一并打开。

### 完成证据
1. Chrome 装 [Meta Pixel Helper](https://chromewebstore.google.com/detail/meta-pixel-helper/fdgfkebogiimcoedlicjlajpkdmockpc) 扩展
2. 隐身窗口跑真实提交流程
3. Pixel Helper 显示 `PageView + Lead · both green`

### 常见坑
- **Router.push 后 fbq 未初始化就 fire** → 用 `useEffect` 而非 constructor
- **React StrictMode 双 fire** → 用 `sessionStorage.setItem('lead_fired_${eventID}', '1')` dedupe
- **fbq 未定义时报错** → 用 `window.fbq?.(...)` optional chaining 而非直接调用

---

## 5 · Step 4 · Meta CAPI 服务端（SOP 的核心 · 大部分客户缺这一步）

### 为何必须
客户端 Pixel 死于：Safari ITP · iOS 14+ ATT opt-out · Adblock · cookie 清除。**丢 30-40% 数据**。
CAPI 从服务器直发到 Meta Graph API：绕开浏览器限制 · Meta 更信任 · 数据 completeness 90%+。

### 前置：拿 CAPI Access Token

Business Manager → **Events Manager** → 数据集 → **设置** tab → 找 **Conversions API · 生成访问口令** → 得到一个 `EAAB...` 的 long-lived token。**⚠️ 这个 token = Meta 后台的钥匙，存到环境变量，不进 git**。

### 服务端实现 · 3 种 stack

**Cloudflare Pages Function** (`website/functions/api/lead-event.js`)：
```javascript
export async function onRequestPost(context) {
  const { request, env } = context
  const payload = await request.json()  // { eventID, source, value, currency, email?, phone? }

  const capiPayload = {
    data: [{
      event_name: 'Lead',
      event_time: Math.floor(Date.now() / 1000),
      event_id: payload.eventID,  // 关键：跟客户端 Pixel 共享 → Meta dedupe
      action_source: 'website',
      event_source_url: request.headers.get('referer'),
      user_data: {
        client_ip_address: request.headers.get('cf-connecting-ip'),
        client_user_agent: request.headers.get('user-agent'),
        em: payload.email ? [await sha256(payload.email.toLowerCase().trim())] : undefined,
        ph: payload.phone ? [await sha256(payload.phone.replace(/\D/g, ''))] : undefined,
      },
      custom_data: {
        value: payload.value ?? 1,
        currency: payload.currency ?? 'NZD',
      },
    }],
    access_token: env.META_CAPI_ACCESS_TOKEN,
    // test_event_code: 'TEST12345',  // 开发时用，验证完删掉
  }

  const res = await fetch(
    `https://graph.facebook.com/v18.0/${env.META_PIXEL_ID}/events`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(capiPayload) },
  )

  return new Response(JSON.stringify({ ok: res.ok }), {
    headers: { 'Content-Type': 'application/json' },
  })
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}
```

**Next.js API Route** (`src/app/api/lead-event/route.ts`)：同上，但用 `NextResponse` + `process.env.META_CAPI_ACCESS_TOKEN`。

**WordPress**：装 [Facebook for WooCommerce](https://wordpress.org/plugins/facebook-for-woocommerce/) 插件 → **Conversions API** section 填 Access Token → 完成。

### 环境变量清单
```bash
META_PIXEL_ID=2228804581237989              # 公开值，前端也用
META_CAPI_ACCESS_TOKEN=EAAB...              # 密文，只服务端用
```

### 完成证据
1. Events Manager → 测试事件 → 填 `TEST12345` 作为 test_event_code
2. 真实提交一次 Lead
3. 测试事件 tab **同时看到 browser + server 两条记录，标注 "Deduplicated"**
4. 关掉 test_event_code，Push 生产。

### 常见坑
- **client_ip_address 拿错**（用 `x-forwarded-for` 而非 CF 特有的 `cf-connecting-ip`）→ dedupe 失败
- **email 没 hash** → Meta 拒收（PII 必须 SHA-256）
- **event_time 精度错**（用毫秒而非秒）→ Meta 拒收
- **忘了 test_event_code 删掉** → 生产数据都进 test 桶，不算真实 conversion

---

## 6 · Step 5 · Custom Conversion "Lead" + Ad Account 关联

### 为何
让 Meta Ads Manager 优化目标可以选到 **你的 Lead 事件**（而非只是 Standard "Lead" event）。可以给 Lead 加 Category（e.g. "high-intent" vs "just-browsing"），或按 landing page URL rule 细分。

### 步骤
1. Events Manager → 数据集 → **自定义转化事件** tab
2. Add → 名称：`{Client} Lead` → Category: Lead → 规则：`event = Lead AND URL contains /thank-you`
3. 关联到该客户的 Ad Account

### 完成证据
Ads Manager 建 Campaign 时，Optimization Goal 下拉可以选到你新建的 Custom Conversion。

---

## 7 · Step 6 · 24h 真实数据观察 + 浏览器实证

### 硬红线
**不许用 console 假 fire**（`window.fbq('track', 'Lead')` 手动敲）验证。原因：那是绕过真实 form flow，可能漏掉 form validation 失败 / router 跳错等真实生产 bug。

### 真实验证 Checklist

- [ ] 隐身窗口 · 填测试 form · 观察 URL 跳转正确
- [ ] Meta Pixel Helper 显示 `Lead · green + eventID 显示`
- [ ] Google Tag Assistant 显示 `conversion · Fired successfully`
- [ ] Events Manager Test Events 显示 **browser + server 双通道 · Deduplicated**
- [ ] 24h 后 Events Manager Overview 看到 ≥ 1 真实 Lead 数据
- [ ] Ads Manager 里 Custom Conversion 可选到

### 未过关就不能跑广告！
6/10 CTS 事故就是漏这一步就上 Campaign 造成的。

---

## 8 · Ownership Matrix Template（每个客户填一份）

创建 `docs/clients/{client}/tracking-status.md`：

```markdown
# {Client Name} · Tracking Status

**Last Audit**: {YYYY-MM-DD} by {name}
**Next Audit**: {+3 months}
**Overall**: 🟢 All Green / 🟡 Partial / 🔴 Broken

## Assets
| Asset | ID | Owner | Notes |
|---|---|---|---|
| FB Page | {page_id} | Client | Admin: agency user |
| Pixel | {pixel_id} | agency BM | With client for CAPI token |
| Ad Account | {act_id} | agency BM | Currency: NZD |
| Domain | {domain} | Client DNS | Verified {date} |

## Tracking Stack
| Layer | Status | Evidence |
|---|---|---|
| Domain verify | 🟢 | Meta green Verified |
| Pixel PageView | 🟢 | Pixel Helper green |
| Pixel Lead | 🟢 | Real fire {date} |
| CAPI Lead | 🟢 | Deduplicated on {date} |
| Custom Conv | 🟢 | Selectable in Ads Manager |
| gtag Conv | 🟢 | Google Ads Fired |

## Known Issues / Next Actions
- [ ] Ex: CAPI still on test_event_code, need to remove
```

---

## 9 · 现状对齐：CTS + Oztop 需要补的东西

**CTS Tours**（`ctstours.co.nz`）：
- ✅ Pixel + Google Ads 双通道 client-side（含 eventID 去重）
- ❌ **CAPI 缺** → 补 Cloudflare Function（复用本文档 §5 代码）· 预计 2h
- ⚠️ Domain verification 需查
- ⚠️ Custom Conversion / AEM 优化未确认

**Oztop Building Supplies**：
- ✅ Google Ads 4 个 Conversion
- ⚠️ Meta Pixel / CAPI 状态需 audit
- WP + WooCommerce → 装官方 Facebook for WooCommerce 插件一步到位（含 CAPI）

**Magic Engine（自己）**：
- ✅ Pixel + Domain verified 已完成
- ❌ **CAPI 缺** → 立刻补
- ⏳ 等 MagicLab Academy Page auto-approve

---

## 10 · Changelog

- **v1** (2026-07-20): 初版，含 CTS 血泪教训 + 6 步 checklist + 3 种 stack CAPI 代码 + Ownership template
