---
id: 2026-11-08-ads-agent-chat-investigation-tools
title: 项目鲁班只读广告调查工具（L2）
status: done
owner: agent
decided_on: 2026-11-08
source: pr:3657
verify_by: 2026-11-15
verify_how: 启用 ads_agent_investigation_tools 的客户在鲁班对话里能调四个只读调查工具；共用账户与 hidden_from_ad_health 仍被跳过；输出带 could_not_read 进 evidence。
done_on: 2026-11-08
done_ref: pr:3657
---

鲁班项目对话接四个只读广告调查工具（`src/lib/ads-strategy/agent-chat/*`），经 `clients.leads_config.ads_agent_investigation_tools` 开关注册。
不调 Meta 写、无 migration、未改 boundaries。
PR #3657 收口：共用账户与 hidden_from_ad_health 跳过；读失败进 evidence / could_not_read。
