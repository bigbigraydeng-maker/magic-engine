# 官网「上海周边团」价格收成单一来源 — 现状盘点与后续做法

日期：2026-10-06 · 来源：子牙转述 PM 要求 · 结论：**本次改价 PR（chinatravel 仓 #223）只换数字，不收单一来源**；收口另开后续 PR。

## 为什么本次不做
这个团的价格在官网代码里被各写了一遍：18 个文件、57 处（另有 1 个静态网页 2 处）。其中约一半是长文案里的数字（页面描述、FAQ 答案、博客正文），要改成“引用”就得把这些字符串逐个改成拼接，每改一处都可能写错一个字，且改动面横跨广告落地页、对比页、博客。放进“改价”这个要等 PM 说“合”的 PR 会增加风险，所以拆开。
Google 读的价格数据（JSON-LD offers price）和 sitemap：产品页的 JSON-LD 本来就是从 `tours.ts` 的 `price` 字段自动取数（`src/lib/schema-tour.ts`），已随本次改价变成 2699；sitemap 里没有价格，不用改。

## 现在的“来源”分三档（括号里是本次改动的处数）
**A. 已经是单一来源，不用动**：`src/lib/data/tours.ts` 的 `price`（产品页价格、产品页 JSON-LD、`FlagshipTourGrid` 卡片都读它）。

**B. 容易改成引用（低风险，建议先做）**——都是“一个字段/一张卡片”，可以直接读 `getTourBySlug('china','discovery','shanghai-surroundings').price`：
- `src/app/best-china-tours/page.tsx` 的 `priceNZD`（页面 JSON-LD 读它）
- `src/app/china-tours-from-new-zealand/page.tsx` 的 `price`
- `src/app/china-tours-for-seniors/page.tsx` 的 `priceFrom` 和“Quick Facts”那一行
- `src/components/seo/DestinationGuide.tsx` 的 6 张相关团卡片
- `src/app/tours/[destination]/[tier]/[tour]/page.tsx` 的 Next Departure 横幅（页面里本来就有 `tour` 对象）
- `src/lib/campaigns/october-2026-discovery.ts`、`OctoberDiscoveryCampaignContent.tsx`、`spotlight/october-2026/page.tsx`、`small-group-china-tours/page.tsx`、`china-travel-specialists-nz/page.tsx`、`shanghai-surroundings-discovery-guide/page.tsx`（各 1–2 处展示价）

**C. 写在长文案里（要拼接，风险较高）**：`best-china-tours` 的描述/FAQ/AI 摘要、`seo-pages.ts`（标题、描述、FAQ）、`blogs-longtail-batch1/3.ts`、`discovery-guides.ts`、`china-tours/page.tsx`、`china-tours-for-seniors` 的描述与 FAQ。做法：加一个小函数（例如 `shanghaiFromPrice()`，读 `tours.ts`），文案里用模板字符串拼进去；博客正文改完要逐篇看渲染。

**D. 静态网页，无法引用**：`public/campaigns/cts-china-2027.html`（2 处）。要么让它也走构建时生成，要么保留手改并在检查清单里点名。

## 建议的后续（等 PM 排期）
1. 先做 B（约 12 个文件、改动机械），并加一条自动测试：页面里凡是“Shanghai & Surroundings”旁边出现的 NZD 价格，必须等于 `tours.ts` 的价格——以后有人写死旧价，测试直接变红。
2. 再做 C，逐篇博客目视检查。
3. D 单独决定。
4. 改完后，改价只需改 `tours.ts` 一处；客服机器人那边的价格仍是另一份（见同目录 `2026-10-06-shanghai-surroundings-price-bot-sync.md`），两边仍要同日同步。

## 措辞核对（“最低入门价”）
`best-china-tours` 等页面有 “lowest entry price / lowest published entry price across our four flagship China tours / For lowest price”。改价后这个团 2,699 仍低于另外三个主打团（3,480 / 3,880 起 / 7,999），**仅限“我们自己四个主打团之间”的比较，成立**。本 PR 保留原文，没有新增 cheapest / “NZ 最低价”这类对外绝对说法。竞品调研结果出来之前，建议后续把这类句子软化成“CTS 四个主打团里起价最低”。
