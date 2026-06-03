# GA4 Key Event 配置 SOP — Lead-Gen 网站（CTS / Oztop / 类似）

> **适用范围**：网站以「流量 → 落地页 → 表单 → 询盘」为转化路径的 lead-gen 客户（不是电商）。
> **目标**：让 GA4 把表单提交记为 key event（旧名 conversion），这样 ME 的 Goal 主指标 `form_submissions` / `leads_count` 才能自动读到真实数字。
> **耗时**：每个客户 20-30 分钟。
> **维护人**：FDE（Frontline Deployment Engineer）

---

## 0 · 前置检查（2 分钟）

打开 GA4 → 选客户 property → **左下齿轮 (Admin) → Property 列下 Data Streams** → 点你的网站 stream → 看 **Enhanced Measurement** 开关：

- ✅ **已开** → 直接跳到 §1
- ❌ **没开** → 打开它，等 24 小时再回来做 §1（Enhanced Measurement 需要时间在前端注入追踪代码）

> Enhanced Measurement 会自动追踪：page_view / scroll / outbound click / site_search / video_engagement / **form_interactions** / file_download。我们要利用的就是 form_interactions 这一项。

---

## 1 · 路径判断（5 分钟）

打开 GA4 → 左侧 **Admin → Property 列下 Events**（不是 Conversions，2024+ 改名了），看现有 event 列表：

### Case A：列表里**有** `form_submit`（最简单）

✅ Enhanced Measurement 已经自动识别到你的表单。**走 §2**，5 分钟搞定。

### Case B：列表里**没有** `form_submit`，但**有** `page_view`

⚠️ 客户的表单是 React/Vue SPA 或自定义 JS 提交，GA4 自动追踪不到。**走 §3**（GTM 或 gtag 埋点），或者更简单 **走 §4**（用「访问感谢页」当代理信号）。

### Case C：什么 event 都没有

🔴 GA4 还没装好。先回 §0 把 Enhanced Measurement 开了，等 24 小时再回来。

---

## 2 · Case A：Form_submit 已存在，标为 Key Event（5 分钟）

1. GA4 → **Admin → Events**
2. 列表找到 `form_submit`
3. 右侧有一列 **「Mark as key event」**，把 toggle 打开
4. **完成**。等 24-48 小时数据回流，回到 ME 的 Goal 详情页应看到数字。

**验证**：
- GA4 → **Reports → Realtime → Event count by Event name**
- 打开自己客户网站，提交一次测试表单
- 应该几秒内在 Realtime 看到 `form_submit` +1
- 24 小时后 ME 的 `ga4_traffic_snapshots.top_sources[].conversions` 会聚合到这一条 event

---

## 3 · Case B（GTM 方案）：手动建 generate_lead key event（20 分钟）

> Google 官方推荐的 lead-gen 标准 event 名是 `generate_lead`（而不是 `form_submit`）。
> 当 §2 走不通时（SPA / 自定义表单），用这个方案。

### 3.1 确认客户网站接了 GTM（Google Tag Manager）

- 打开客户网站
- F12 → Network → 搜 `googletagmanager.com/gtm.js` — 有命中 = 接了 GTM
- 没命中 → **走 §5（gtag 直接埋点）** 或 **§4（感谢页代理）**

### 3.2 GTM 建一个 GA4 Event Tag

1. 打开 https://tagmanager.google.com → 选客户 container
2. 左侧 **Tags → New**
3. **Tag Configuration**：
   - Type: `Google Analytics: GA4 Event`
   - Configuration Tag: 选已存在的 GA4 config tag（应该叫 `GA4 Config - <property_id>`）
   - **Event Name**: `generate_lead`（**必须叫这个，Google 标准 lead-gen event name**）
   - **Event Parameters**：
     - Name: `value`,  Value: `1`
     - Name: `currency`, Value: `NZD`（CTS）或 `AUD`（Oztop）
4. **Triggering**：
   - 4a. **标准 `<form>` 表单**：选「Form Submission」预置 trigger
     - 默认 fire on All Forms 太宽，建议加条件：`Form ID` matches RegEx `^(contact|enquiry|booking|quote)` 或 `Page Path` contains `/contact`
   - 4b. **AJAX / Fetch SPA 表单**：选「Custom Event」trigger
     - Event name: `lead_form_submit`
     - **额外要求**：让前端开发在表单提交成功的 callback 加这行：
       ```js
       window.dataLayer = window.dataLayer || []
       window.dataLayer.push({ event: 'lead_form_submit' })
       ```
5. **Save → Submit**（GTM 不发布的话不生效！）

### 3.3 验证 + 标 key event

1. GTM 顶部右上角 **Preview** → 在预览窗口里打开客户网站 → 提交一次测试表单 → 应看到 `generate_lead` tag fired
2. 24 小时后回 GA4 → **Admin → Events** 列表应出现 `generate_lead`
3. 把 `generate_lead` 的「Mark as key event」打开

---

## 4 · Case B（感谢页代理方案）：用「访问感谢页」当转化信号（10 分钟）

> 客户网站表单提交后会自动跳转到 `/thank-you`、`/danke`、`/success` 之类感谢页时用这个。**最适合 WordPress 站点**。

### 4.1 确认感谢页存在

打开客户网站 → 找到联系表单 → **不要真提交**，先看表单 action 或 button 上的跳转目标：

```html
<form action="/thank-you" method="POST">
<!-- 或 -->
<form onsubmit="window.location='/contact-success'">
```

或者直接打开网站找「Thanks」「感谢」「确认收到」字样的页面，看 URL 路径。

**记下感谢页 URL 路径**（不要带域名），例如 `/thank-you` 或 `/contact/success`。

### 4.2 GA4 建一个 Custom Event

