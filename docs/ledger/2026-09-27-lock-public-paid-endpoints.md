---
id: 2026-09-27-lock-public-paid-endpoints
title: 关掉两个谁都能调、每次都花钱的接口（删 /api/diagnose，keyword-gap 只许全局管理员调）
status: decided
owner: agent
decided_on: 2026-09-27
source: session:2be228ab
verify_by: 2026-10-04
verify_how: 合并上线后不带登录访问 /api/diagnose 应 404、/api/public-scan/keyword-gap 应 401，且 DataForSEO / OpenAI 当天用量没有来自这两个路径的调用
---
2026-09-27 只读盘点发现：/api/diagnose 公开，每访问一次调一次 OpenAI + Claude，还写死了一个客户名；keyword-gap 公开，任何域名都能触发 DataForSEO 付费查询。
两者在本仓、定时任务配置、4 个兄弟站点仓里都零调用方。diagnose 按 2026-08-19 退役 spec 组 G 直接删除；keyword-gap 保留，但先过全局管理员门、禁止公共缓存。
风险级别 A（鉴权 + 花钱），PR 保持草稿直到子牙 / 魏征 / 狄仁杰三方审完。
