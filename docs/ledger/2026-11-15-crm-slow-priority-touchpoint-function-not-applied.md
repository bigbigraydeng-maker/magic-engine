---
id: 2026-11-15-crm-slow-priority-touchpoint-function-not-applied
title: CRM「全部客人」要等约 8 秒：名单快读用的数据库函数从没装到线上，代码一直在走慢路；装上后再量一次
status: decided
owner: pm
decided_on: 2026-11-15
source: session:96dc6edf
verify_by: 2026-11-18
verify_how: PM 点头后由 76 号把 supabase/migrations 里 2026-10-30 的 crm_priority_touchpoint_batch 迁移 装到线上（只读函数，撤回=DROP FUNCTION）。装好后在浏览器里量「全部客人」那一次名单请求：目前 5.7 秒（其中读数据 4.1 秒）；装好后读数据应降到约 1.5 秒内。没降：看函数有没有被调用到（线上函数是否存在、服务器日志里有没有回落）
---
11-15 实测（已登录浏览器，只读）：全部客人名单请求 5.7 秒，服务器计时 priority_reads=4134ms；今天要联系 10.7 秒；日历 2.9 秒；每个接口还有 0.3–0.7 秒的权限检查。查库发现 crm_priority_touchpoint_batch 函数线上不存在（迁移文件在仓库里，从未应用），代码捕获错误后静默回落到按 1000 条一页的慢读法（CTS 9298 条触点 = 10 次来回）。同一条查询在数据库里单次约 1.1 秒。
