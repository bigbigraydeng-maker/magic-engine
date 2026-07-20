# 客户接入 — 必要访问权限清单 SOP（🟦 FDE 月付轨专用）

> **⚠️ 轨道边界（2026-07-08 拆分）**：本 SOP **只适用于 FDE 月付客户**（`client_portal_users.access_type = 'paid_client'`）——由**我们后台代配**、收 Editor 权限、逐项验证。
> **$990 中小客户（`self_serve` 轨）不走这份**：他们自己在 ME 向导里上传/绑定/授权，见 [`990-self-serve-onboarding.md`](./990-self-serve-onboarding.md)。
> 别把这份的「不齐不能签合同」硬门槛套到 $990 小 trades 头上——他们多半没有 GA4/GSC/GTM，那些是我们帮他们建的。

> **目的**：每个新 FDE 客户启动前，把这份清单走完。Magic Lab 需要客户在自己的营销账户体系里**给我们至少 Editor 级别**，否则后续优化动作（配 GA4 key event、改 GTM tag、调 Meta ads、修 GBP profile）都要反复打扰客户，效率灾难。
> **定位**：客户接入合同 / Kickoff 邮件的附件。
> **更新日期**：2026-06-04

---

## 🎯 核心原则

> **"看得到 + 改得动 + 自动同步"** — Magic Lab 在任何客户平台都要满足这三层：
>
> 1. **看得到**：read-only 数据访问（基础底线，否则没法诊断）
> 2. **改得动**：Editor / Admin 角色（能修复发现的问题，不用每次打扰客户）
> 3. **自动同步**：OAuth / API key 接入 ME（让 ME cron 每天自动拉数据）
>
> 缺任意一层就构成**服务瓶颈**。Onboarding 阶段一次性谈完，比上线后零碎补单子省 10 倍时间。

---

## 📋 标准接入清单（按优先级）

### 🔴 Tier 1：必须项（不齐不能签合同 / 不能 kickoff）

| 平台 | 我们需要的角色 | 客户操作路径 | 为什么必须 |
|---|---|---|---|
| **Google Analytics 4** | **Editor** | GA4 → Admin → Property Access Management → 加 Magic Lab 邮箱 → Role: Editor | 配 key event / 改 Data Retention / 加 custom event。Viewer 完全做不了 |
| **Google Search Console** | **Owner** or **Full User** | GSC → Settings → Users and permissions → Add user → Permission: Full | 提交 sitemap / 用 URL Inspection / 拉详细搜索数据。Restricted user 拉不到 query 数据 |
| **网站后台**（WordPress / Webflow / Shopify） | **Editor** 或 **Admin**（看修改范围） | 各 CMS 邀请用户路径不同 | 改 meta tags / 加 schema markup / 部署 GEO directives / 修复 SEO 技术项 |

### 🟡 Tier 2：强烈推荐（影响主营业务但客户可能犹豫的）

| 平台 | 我们需要的角色 | 客户操作路径 | 为什么强烈推荐 |
|---|---|---|---|
| **Google Tag Manager** | **Edit** | GTM → Admin → User Management → Container permissions → Edit | 没 GTM Edit 权限时 §3 GTM 方案完全走不通，只能退到 §4 感谢页代理（精度低） |
| **Google Ads** | **Standard** access (level 3) | Google Ads → Tools → Access and security → Add user → Standard | 跑 Ads Intelligence 模块。Read-only 看得到数据但不能暂停亏损关键词 / 调出价 |
| **Google Business Profile** | **Manager**（不是 Owner，Owner 不安全） | GBP → Settings → Managers → Add managers → Manager role | 自动回复评论 / 更新营业信息 / 发 Posts。Site Manager 不够 |
| **Meta Business Suite**（Facebook + Instagram）| **Advertise + Insights** | Meta Business Settings → Pages → Add People → Tasks: Ads + Insights | 跑 Meta Ads 模块。Insights 看数据，Ads 跑 campaign |

### 🟢 Tier 3：可选（特定行业才需要）

| 平台 | 角色 | 适用 |
|---|---|---|
| **TikTok Ads Manager** | Operator | 电商 + lead-gen 同时跑 TikTok 的客户 |
| **LinkedIn Campaign Manager** | Campaign Manager | B2B 客户 |
| **Mailchimp / EDM 平台** | Manager | 接 retention / reactivation 闭环时 |
| **Trustpilot / Yelp** | Business owner verification | 口碑管理深度介入时 |

---

## 🤝 客户沟通话术（直接复制粘贴用）

### 在 Onboarding Kickoff 邮件用：

