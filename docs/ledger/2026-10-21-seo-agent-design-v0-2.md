---
id: 2026-10-21-seo-agent-design-v0-2
title: SEO Agent 设计稿 v0.2 已写（吸收子牙+魏征审）（挂在广告 Agent 体系下），第一刀对总览页与上海团页出了数据建议
status: decided
owner: agent
decided_on: 2026-10-21
source: session:2cd3c621
verify_by: 2026-10-28
verify_how: 74 号 / 119 号对表请求合同字段后，SEO Agent 第一版处理函数对一条真实 seo_request 跑通「请求→回执→对账」各一次；跑不通则回设计稿改。设计稿本身子牙 + 魏征已各审一次（有条件通过，意见已并入 v0.2）；定位需 98 / 73 对表，PM 点头。
---
设计稿：docs/specs/2026-10-21-seo-agent-design-v0.2.md。结论：现有 SEO 管线（取数、信息完整闸门、周名次、对账、受保护页、发布后监控）可直接做能力，缺口只有搜索词入口、词归属台账、请求回执落库、站点地图体检。
第一刀建议里需 PM 点头的两项（上海博客加内链、追踪词写生产配置）还没做，等批准。
