---
id: 2026-11-28-me-google-ads-data-not-flowing
title: 老版 ME 的数据板块收不到谷歌广告数据：两处断点，等 PM 定要不要接通
status: decided
owner: pm
decided_on: 2026-11-28
source: session:ca3e0d15
verify_by: 2026-12-04
verify_how: 在已登录浏览器请求生产只读接口 google-ads/campaigns（带客户设置里的账户号），返回系列列表算凭据已通；再查 flywheel_metrics 有来源为 google_ads_pullback 的行算数据已进。两样都没有就问 PM 是接通还是搁置，并把答复记在本卡
---
11-28 实查：数据板块和每天拉谷歌广告数据的程序都在，但从未有一条谷歌广告数据进库。
断点一：线上接口返回「凭据未配置」，与 [[2026-10-10-google-ads-credentials-wired]] 只缺开发者令牌一致，只有 PM 本人能取。
断点二：每天的任务只认 platform_oauth_connections 里的 google_ads 连接，而这条记录没有任何程序会写；客户设置里填的账户号它不读。
现在进库的只有网站分析里「付费搜索带来的访问和询盘」三项，没有页面或 agent 在读。卫青手册写明不管谷歌广告。
