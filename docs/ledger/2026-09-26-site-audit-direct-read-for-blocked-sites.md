---
id: 2026-09-26-site-audit-direct-read-for-blocked-sites
title: 被客户网站防火墙挡住的站，改成由 ME 服务器直接读页面，之后请客户放行才有用
status: decided
owner: pm
decided_on: 2026-09-26
source: session:3b976bb5
verify_by: 2026-10-10
verify_how: 先实测再开发，两项都成算成：①在一个被挡的客户站（今天是 Oztop）请客户把 ME 服务器出口地址加进白名单后，经第三方阅读服务再读一次被挡页，仍被挡 = 证实白名单对这一路无效；②把该站改为 ME 服务器直连读取并重扫后，最近 14 天被挡页数降到 0，正文字数恢复
---
来源：PR #2040 复审（魏征、子牙）。site-audit 读每页正文只经第三方阅读服务（src/lib/site-audit/crawler.ts 读页那段 → src/lib/brief/jina.ts），客户防火墙看到的是该服务的地址；这一点目前只按代码路径确认，还没在客户站实测。
今日待办「页面被防火墙挡住」那条让读者回一句「换通道」，本卡就是接这句话的地方：PM 决定是否排期，排上后开发窗口按 ① → ② 做。
开发范围：对被挡的站改由 ME 服务器直连读取（或走固定出口代理），再按 docs/sops/client-site-siteground-allowlist.md 请客户放行。
