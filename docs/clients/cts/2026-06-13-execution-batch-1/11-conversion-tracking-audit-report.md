# CTS Tours NZ · Conversion Tracking 审计 + 修复报告

> **客户**：CTS Tours NZ（`ctstours.co.nz`） · **client_id**：`c0000000-0000-0000-0000-000000000000`
> **Google Ads Account**：105-817-1329 · **Conversion ID**：`AW-17984232872`（已在站上）
> **执行人**：子牙（审计 + 出修复规格） · **部署**：ME 团队（PM 拍板：ME 有 CTS Next.js 仓库部署权）
> **日期**：2026-06-13 · **状态**：🟡 诊断完成 + 修复规格已出，**等部署 + 真实 fire 验证**
> **触发背景**：Google Ads Campaign 1（品牌防御）6/10 上线，至 6/13 = 9 click / **0 转化**。诸葛亮窗口 Campaign 2/3/M1 被 conversion 闸 0 卡住，等本报告闸放绿。

---

## ⚠️ 0.5 · 复测修正（2026-06-13 第二轮 · 推翻原 §0/§1/§2 部分结论 · 以本节为准）

> 第一轮审计用 `curl|grep` 服务端 HTML + 反编译部分 JS chunk，**漏 grep 了 contact 页 chunk**，导致 over-claim「全站 send_to=0」。第二轮直接拿到 CTS Next.js 仓库源码（`chinatravel` repo，ME 有部署权，PM 6/13 拍板）逐文件读 + 生产 bundle 实证，修正如下：

**真实拓扑（实证）**：CTS 有**两条 lead 路径**，不是一条。

| Lead 路径 | 触发 | Google Ads 转化 | Meta Pixel Lead |
|---|---|---|---|
| **通用 `/contact` 表单** | 提交成功→内联显示（**不跳转 /thank-you**） | ✅ **已上线**（`y-kaCLSI9YAcEKi7xv9C`，PR #43，6/10）。生产 contact chunk 实测含此 label | ❌ 缺 |
| **Tour 询盘**（`TourEnquiry.tsx`，主路径） | 提交成功→`router.push('/thank-you')` | ❌ **缺**（只有一个无 GTM 容器消费的 dataLayer push） | ❌ 缺 |

**修正后的「9 click 0 转化」根因**：品牌防御 campaign 把流量引到首页/tour 页，询盘主要走 **tour 询盘 → /thank-you**——而这条路**完全没有转化事件**。`/contact` 那条虽有 Ads 转化但量小。Meta Pixel `Lead` 则**两条路都没有**。

**因此修复 = 改 CTS Next.js 仓库代码（不是建 GTM、不是 PM 进 Google Ads 建新 action）**：

- 子牙已在 `chinatravel` 仓 worktree（分支 `claude/cts-conversion-thankyou-lead`）完成 **3 文件外科手术改动 + 1 测试文件**，已本地 commit（`6f4a4a2`）：
  1. 新建 `src/lib/analytics/lead-conversion.ts`：集中式 `fireLeadConversion(source)`，一处 fire Google Ads 转化（**复用已上线的真实 label** `AW-17984232872/y-kaCLSI9YAcEKi7xv9C`）+ Meta Pixel `Lead`，共享 `eventID` 供未来 CAPI 去重。
  2. `ThankYouClient.tsx`：在 /thank-you 落地 fire（按 tour 参数 sessionStorage 去重，防刷新双计、StrictMode 安全）。
  3. `ContactFormClient.tsx`：用 helper 替换原内联 Ads 块，**顺带补上原先缺失的 Meta Lead**（Ads 行为等价）。
  4. jest 测试：双 channel + 共享 id 去重 + gtag/fbq 缺失守卫。
- **魏征对抗式静态复审 PASS（可 merge，无 BLOCKER/MAJOR）**。
- **关键收益**：复用已上线转化 action → **PM 无需进 Google Ads UI 建新 action**，原 §2 Step A 阻塞**消除**。原 §2 Step B 的「新建 ConversionTracker.tsx」方案**作废**（会与已有 ThankYouClient 重复），以本节实际改动为准。

**⛔ 本环境限制（诚实声明）**：本机**未装 node**（跑不了 `next build`/`jest`）+ **无 gh / 无 push 凭证**。所以：
- 代码**未跑 build/测试验证**（仅静态类型核对 + 魏征静态复审）。
- commit **在本地分支，未 push、未开 PR**。需 PM 在有凭证的环境 push + 开 PR + **merge 到 chinatravel main（Render 自动部署）**。
- **闸 0 仍未绿**：未部署 → 无真实 fire 可验。

