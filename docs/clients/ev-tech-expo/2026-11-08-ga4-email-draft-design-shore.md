# 给 Design Shore 的邮件草稿（购票页追踪）· 2026-11-08 · 按追踪设计 v2（路线已定：落官网）

**状态：只是草稿。没发，也没建 Gmail 草稿。PM 点头后再发。**
**编号已填**：ME 自己的 GA4 编号 `G-G6SYRV7QSC`（11-08 由主窗口建好，媒体资源「NZ EV Tech Expo – ME」），邮件里三处已填好。谷歌顺带生成的打包标签 `GTM-WRHR83CH` 不用，邮件里也没写它。

- 收件人：Glenn Phoenix，Design Shore，`glenn@designshore.co.nz`
- 抄送：Steven Lin，BWK Group，`steven@bwknz.co.nz`
- 发件：hello@magicengine.cloud（建议）
- 依据：`2026-11-08-tracking-utm-design-v2.md`

必做的只有第 1、2 项。第 3、4、5 项都是可选的。

---

## 英文原文

**Subject:** NZ EV & Tech Expo – small tracking update on the /register page (no changes to existing tags)

Hi Glenn,

Thanks again for your help with the Facebook page access last week.

We're running the final Meta ad push for the Expo, and all of our ads send people to the ticket page (https://www.evtechexpo.co.nz/register). We'd like to see how many orders our ads bring in, **without touching any of the existing tracking on the site**. The current Google Tag Manager container, GA4, Google Ads and Meta pixel all stay exactly as they are.

Could you please make the two changes below to the /register page, ideally by **12pm on Tuesday 10 November**, since the Expo opens on the 13th?

**1. Add our own GA4 tag directly in the page (not in GTM)**
Please add this to the `<head>` of /register (site-wide is fine too, if your template has a shared header):

```html
<!-- Magic Engine GA4 -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-G6SYRV7QSC"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-G6SYRV7QSC');
</script>
```

**2. Record completed orders from the Eventbrite widget**
The page already passes `onOrderComplete: exampleCallback` to the Eventbrite widget, but the callback only writes to the console. Please replace the `exampleCallback` function with the one below. The `createWidget` settings stay exactly as they are.

```html
<script type="text/javascript">
var exampleCallback = function (data) {
  var orderId = (data && data.orderId) ? String(data.orderId) : '';
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event: 'ticket_order_complete', eb_order_id: orderId });
  if (typeof gtag === 'function') {
    gtag('event', 'ticket_order_complete', {
      send_to: 'G-G6SYRV7QSC',
      transaction_id: orderId,
      eb_order_id: orderId
    });
  }
};
</script>
```

`send_to` makes sure the order is only sent to our GA4, not the existing one. Please don't change, pause or remove anything in the existing GTM container (GTM-WGWNTM65) or the existing GA4 (G-YR0BVY2DX5).

**3. Optional: pass a tracking-link code into the widget**
Only if Steven sets up Eventbrite tracking links for us. We'll confirm separately, so please hold off on this one until then. If he does, this lets Eventbrite report tickets and revenue per ad group. It adds an `affiliateCode` to the widget when the page URL has one. For our ads that are already running, it maps their existing link tags to the code, so we don't need to edit those ads:

```html
<script type="text/javascript">
(function () {
  var p = new URLSearchParams(window.location.search);
  var legacy = {
    'women30|family_upclose': 'me_g1_family',
    'segments|ev_testdrive_all': 'me_g2_ev',
    'segments|ev_latest_all': 'me_g2_ev',
    'segments|tech_livedemos_all': 'me_g3_tech',
    'students|uniracing_team': 'me_g4_uni',
    'magicengine|test_drive_evs_in_auckland': 'me_video_testdrive'
  };
  var aff = p.get('aff') ||
    legacy[(p.get('utm_campaign') || '') + '|' + (p.get('utm_content') || '')] || '';
  var config = {
    widgetType: 'checkout',
    eventId: '1989458060614',
    iframeContainerId: 'eventbrite-widget-container-1989458060614',
    iframeContainerHeight: 425,
    onOrderComplete: exampleCallback
  };
  if (aff) { config.affiliateCode = aff; }
  window.EBWidgets.createWidget(config);
})();
</script>
```

