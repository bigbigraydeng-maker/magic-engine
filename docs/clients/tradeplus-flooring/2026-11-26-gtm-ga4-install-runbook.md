# TradePlus Flooring — 装 Tag Manager + 谷歌统计（GA4）操作清单

> 2026-11-26 准备。客户 11-24 邮件原话要求：「Can you also get Google Analytics and Tag Manager set up on the website, so we can start tracking visits and enquiries properly.」
> 对应合同 v0.2 第 3.1(a)(b) 条。**状态：等客户给权限，还没动手。**

## 一、现在网站是什么样（11-26 只读查过）

- 网站用 **Base44** 搭（在线建站工具），挂在 Cloudflare 后面。改网站必须进客户的 Base44 后台，我们现在没有权限（11-26 浏览器打开 app.base44.com 是未登录）。
- 首页代码里已经有一块追踪设置 `window.TRADEPLUS_TRACKING`：
  - `gtmId: ''` —— 空
  - `ga4Id: ''` —— 空
  - `googleAdsId: 'AW-18539571479'` —— 已填，谷歌广告的基础代码已经在加载
- 网站已经会把下面这些「事件」推给追踪工具（从网站程序文件里查到的）：

| 事件名 | 什么时候触发 | 哪一页 |
|---|---|---|
| `quote_started` | 开始填询价/联系表单 | /get-quote、/contact、/calculator |
| `quote_submitted` | 提交表单（**这是最重要的询盘**） | /get-quote、/contact、/calculator |
| `calculator_completed` | 用完面积计算器 | /calculator |
| `product_added_to_quote` | 把产品加进询价单 | /calculator |
| `conversion` | 某处成交提示（待装好后核实是哪一步） | 待核 |

- **没有**的：点电话（`tel:0733711953`、`tel:0451083336`）、点 WhatsApp（`wa.me/...`）。这两个要在 Tag Manager 里用「点链接」规则补上。
- 网站有 Base44 自带的同意弹窗（cookie consent），追踪要跟着访客的同意选择走，不能绕过。

## 二、要客户给的东西（邮件见 `2026-11-26-email-request-tracking-access-DRAFT.md`）

1. Base44 后台：把 `hello@magicengine.cloud` 加为这个网站的协作者（能编辑）。
2. 一个谷歌邮箱作为 Tag Manager 和谷歌统计的**主人**（合同第 7(b) 条：账号都归客户）。默认用他们管谷歌广告账户 651-312-2984 的那个邮箱。
3. Google Search Console（谷歌搜索后台）如果已有，把 `hello@magicengine.cloud` 加为完全权限用户；没有就我们拿到网站权限后新建。

## 三、拿到权限后的步骤（预计 1–2 小时，含测试）

> **谁开账号（PM 11-26 回「照办」定）**：Tag Manager 和谷歌统计由我们用 `hello@magicengine.cloud` 直接开通，开好后马上把客户给的谷歌邮箱加成最高权限管理员（Tag Manager 的账号管理员 + 容器发布权限；GA4 的管理员）。账号归客户（合同 7(b)），客户随时可以移除我们。不让客户自己开。

1. **建 Tag Manager**：账号名「TradePlus Flooring」，容器 `tradeplusflooring.com.au`（网页）。客户邮箱设为管理员，`hello@magicengine.cloud` 也是管理员。
2. **建谷歌统计（GA4）**：账号「TradePlus Flooring」，媒体资源时区 Australia/Brisbane、币种 AUD；网页数据流 `https://tradeplusflooring.com.au`。客户邮箱设为管理员。
3. **在 Tag Manager 里配**：
   - GA4 基础代码（用 GA4 编号），所有页面；
   - GA4 事件：`quote_submitted`（标为关键事件＝询盘）、`quote_started`、`calculator_completed`、`product_added_to_quote`，把 `lead_type`、`page` 一起带上；
   - 点电话：点击链接以 `tel:` 开头 → GA4 事件 `phone_click`（标为关键事件）；
   - 点 WhatsApp：点击链接含 `wa.me` 或 `whatsapp.com` → GA4 事件 `whatsapp_click`（标为关键事件）；
   - 谷歌广告：转化跟踪代码 + 转化链接器，用 `quote_submitted` 触发；**不再加第二个 AW 基础代码**（网站代码里已经有，重复会算两次）。
   - 同意模式：跟随 Base44 的同意弹窗。
4. **改网站（Base44 后台）**：只填 `gtmId: 'GTM-……'`。**`ga4Id` 留空**——GA4 已经在 Tag Manager 里装了，两边都填会把访问算两遍。`googleAdsId` 不动。
5. **连起来**：GA4 ↔ 谷歌广告 651-312-2984，GA4 ↔ Search Console。
6. **测试（必须当场跑）**：
   - Tag Manager「预览」模式打开网站，逐个做：打开首页、填并提交 /get-quote 表单（备注写 TEST - Magic Engine，提交前先跟客户打招呼，免得当成真单）、点电话、点 WhatsApp、用计算器；
   - 看 GA4「实时」报表能看到这几条事件；
   - 截图存进 `docs/clients/tradeplus-flooring/`，发给客户作为验收（合同 3.1(a) 写了要给测试截图）。
7. **发布** Tag Manager 版本，版本说明写日期和改了什么。
8. **48 小时后复查**：GA4 有没有正常的访问数、谷歌广告里转化状态是否从「配置有误」变成「正在记录」。

## 四、不在这次做

- Meta 像素（Facebook 追踪）：等客户给 Meta Business 权限、主页理顺后再装（合同 3.1(f)）。
- 谷歌广告系列本身的调整：另一件事（合同 3.1(g)），不跟装代码混在一起。
