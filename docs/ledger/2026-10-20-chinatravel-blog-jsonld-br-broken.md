---
id: 2026-10-20-chinatravel-blog-jsonld-br-broken
title: 官网博客文章里手写的结构化数据渲染后换行变成 br 标签，搜索引擎读不出来
status: decided
owner: agent
decided_on: 2026-10-20
source: session:ec90bb17
verify_by: 2026-11-10
verify_how: 构建出的博客页面里，文章内每一块 ld+json 都能被 JSON 解析通过（现在每页 5 块里有 3 块不合法）；修的是博客渲染函数，不是改文章
---
官网窗口 121 号修价格时发现：博客文章里手写的 JSON-LD 经 renderBlogPostHtml 渲染后，换行被换成 br 标签，构建出的两个博客页面里文章内结构化数据都不是合法 JSON，对搜索引擎一直没生效。
这是旧问题，修价格前后一样；价格 PR 已合并，这条不在其范围，优先级低于早鸟展示。