(This replaces the existing `createWidget` block. It also passes through any other `?aff=` tracking link someone arrives with, which the widget doesn't receive at the moment.)

**4. Optional, but likely to help ticket sales (please check with Steven first)**
On mobile, the "Driving the Future…" loading screen stays up until everything on the page has finished loading (including the Eventbrite widget), plus another 1.5 seconds. In our tests on a fast connection, that was about 4.5–6.5 seconds of black screen, and the ticket box then sits below the first screen. Two small changes:
- In `mainassets/theme/assets/js/main.js`, change the preloader's `window.addEventListener("load", …)` to `"DOMContentLoaded"` (or cap it at about 1.5 seconds).
- Add a "Buy tickets" button near the top of /register that scrolls down to the ticket box.

**5. Optional: read-only access**
If you or BWK manage the existing GA4 property, Viewer access for `hello@magicengine.cloud` would be a nice extra. It's not required.

**When it's live**
A quick reply with the time it went live is all we need. We'll check it on our side straight away, without placing an order. If someone at BWK can place one real test order (a free ticket is fine, and it can be cancelled in Eventbrite afterwards), that would confirm the whole flow. If not, we'll confirm it from the first real orders.

I expect items 1 and 2 are about 15–30 minutes of work. If any of this is billable, please let Steven and me know before you start.

Many thanks,
Ray
Magic Engine
hello@magicengine.cloud

---

## 中文翻译（给 PM 看，不发）

**主题：** NZ EV & Tech Expo：购票页 /register 的一个小追踪更新（不动现有代码）

Glenn 你好，

再次感谢你上周帮忙开 Facebook 主页权限。

我们在给展会做最后一轮 Meta 广告冲刺，所有广告都把人带到购票页（https://www.evtechexpo.co.nz/register）。我们想知道广告带来了多少单，而且**不动网站上任何现有追踪**：现在的 Tag Manager、GA4、Google Ads、Meta 像素全部保持原样。

展会 13 号开幕，麻烦最好在 **11 月 10 日（周二）中午 12 点前**在 /register 页做下面两项改动：

**1. 把我们自己的 GA4 代码直接写进页面（不放进 Tag Manager）**
放在 /register 的页头里。如果网站模板有公共页头，全站放也可以。

**2. 记录 Eventbrite 购票框里付款完成的订单**
页面已经把付款完成函数传给了购票框，但这个函数现在只在浏览器后台打一行字。请把它换成上面那段：付款完成时记一单，带订单号。购票框其他设置不动。
`send_to` 保证这一单只记进我们的 GA4，不进现有那个。请不要改、停或删现有 Tag Manager（GTM-WGWNTM65）和现有 GA4（G-YR0BVY2DX5）里的任何东西。

**3. 可选：把追踪链接代号传进购票框**
只有 Steven 给我们建了 Eventbrite 追踪链接才需要做。我们会另外确认，在那之前请先别做。做了以后，Eventbrite 能按广告组报票数和金额。代码会在网址里有代号时传给购票框；在投的广告会按它们现有的标记自动换成代号，不用改广告。这段会替换现有的购票框设置；别人带着 `?aff=` 追踪链接进来的，现在也会一起传给 Eventbrite（目前收不到）。

**4. 可选，但很可能帮助卖票（请先跟 Steven 确认）**
手机上，「Driving the Future…」加载画面要等页面所有东西都加载完（包括 Eventbrite 购票框），再多等 1.5 秒才消失。我们在快网络下测，黑屏大约 4.5–6.5 秒，之后购票框还在第一屏下面。两个小改动：
- `main.js` 里加载画面那行，把 `"load"` 改成 `"DOMContentLoaded"`（或者最多显示约 1.5 秒）。
- 在 /register 顶部加一个「Buy tickets」按钮，点了滑到购票框。

**5. 可选：只读权限**
如果现有 GA4 是你们或 BWK 在管，给 `hello@magicengine.cloud` 一个查看者权限会更好，但不是必须的。

**上线后**
回一封简短的邮件说几点上线就行，我们马上自己检查，不用下单。如果 BWK 有人能下一单真实测试（免费票就行，之后可以在 Eventbrite 取消），就能确认整个流程；做不了的话，我们用第一批真实订单确认。

估计第 1、2 项 15–30 分钟。如果有任何一项要收费，开工前请先告诉 Steven 和我。

谢谢，
Ray
Magic Engine
hello@magicengine.cloud

---

## 发之前 PM 要知道的

- ME 的 GA4 已建好，编号 `G-G6SYRV7QSC` 已填进三处代码（页头两处、付款完成的 `send_to` 一处）。
- 必做只有第 1、2 项。第 3 项要等 Steven 建追踪链接，邮件里已请 Glenn 先别做。
- 第 4 项改的是所有访客都会看到的页面效果，包括 Squid 带来的人，所以写成「先跟 Steven 确认」。
- 「BWK 下一单测试」会在客户的 Eventbrite 里留一条订单，写成「能做就做」。
- 邮件里写了「要收费先告诉我们」，不会在没说好的情况下产生费用。
- 邮件没提 Squid 的名字。