```
Subject: Magic Lab — Access setup checklist for [Client]

Hi [Client Name],

To run your Magic Engine subscription efficiently, our team needs editor-level
access to your marketing accounts. This is a one-time setup — once granted, we
won't need to bother you for routine optimization work.

Please add my email <bigbigraydeng@gmail.com> to the following with the listed
roles:

REQUIRED (we can't start without these):
□ Google Analytics 4         → role: Editor
□ Google Search Console      → permission: Full
□ Website backend (WordPress/...) → role: Editor

RECOMMENDED (lets us move faster):
□ Google Tag Manager         → role: Edit
□ Google Ads                 → access: Standard
□ Google Business Profile    → role: Manager
□ Meta Business Suite        → tasks: Ads + Insights

Each platform has a Help link below for the exact steps. Should take ~15 min
total. Let me know if any of these aren't possible — we'll discuss workarounds.

Talk soon,
[Your Name]
```

### 如果客户问"为什么不只给 Viewer / Read-only"：

> "Viewer 让我们能诊断问题但不能修。每次发现一个 SEO meta tag 缺失 / GA4 没配 conversion tracking / Meta Ads CPA 飙升，我们都要回头找你签字才能动手。Editor 让我们当天就能修复，你只需要看月报对结果。这是 FDE 服务和"咨询报告"的根本区别。"

### 如果客户说"我担心权限太大"：

> "完全理解。Editor 不是 Owner — 我们不能把你踢出账户、不能转移所有权、不能删除整个 property。所有改动有 audit log 你随时能看到。Magic Lab 自己也有内部审批流程（详见服务合同 §X 安全条款）。任何时候你想撤销访问权限，30 秒就能做完。"

---

## 📝 实操：每个新客户的 onboarding 检查表

### Kickoff 前一周

- [ ] 发出上面的 Access setup 邮件，等待客户回复
- [ ] 客户邀请到位后，自己逐个登入验证 role 是否正确（Editor 不是 Viewer，常见误邀）
- [ ] 把验证截图存到 `docs/clients/<client-slug>/onboarding/access-screenshots/`

### Kickoff 当周

- [ ] 跑一次 GA4 SOP（[ga4-lead-gen-key-event-setup.md](./ga4-lead-gen-key-event-setup.md)）配 key events
- [ ] GSC 提交 sitemap.xml（如果还没提交）
- [ ] 网站后台部署一次 GEO directive（测试访问权限是否够）
- [ ] OAuth 接 ME — 各平台 connector 都点 Connect 一遍

### Kickoff 后第一个月

- [ ] 月底检查所有 connector 状态绿（ME → connectors 页面）
- [ ] 如果有 ❌ 红色断开，邮件提醒客户重授权（OAuth 90 天会到期）

---

## 🔒 安全要求（Magic Lab 内部）

虽然客户给我们 Editor，但 Magic Lab 自己内部要遵守：

1. **审批流程**：任何"删除"或"批量改"动作必须 PM 批准（参考 CLAUDE.md 删除决策流程）
2. **audit trail**：在 ROADMAP §9 完成日志登记每次客户账号的实际操作（"2026-06-04 给 CTS GA4 加了 generate_lead key event"）
3. **撤销时机**：服务结束 / 客户 churn 时，主动让客户撤销我们的访问（不要悄悄留着）
4. **不共享凭证**：每个 FDE 用自己的 Google 邮箱被加为 Editor，**禁止共享 Magic Lab 公共账号密码**

---

## 🚨 常见拒绝场景 + 应对

| 客户反应 | 应对 |
|---|---|
| "我们公司政策只能给 Viewer" | 列举具体不能做的事（"不能配 key event 意味着 form 提交不会自动算进 conversion，你每月看的转化数据都是错的"）→ 给客户合规答辩用的安全要求清单 |
| "我老板要看 audit log" | 转发 Google 各平台的 audit log 入口截图，每次我们操作 7 天内可查 |
| "请合同里明确"  | 接入清单加进 SOW（Statement of Work）附件，每条权限标明用途 |
| "可以但要付额外费用配置" | 配置费应该已经在 FDE 月费里 cover 了。如果客户单算，把工作量改为每平台 30-60 分钟，按 hourly 报价 |

---

## 📚 关联文档

- [ga4-lead-gen-key-event-setup.md](./ga4-lead-gen-key-event-setup.md) — GA4 Editor 权限到位后跑这份 SOP
- 后续 SOPs（待补）：
  - GSC Owner 权限 → 提交 sitemap / Indexing API 自动加速
  - GTM Edit 权限 → 部署 GEO directive snippets
  - GBP Manager → 自动回评 + 月度 Posts

---

## 🎯 决策记录

**2026-06-04 PM 拍板**：今后所有陪跑客户**必须给 Editor 权限**作为合作前提。理由：
- CTS / Oztop 两个 pilot 都给了 Editor，证明客户能接受
- 没 Editor 时 GA4 key event / GTM tag 全部要客户操作，效率灾难
- "Editor 是 FDE 的合作前提"应该明确写进 SOW

**适用范围**：所有 Tier 1 平台（GA4 / GSC / 网站后台）必须 Editor。Tier 2 平台（GTM / Google Ads / GBP / Meta）强烈推荐但非合同硬性。