下方原 §1–§2 保留作审计留痕，但**结论以本 §0.5 为准**。

---

## 0 · 一句话结论（⚠️ 已被 §0.5 修正，保留留痕）

**CTS 不缺像素，缺的是「转化事件」。** Google Ads 基础标签在跑（只记 page_view）、Meta Pixel 基础标签在跑（只记 PageView），但**全站没有任何 conversion / Lead 事件** → Google Ads 永远 0 转化、Meta 永远抓不到询盘。修复 = 在 `/thank-you` 页加一段「转化事件」代码 + 在 Google Ads UI 建对应的 Conversion Action。

---

## 1 · 现状审计（实证，非猜测）

> 方法：`curl` 拉 `ctstours.co.nz` 原始 HTML + 反编译 Next.js 客户端 bundle（`/_next/static/chunks/app/layout-*.js`、`/_next/static/chunks/app/thank-you/page-*.js` 及 4 个共享 chunk）逐字 grep。

### 1.1 站点架构（推翻原任务简报假设）

- **不是 WordPress**，是**自建 Next.js**（`_next/` + Supabase 存图）。
- **没有 GTM 容器**。所有 tracking **硬编码在 React layout 组件**里（`next/script`，`strategy="afterInteractive"`）。
- 因此 Oztop 的「装 GTM4WP 插件 / 贴代码到 CMS」无代码路径**在 CTS 上不成立** —— 任何改动都要改一次 Next.js 代码并部署。

### 1.2 三平台逐项实测

| 平台 | 实测 | 证据 |
|---|---|---|
| **Google Ads 基础标签** | ✅ 已装 | `<script src=".../gtag/js?id=AW-17984232872">` + `gtag('config','AW-17984232872')`（layout bundle 内联） |
| **Google Ads 转化事件** | ❌ **完全没有** | 全站（含 thank-you 页 chunk + 4 个共享 chunk）`gtag('event','conversion')`=0、`send_to`=0、`AW-.../<label>`=0 |
| **Meta Pixel 基础标签** | ✅ 已装，真实 Pixel ID | `fbq('init','1441880990459874')` + `fbq('track','PageView')`（layout bundle 内联） |
| **Meta Pixel 转化事件** | ❌ 没有 | 全站 `fbq('track','Lead'/'Contact')`=0 |
| **Meta CAPI（server-side）** | ❌ 未接 | 无服务端事件、无 dedup |
| **站上 GA4（gtag）** | ❌ 没跑 | 组件存在但 gate 在 `NEXT_PUBLIC_GA_ID` 环境变量，生产未设 → 站上 GA4 不 fire。**注意：跟「ME 后台 GA4 connector」是两回事**（那是 server-side Data API，已接 ✅） |
| **/thank-you 页** | ✅ 已存在（HTTP 200） | "We have received your enquiry" + "within 24 hours" + 0800 CTS 888；页面 chunk 仅 3KB，**零 tracking 代码** |
| **Cookie 同意闸** | ⚠️ 存在 | 部分标签 gate 在 `localStorage cts_cookie_consent='accepted'`。用户不点「Accept」→ 标签不 fire（额外转化流失因子，见 §4） |

### 1.3 「9 click 0 转化」根因（铁证）

Google Ads 基础标签只会自动记 `page_view`，**绝不会自动产生 conversion**。要 Google Ads 计一次转化，必须在转化点（`/thank-you`）fire 一个 `gtag('event','conversion',{send_to:'AW-17984232872/<LABEL>'})` 事件。**这个事件全站不存在** → 不管多少 click，转化恒为 0。与 Google Ads 后台「9 click / 0 转化」完全吻合。

---

## 2 · 修复方案（ME 团队部署，子牙出规格）

### Step A · Google Ads 建 Conversion Action（PM 在 Google Ads UI，~15 min）

进 Google Ads（账户 105-817-1329）→ Tools → Conversions → **+ New conversion action** → **Website**：

| 字段 | 值 |
|---|---|
| Goal / Category | **Contact**（Submit lead form） |
| Conversion name | `Contact Form Submit` |
| Value | **Use the same value**：暂设 **NZD $50** ⚠️ 见下注 |
| Count | **One**（每次 click 只计一次，lead 类不重复） |
| Click-through window | **30 days** |
| View-through window | 1 day |
| Attribution model | **Data-driven**（不可用则 Last click） |
| Mark as Primary | ✅ ON（这是主转化，喂 Smart Bidding） |

→ Save 后拿到 **Conversion Label**（一串 hash，形如 `AbC-D_efGhIjk1234`）。**这个 Label 是 Step B 代码片段的唯一缺口**，PM 拿到后填进占位符。

