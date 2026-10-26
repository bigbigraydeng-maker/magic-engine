---
id: 2026-10-27-apify-meta-ads-killswitch
title: 关掉没人看的 Apify Meta Ad Library 抓取（省 ~$100/月）
status: decided
owner: agent
decided_on: 2026-10-27
source: session:19583486
verify_how: 部署后到 Apify Dashboard 看 Facebook Ads Library Scraper 的 Runs 列表，确认不再有新 run 出现（既有的三条调用方：competitor-collector、ads-collector、advanced-agent，走的都是 try/catch 兜底，返错后直接 null，不会再发 Apify 请求）。11-05 Apify 月度额度重置后观察更干净。
---
PM 2026-10-27 回 `A`：Apify 的 Facebook Ads Library Scraper 一个月跑到 ~$100 撑爆月限额；查完发现抓来的数据只喂到后台一个「竞品 Meta 广告」卡片，没人在用，不进任何自动决策。
改法：`src/lib/apify/ad-library.ts` 里的 `scrapeCompetitorMetaAds` 默认早返错，`APIFY_META_ADS_ENABLED=1` 可开回来。三处 caller 本来就有兜底，不用改。
没做：没删这个函数，没删 UI 卡片——以后想开回来只要一个环境变量，不想开永远留空数据。
