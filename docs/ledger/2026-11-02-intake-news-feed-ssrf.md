---
id: 2026-11-02-intake-news-feed-ssrf
title: 选题进料 news_feeds 必须挡内网/SSRF
status: done
owner: agent
decided_on: 2026-11-02
source: pr:3500
done_on: 2026-11-02
done_ref: pr:3500
---
PR #3500：news RSS 仅允许客户自配 URL；配置层用 viral-url-guard 语法校验，抓取走 safeFetchText（含重定向逐跳校验）。无 news 平台客户行为不变。