> ⚠️ **价值口径待 PM 定**：本任务简报指定暂设 **NZD $50**；但 Oztop SOP 的 CTS 对照行写「整个 trip lead = NZ$300（询盘→定团 ~5% 转化）」。两者口径不同（$50 偏保守、$300 是 trip lead 期望值）。**先按 $50 上线跑通，PM 后续按真实 lead 价值调**（改 Google Ads 后台 value + 代码 value 两处即可）。

### Step B · 在 `/thank-you` 页 fire 转化事件（ME 改 Next.js 代码，~30 min）

CTS 的 `/thank-you` 当前是纯展示页（server component，无 JS）。需要加一个**极小的 client 组件**，在挂载时 fire 一次 Google Ads conversion + Meta Pixel Lead。

**新建文件** `app/thank-you/ConversionTracker.tsx`（client component）：

```tsx
'use client';

import { useEffect } from 'react';

// CTS Tours — fires Google Ads conversion + Meta Pixel Lead exactly once
// when the visitor lands on /thank-you (i.e. after a successful enquiry).
// Guarded against double-fire (React 18 StrictMode / re-render) via sessionStorage.
declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    fbq?: (...args: unknown[]) => void;
  }
}

const LEAD_VALUE = 50;        // NZD — keep in sync with Google Ads conversion action value
const CURRENCY = 'NZD';
// ⬇️ PM: paste the Conversion Label from Step A here (replace REPLACE_WITH_LABEL)
const GOOGLE_ADS_SEND_TO = 'AW-17984232872/REPLACE_WITH_LABEL';

export default function ConversionTracker() {
  useEffect(() => {
    if (sessionStorage.getItem('cts_lead_fired') === '1') return;
    sessionStorage.setItem('cts_lead_fired', '1');

    // Google Ads conversion
    if (typeof window.gtag === 'function') {
      window.gtag('event', 'conversion', {
        send_to: GOOGLE_ADS_SEND_TO,
        value: LEAD_VALUE,
        currency: CURRENCY,
      });
    }

    // Meta Pixel Lead (eventID enables future CAPI dedup — see report §5)
    if (typeof window.fbq === 'function') {
      window.fbq('track', 'Lead', { value: LEAD_VALUE, currency: CURRENCY });
    }
  }, []);

  return null;
}
```

**改 `app/thank-you/page.tsx`**：在页面组件里引入并渲染该 client 组件（不影响 SSR 内容）：

```tsx
import ConversionTracker from './ConversionTracker';
// ... 在 return 的 JSX 顶部加一行：
//   <ConversionTracker />
```

> **为什么用 sessionStorage 去重**：React 18 StrictMode 开发态会 double-invoke effect，且用户刷新 thank-you 页不该重复计转化。`Count: One` 在 Google Ads 侧也会兜底，但前端去重更干净。

### Step C · Cookie 同意闸 / Consent Mode（ME 评估，~30 min）

现有 gtag/fbq gate 在 `cts_cookie_consent`。**风险**：若用户提交询盘但**没点「Accept」cookie**，`window.gtag`/`window.fbq` 可能不存在 → Step B 的事件静默跳过（代码已 `typeof` 守卫，不报错，但**这一条转化丢了**）。

**两个处理选项**（PM/ME 定）：
1. **最小**：维持现状，接受未同意用户的转化流失（NZ 对 cookie 同意要求宽松，旅游询盘用户同意率通常较高）。
2. **推荐**：上 **Google Consent Mode v2**（`default` 全 denied → 点 Accept 后 `update` 授 `ad_storage`/`ad_user_data`），Google 会用 modeling 补部分未同意转化。这是 2026 标准做法，但需要改 layout 的 consent 组件。**建议本批先用选项 1 跑通闸 0，Consent Mode 列入下一批**。

### Step D · Meta CAPI（server-side，列为下一批 follow-up）

本批**只上 browser Pixel 的 `Lead` 事件**即可放闸 0（Google Ads 是当前燃烧主战场）。完整 CAPI（server-side + dedup）需要：
- CTS 站加一个 `/api/meta-capi` 服务端路由，把 `Lead` 事件用同一 `event_id` 再发一份给 Meta（dedup）；
- Step B 的 `fbq('track','Lead', {...}, {eventID})` 带上 `eventID`，与 server 端一致。
参照 Oztop SOP Step 5 的 dedup 模式。**标注为 Phase-2**，不阻塞本次 Google Ads 闸。

### Step E · 站上 GA4（可选）

