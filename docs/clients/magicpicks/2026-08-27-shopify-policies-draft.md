# Magic Picks — Shopify 6 段政策页草稿 v1

- **日期**：2026-08-27
- **owner**：Claude Code 起草 · PM 到 Shopify Admin `/settings/legal` 逐段粘贴（ME 目前没有能直接写 Shopify 店铺政策的接口 —— `write_legal_policies` 只是未来 ME Ops backend 上线后的目标 capability 名，现在还没实现，不能当成已有的自动执行入口）
- **P1，必须进日常任务管道**：本文档只是草稿来源，不是任务本身 —— 已同步登记到 [docs/ROADMAP.md「近期待办」](../../ROADMAP.md#近期待办跨-phase-汇总) 的 Magic Picks 条目，并接进了今日待办管道（`src/lib/pm-todo/manual-items.ts` 的 `pushMagicPicksPolicyReplacementItem`），粘贴完成前不会死在这份 Markdown 里；PM 粘贴完成后要把 ROADMAP 条目和 `manual-items.ts` 里这一条一起删掉，否则待办会一直下发
- **目的**：清理店里 3 个 Homara 遗留政策（Brisbane / QLD / ABC Plus Home / AUD），发布干净主题前必须完成
- **市场**：NZ only（Consumer Guarantees Act 1993 · Privacy Act 2020 · Fair Trading Act 1986）
- **占位状态**（2026-08-27）：
  - ✅ **LEGAL_ENTITY** → `VITOL TRADING LIMITED`（Ray 敲定 · NZ 现有 Ltd · Company # 8374464 · Magic Picks 是其 trade name）
  - ✅ **NZBN** → `9429050577675`（Ray 敲定）
  - ✅ **GST_NUMBER** → `136-124-412`（Ray 敲定，已注册 15% GST）
  - ⚠️ **STREET_ADDRESS** → 暂用 `Mt Wellington`（无街号 · Ray 后补 · 后补后回本文件全局替换）
  - ✅ **STANDARD_SHIPPING_RATE** → `NZ$10.00`（从 Shopify `deliveryProfiles` API 实读 · methodConditions 为空的 Standard rate）
  - ✅ **FREE_THRESHOLD** → `NZ$110`（从同一 rate 反查：另一档 Standard NZ$0 · condition `TOTAL_PRICE ≥ 110 NZD`）
  - ⏳ **SUPPORT_EMAIL** = **未定** —— Codex round 1 抓到：**不能用 `hello@magicengine.cloud`**（Magic Engine 代理商共享邮箱），Magic Picks 需自建独立邮箱（如 `hello@magicpicks.co.nz`）或用 Ray 私人邮箱。粘贴前必须填
  - ⏳ **DATE** = Last updated，PM 粘贴当天填（例 "27 August 2026"）

⚠️ **VITOL 商标风险提示**：VITOL SA 是国际 commodities trader，NZ 小规模零售短期极可能不惹眼，长远若做大有商标 pushback 可能。**Trade name = Magic Picks 完全没问题**，policy 页对客户展示的主标签也是 Magic Picks，VITOL 只在"About us / Legal Notice"作为运营法人露出。

> **粘之前**：先在下方策略文本内把剩余 `[SUPPORT_EMAIL]` 和 `[DATE]` 全局替换完。GST 本店已注册无需删。

---

## 1. Contact Information

Shopify Admin 路径：`Settings → Policies → Contact information → Edit`

```
Trade name: Magic Picks
Phone number:
Email: [SUPPORT_EMAIL]
Physical address: Mt Wellington, Auckland, New Zealand
NZBN: 9429050577675
GST number: 136-124-412
```

---

## 2. Refund Policy（Returns & Refund）

Shopify Admin 路径：`Settings → Policies → Refund policy → Edit`

```html
<h2>Returns & Refund Policy</h2>

<p>We want you to love what you buy from Magic Picks. If you don't, here's how it works.</p>

<h3>14-day returns on unopened items</h3>
<p>Received an item and haven't opened the box? You have 14 days from delivery to send it back for a full refund. Email us first at [SUPPORT_EMAIL] so we can arrange the return.</p>

<h3>Damaged in transit</h3>
<p>If your order arrives damaged, message us as soon as possible — ideally within 48 hours — with photos of the package and the item, so we can lodge a claim with the courier while it's fresh. This 48-hour window is a target for reporting, not a deadline that limits your rights: even if you notice the damage later, we'll still replace or refund a genuinely damaged item, and nothing here overrides your statutory remedies under the Consumer Guarantees Act 1993 (see below).</p>

<h3>Manufacturing defects (12-month warranty)</h3>
<p>Every product Magic Picks stocks comes with a 12-month warranty against manufacturing defects. If something breaks in normal use within that window, contact us with a photo or video and we'll replace or refund.</p>

<h3>Change of mind on opened items</h3>
<p>If you've opened the box and used the item, we can't offer a refund for change of mind. Message us anyway — sometimes we can help.</p>

<h3>Your rights under the NZ Consumer Guarantees Act</h3>
<p>Nothing in this policy limits your rights under the Consumer Guarantees Act 1993. If a product isn't of acceptable quality, isn't fit for purpose, or doesn't match the description, you have statutory remedies regardless of what this policy says.</p>

<h3>How to start a return</h3>
<p>Email [SUPPORT_EMAIL] with your order number and reason. We reply within 1-2 business days.</p>

<h3>Who pays return shipping</h3>
<ul>
  <li>Damaged / defective / wrong item: we cover it</li>
  <li>Change of mind (unopened): you cover it</li>
</ul>

<p>Refunds process within 5 business days of us receiving the returned item.</p>

<p><em>Last updated: [DATE]</em></p>
```

---

## 3. Privacy Policy

Shopify Admin 路径：`Settings → Policies → Privacy policy → Edit`

```html
<h2>Privacy Policy</h2>

<p>Magic Picks collects and handles your personal information according to the Privacy Act 2020 (New Zealand). This policy explains what we collect, why, and what you can do about it.</p>

<h3>What we collect</h3>
<ul>
  <li><strong>When you buy</strong>: your name, delivery address, email, phone number, and payment details (processed by Shopify Payments — we never see your card number).</li>
  <li><strong>When you browse</strong>: your device type, IP address, pages visited, and referral source, via cookies and analytics.</li>
  <li><strong>When you contact us</strong>: whatever information you share in emails, chat, or reviews.</li>
</ul>

<h3>Why we collect it</h3>
<ul>
  <li>To fulfill your orders (delivery, receipts, warranty)</li>
  <li>To respond to your questions</li>
  <li>To improve our storefront and products</li>
  <li>To send you order updates and, if you opt in, occasional promotional emails</li>
</ul>

<h3>Who we share it with</h3>
<ul>
  <li><strong>Payment processing</strong>: Shopify Payments, Apple Pay, Google Pay</li>
  <li><strong>Delivery</strong>: NZ couriers we use to ship your order</li>
  <li><strong>Email</strong>: our email provider for order confirmations and receipts</li>
</ul>

<p>We do NOT sell your data. We do NOT share it with advertisers or data brokers.</p>

<h3>Marketing emails</h3>
<p>Only if you opt in at checkout. Every marketing email has an unsubscribe link at the bottom. Unsubscribing takes effect immediately.</p>

<h3>Your rights</h3>
<p>Under the Privacy Act 2020, you can ask us to:</p>
<ul>
  <li>Show you what personal information we hold about you</li>
  <li>Correct anything that's wrong</li>
  <li>Delete your information (subject to legal record-keeping requirements)</li>
</ul>
<p>Email [SUPPORT_EMAIL] to make any of these requests.</p>

<h3>Cookies</h3>
<p>We use cookies to keep your cart working, remember your login, and understand how visitors use the site. You can disable cookies in your browser settings — some parts of the site may not work properly if you do.</p>

<h3>Complaints</h3>
<p>If you're unhappy with how we've handled your information, contact us first. If we can't resolve it, you can complain to the NZ Office of the Privacy Commissioner (privacy.org.nz).</p>

<h3>Changes to this policy</h3>
<p>We may update this policy. The latest version is always at this URL, with the last-updated date at the bottom.</p>

<p><em>Last updated: [DATE]</em></p>
```

---

## 4. Terms of Service（Legal notice）

Shopify Admin 路径：`Settings → Policies → Terms of service → Edit`

```html
<h2>Terms of Service</h2>

<p>These terms apply to every purchase you make from Magic Picks. By placing an order, you agree to these terms.</p>

<h3>1. About us</h3>
<p>Magic Picks is a New Zealand online store operated by VITOL TRADING LIMITED (NZBN: 9429050577675). Contact: [SUPPORT_EMAIL].</p>

<h3>2. Orders</h3>
<p>Your order is an offer to buy. A contract forms when we send you an order confirmation email. We may decline or cancel an order (e.g. pricing error, stock issue, suspected fraud). If we cancel, we refund you in full.</p>

<h3>3. Pricing & payment</h3>
<ul>
  <li>All prices are in NZD and include 15% GST where applicable.</li>
  <li>We may change prices at any time before you place an order.</li>
  <li>Payment is taken via Shopify Payments, Apple Pay, Google Pay, or approved installment providers.</li>
  <li>We accept only the payment methods shown at checkout.</li>
</ul>

<h3>4. Shipping & risk</h3>
<ul>
  <li>Delivery is per our Shipping Policy.</li>
  <li>Risk in the goods passes to you on delivery.</li>
  <li>Delivery times are estimates, not guarantees.</li>
</ul>

<h3>5. Returns & warranty</h3>
<p>See our Returns & Refund Policy. Nothing in these terms limits your rights under the Consumer Guarantees Act 1993 or Fair Trading Act 1986.</p>

<h3>6. Product information</h3>
<p>We describe products accurately. Images are illustrative — colours may vary by screen. Assembly instructions and specs are included with every product.</p>

<h3>7. Consumer guarantees</h3>
<p>Our goods come with guarantees that cannot be excluded under the Consumer Guarantees Act 1993 (NZ). You're entitled to a replacement or refund for a major failure, and compensation for reasonably foreseeable loss or damage. You're also entitled to have the goods repaired or replaced if they fail to be of acceptable quality and the failure isn't major.</p>

<h3>8. Limitation of liability</h3>
<p>To the extent permitted by NZ law, our liability for any product is limited to the price you paid for that product. We aren't liable for indirect, consequential, or economic loss.</p>

<h3>9. Intellectual property</h3>
<p>All content on this site — text, images, logos, product descriptions — belongs to Magic Picks or is used with permission. Don't copy, reproduce, or use it commercially without our written permission.</p>

<h3>10. Governing law</h3>
<p>These terms are governed by New Zealand law. Any dispute goes to the New Zealand courts.</p>

<h3>11. Changes to these terms</h3>
<p>We may update these terms. The latest version is always at this URL. If you keep buying from us after we update, you've agreed to the new version.</p>

<p><em>Last updated: [DATE]</em></p>
```

---

## 5. Shipping Policy

Shopify Admin 路径：`Settings → Policies → Shipping policy → Edit`

```html
<h2>Shipping Policy</h2>

<h3>Where we ship</h3>
<p>New Zealand only. We don't ship internationally.</p>

<h3>Shipping cost</h3>
<ul>
  <li>Standard NZ shipping: NZ$10.00 flat</li>
  <li>Free shipping on orders over NZ$110</li>
</ul>

<h3>How fast</h3>
<p>Ships from our Auckland warehouse — no 30-day dropship wait.</p>
<ul>
  <li><strong>Auckland metro</strong>: typically next business day</li>
  <li><strong>Rest of North Island</strong>: 2-4 business days</li>
  <li><strong>South Island</strong>: 3-5 business days</li>
  <li><strong>Rural addresses</strong>: allow 1-2 extra business days</li>
</ul>

<h3>Order cut-off</h3>
<p>Orders placed before 12pm Auckland time on a business day usually ship same day. Orders placed after 12pm or on weekends ship next business day.</p>

<h3>Tracking</h3>
<p>Every order gets a tracking link by email once it ships.</p>

<h3>Missed deliveries</h3>
<p>If our courier tries to deliver and no one's home, they'll leave a card. Follow the instructions on the card to arrange redelivery or pickup.</p>

<h3>Damaged in transit</h3>
<p>Message us as soon as possible — ideally within 48 hours — with photos of the package and item, so we can lodge a claim with the courier while it's fresh. See our Returns & Refund Policy for how we handle this and for your rights if you notice damage later.</p>

<h3>Questions</h3>
<p>Email [SUPPORT_EMAIL]</p>

<p><em>Last updated: [DATE]</em></p>
```

---

## 6. Subscription Policy

Magic Picks 当前**无订阅业务**（一次性买椅子/腰垫/太阳能等），Shopify Admin 里这个 policy 留空或不启用即可。未来若加订阅商品（如月度耗材、会员计划）再补。

---

## PM 业务承诺确认 checklist（粘之前）

草稿里内嵌了 6 个业务承诺（跟本 session 早前写进产品描述的 landing content 保持一致）。**如与实际 Magic Picks 商业模型 / 仓库能力不符必须先改**，否则粘贴后就变成合同条款：

- [ ] **14 天未拆封退货** —— 沿用已确认的品牌承诺。若 Magic Picks 想 30 天或不接受 change-of-mind 退货必须改
- [ ] **12 个月生产缺陷保修** —— 若供应商保修短于 12 个月，Magic Picks 得自吃差额或改承诺
- [ ] **48 小时报损通知目标**（不是拒付门槛）—— 现在的措辞已改成「尽快、最好 48 小时内」报损方便我们跟承运商索赔，**不取消 CGA 下的法定权利**；晚报的破损索赔仍然有效，只是核实起来慢一点。确认这个措辞符合 Magic Picks 的实际处理方式
- [ ] **1-2 个工作日邮件回复** —— 客服 SLA，人手够就保留
- [ ] **[SUPPORT_EMAIL] 客服/隐私联系邮箱** —— 必须是 Magic Picks 自己的邮箱，不能用 Magic Engine 共享邮箱 `hello@magicengine.cloud`；退货资料、订单号、照片、隐私访问请求会直接发到这个地址，客户没确认前不能粘贴发布
- [ ] **中午前下单当天发货** —— 需 PM 向仓库核实截单流程确实能保证中午前订单当天出库，做不到必须改承诺或删掉这句
- [ ] **Auckland metro 次日达 / South Island 3-5 天** —— 假设 NZ Couriers 或类似档次。若 Magic Picks 用更慢的服务需改
- [ ] **每单必有追踪链接** —— 需 PM 核实所用的配送服务/流程确实为每一单生成追踪链接，不是只有部分订单有追踪，做不到必须改承诺或删掉这句
- [x] **标准运费金额** = NZ$10.00（从 Shopify `deliveryProfiles` API 实读 · methodConditions 为空档的 Standard rate · 已填入 Shipping policy）
- [x] **免运门槛** = NZ$110（同一 API 反查 · Standard NZ$0 档的 condition `TOTAL_PRICE ≥ 110 NZD` · 已填入）

---

## PM 粘贴 checklist

粘之前先在文档头部把 5 个占位替换完，然后按顺序粘 5 段（Subscription 跳过）：

- [x] `[LEGAL_ENTITY]` → `VITOL TRADING LIMITED`（Ray 2026-08-27 敲定）
- [x] `[NZBN]` → `9429050577675`（Ray 2026-08-27 敲定）
- [x] `[GST_NUMBER]` → `136-124-412`（Ray 2026-08-27 敲定；已注册无需删行）
- [x] `[STREET_ADDRESS]` → `Mt Wellington`（Ray 敲定占位，街号后补 → 拿到后回本文件全局替换）
- [x] `[STANDARD_SHIPPING_RATE_TBD]` → `10.00`（从 Shopify `deliveryProfiles` API 实读 · methodConditions 为空档）
- [x] `[FREE_THRESHOLD_TBD]` → `110`（同一 API 反查 · 另一档 condition `TOTAL_PRICE ≥ 110 NZD`）
- [ ] `[SUPPORT_EMAIL]` 替换（**必须**先跟 Magic Picks 确认真实客服/隐私联系邮箱，**不能用** `hello@magicengine.cloud`）
- [ ] `[DATE]` 替换（粘贴当天填如 "27 August 2026"，4 处 policy 底部各一处）
- [ ] Contact info 粘贴（`Settings → Policies → Contact information`）
- [ ] Refund policy 粘贴
- [ ] Privacy policy 粘贴
- [ ] Terms of service 粘贴
- [ ] Shipping policy 粘贴
- [ ] 每段粘完点 Save
- [ ] 到店铺前台看每段 URL 显示正确（`aai0ep-kt.myshopify.com/policies/refund-policy` 等）

**预计时间**：20 分钟。

---

## Reuse Statement

- **platform-shared**：这套 6 段结构（Contact / Refund / Privacy / Terms / Shipping / Subscription）+ NZ 法律引用（CGA 1993 / Privacy Act 2020 / Fair Trading Act 1986）→ 未来所有 ME Commerce NZ 客户可复用模板，只换 trade name / legal entity / address / GST
- **industry-specific**（`industry-playbook/commerce-market-nz`）：NZ GST 15% · 免运门槛 · 派送时效表 · 消费者权益引用
- **client-specific**：Magic Picks 品牌名 · 客户自己的客服/隐私联系邮箱（`[SUPPORT_EMAIL]`，需客户确认，不用 ME 共享邮箱）· Mt Wellington 仓地址 · 12 月保修承诺
- **未来 Magic Engine Ops backend 上线后**（`write_legal_policies` 尚未实现，只是候选名）：这份草稿可以成为 ME 政策写入 capability 的模板源 → 一键推送到任何 ME Commerce 客户店（`playbook Stage 07` 的 `master_briefs` → `capability: policy-page-writer` → Shopify Admin API）；在此之前仍按本文档开头的「P1，必须进日常任务管道」处理，不当成已经能自动执行