1. GA4 → **Admin → Events → 顶部点 Create event**（不是 Modify event）
2. **Custom event name**: `generate_lead`
3. **Matching conditions**：
   - Parameter: `event_name`,  Operator: `equals`,  Value: `page_view`
   - **And** Parameter: `page_location`,  Operator: `contains`,  Value: `/thank-you`（换成你 §4.1 记下的）
4. 勾选 **「Copy parameters from source event」**（继承 source / medium 之类，便于 ME 归因）
5. **Create**

### 4.3 标 key event

1. 等 24 小时（custom event 生效有延迟）
2. GA4 → **Admin → Events** 列表应出现新的 `generate_lead`
3. 「Mark as key event」打开

---

## 5 · Case B（gtag 直接埋点方案）：没有 GTM 也没感谢页时（需开发配合）

如果客户网站既没 GTM 又没感谢页跳转（典型：React SPA + fetch 提交 + inline 成功提示），让前端开发在表单提交成功的 callback 加这段代码：

```javascript
// 在表单提交成功的 then() / await success 之后
if (typeof window.gtag === 'function') {
  window.gtag('event', 'generate_lead', {
    value: 1,
    currency: 'NZD'   // CTS = NZD, Oztop = AUD
  })
}
```

**前提**：客户网站已经在 `<head>` 接了 GA4 gtag.js（不是只接 GTM）。一般 WordPress + Google Site Kit 插件会自动接。

部署后等 24 小时，回 GA4 → Events 列表应出现 `generate_lead`，按 §4.3 标 key event。

---

## 6 · 验证（每个客户必做）

### 6.1 Realtime 烟雾测试（10 秒）

1. GA4 → **Reports → Realtime**
2. 打开客户网站（建议用隐身窗口排除自己之前的 cookie 干扰）
3. 真实地提交一次表单（用测试邮箱）
4. 5-10 秒内 Realtime 的 **「Event count by Event name」** 应看到 `form_submit` 或 `generate_lead` +1
5. **没看到？** 说明触发条件不对：
   - GTM Preview 看 tag 有没有 fire
   - 浏览器 Console 看 `gtag` 函数是否定义
   - 检查感谢页 URL 是否真的匹配

### 6.2 ME 端验证（24-48 小时后）

1. 打开 https://app.magicengine.com.au/dashboard/clients/[客户 id]/goal/[goalId]
2. 主指标卡片若是 `form_submissions` metric，**Current 列** 应显示数字 + 「⚡ GA4 conversions」徽章
3. 没显示？登 Supabase 直接查：
   ```sql
   SELECT
     period_end,
     (SELECT SUM((src->>'conversions')::int)
      FROM jsonb_array_elements(top_sources) src) AS total_conversions
   FROM ga4_traffic_snapshots
   WHERE client_id = '<客户 id>'
   ORDER BY period_end DESC LIMIT 3;
   ```
4. `total_conversions` 还是 0 → GA4 端没真正配好 key event，回 §2/3/4 复查
5. `total_conversions` > 0 但 ME 不显示 → ME bug，发我（auto-fetch.ts 问题）

---

## 7 · 常见坑

| 现象 | 原因 | 解决 |
|---|---|---|
| Mark key event 开关 toggle 不了 | event 还没产生过任何 hit | 先提交一次测试表单，等 5 分钟回来 |
| `form_submit` 在 Events 列表但 count 全是 0 | Enhanced Measurement 没真的注入 | 检查 Data stream → Enhanced Measurement → 「Form interactions」是否真打开（之前可能只勾了「Configure」没保存） |
| GTM Preview 看到 tag fired 但 GA4 Realtime 没数据 | Tag config 选错了 GA4 property | GTM → Tag 配置 → Configuration Tag 确认选的是当前客户的 GA4 property |
| ME 一直显示 0 conversions 即便 GA4 有数据 | GA4 cron 没跑（每天 3am UTC）/ ga4_traffic_snapshots 未更新 | 等 24 小时；或手动 POST `/api/clients/[id]/ga4/sync` 立即同步 |

---

## 8 · 配置完成 checklist（给 FDE）

- [ ] §0 Enhanced Measurement / Form interactions 已开
- [ ] §1 判断走哪条路（A / B-GTM / B-感谢页 / B-gtag）
- [ ] §2-§5 跟着对应路径配完
- [ ] §6.1 Realtime 烟雾测试通过（看到 +1）
- [ ] event 已 Mark as key event
- [ ] 24-48 小时后 §6.2 ME 端 Current 列出数字
- [ ] 把客户名 + 完成日期登记到 ROADMAP §9 功能完成日志

---

## 9 · 客户特定说明

### CTS Tours NZ（`c0000000-0000-0000-0000-000000000000`）

- 网站：ctstours.co.nz
- 类型：WordPress（待确认）
- 货币：NZD
- 主指标：`orders_count`（self_report，FDE 手填）或 `form_submissions`（auto，配完 GA4 就读）
- 推荐路径：先查 §1 Case A → 大概率走 §4 感谢页代理（NZ 旅游业常见 booking → /thank-you 路径）

### Oztop（`d5c98811-1c1d-4ded-bdf0-4cefec6afb84`）

- 网站：待确认
- 类型：本地业务（building 类）
- 货币：AUD
- 主指标：`monthly_revenue`（self_report）+ `leads_count`（hybrid — 部分 GA4 部分电话/微信）
- 推荐路径：先查 §1 Case A，若是 WordPress + 标准 `<form>` 大概率走 §2

---

## 10 · 维护

- 这份 SOP 每接一个新 lead-gen 客户都跑一次
- 配完一个客户回这里把 §9 客户特定说明补完整（实际网站架构、走的是哪条路径、配置日期）
- 发现新坑加到 §7 常见坑