设 `NEXT_PUBLIC_GA_ID = G-XXXXXXXXXX`（从 ME 后台 GA4 connector 拿 CTS 的 Measurement ID）即可激活站上 GA4 + `form_submit`/`page_view`。**可选**，不阻塞 Google Ads 闸。

---

## 3 · 验证清单（🔴 部署后由 PM 真实走查，当前全部 PENDING — 未验证不算修好）

> **诚实声明**：以下绿勾**当前一个都没打**。代码尚未部署、Conversion Action 尚未建。子牙无法替 PM 在浏览器里验证真实 fire。**禁止把以下任何一条当「已完成」**。

> ⚠️ 以 §0.5 修正为准：value 是 **NZD 1.0**（与已上线 contact 转化一致），不是 $50；**两条路径都要走**（contact 内联 / tour 询盘跳 /thank-you）。

**chinatravel PR merge + Render 部署完成后**，PM 装 **Google Tag Assistant** + **Meta Pixel Helper**，走**真实表单流程**（不要 console 假 fire）：

**路径 A — Tour 询盘（主路径）**：
1. 访问任一 tour 页（如 `https://www.ctstours.co.nz/tours/...`）
2. 填询盘 form → Send Enquiry → 跳到 `/thank-you?tour=...`
3. 在 `/thank-you` 落地页应看到下表绿勾。

**路径 B — 通用 /contact**：
1. 访问 `https://www.ctstours.co.nz/contact`
2. 填 form → Send Message → **内联**显示 "Thank you!"（**不跳转**），转化在当前页 fire。

| 检查项 | 工具 | 期望 | 状态 |
|---|---|---|---|
| Google Ads `预约服务/Booking Service` 转化 fire（两条路） | Google Tag Assistant | "Conversion fired" 绿勾 + value 1.0 NZD | ☐ PENDING |
| Meta `Lead` event fire（两条路） | Meta Pixel Helper | "Lead" fired 绿勾 + value 1.0 NZD | ☐ PENDING |
| Meta Events Manager Test Events | Meta EM → Test Events | 看到 `Lead`（browser 源） | ☐ PENDING |

3. 任一不绿 → 排查（最常见：PR 未 merge/未部署 / gtag·fbq 被 ad-blocker 拦 / 组件未渲染）。
4. **24h 复查点**：**2026-06-14（NZST）**，PM 回 Google Ads → Conversions，`预约服务` 列出现真实数字（≠「—」、≠ 0）。

---

## 4 · 已修 / 待办 一览

| 项 | 状态 |
|---|---|
| 现状审计（三平台逐项实证） | ✅ 完成 |
| 根因定位（缺 conversion 事件） | ✅ 完成 |
| Google Ads Conversion Action 规格 | ✅ 规格已出，待 PM 在 UI 建（Step A） |
| `/thank-you` 转化事件代码片段 | ✅ 代码已出，待 ME 部署（Step B） |
| Meta Pixel `Lead` 事件 | ✅ 含在 Step B，待部署 |
| 真实 fire 绿勾验证 | ☐ **PENDING（部署后 PM 走查）** |
| 24h 后 Google Ads 真实转化数 | ☐ PENDING（2026-06-14 复查） |
| Cookie Consent Mode v2 | 📋 Phase-2（Step C 选项 2） |
| Meta CAPI server-side + dedup | 📋 Phase-2（Step D） |
| 站上 GA4（NEXT_PUBLIC_GA_ID） | 📋 可选（Step E） |

---

## 5 · 给诸葛亮窗口的放闸信号

**闸 0（conversion tracking）当前是「代码就绪 + 已复审，待 push/merge/部署 + 真实 fire 验证」，不是「已绿」。** 代码已写完并经 子牙+魏征 双审，但：①本环境无 node，未跑 build/测试；②commit 未 push、PR 未开（无凭证）；③未部署 → 无真实 fire 可验。

严格按红线 #2，必须等 **chinatravel PR merge → Render 部署 → §3 两条路径真实打绿 → 24h 见 Google Ads 真实转化数**，才能对诸葛亮说「闸 0 已绿」。在那之前 Campaign 2/3/M1 不应仅凭本报告上线。

**PM 放闸路线图（待办）**：
1. push `claude/cts-conversion-thankyou-lead`（chinatravel 仓）→ 开 PR → review → **merge 到 main**（Render 自动部署）。
2. 部署完按 §3 走查两条路径，打绿。
3. 绿 + 24h 见真实转化数 → 回诸葛亮窗口说「闸 0 已绿」。

---

*报告人：子牙 · 分支 `claude/cts-conversion-fix` · worktree `../magic-engine-cts-conv`*
