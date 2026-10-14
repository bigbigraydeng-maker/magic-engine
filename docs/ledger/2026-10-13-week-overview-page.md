---
id: 2026-10-13-week-overview-page
title: 每日计划页新增「发布日历」只读标签（原名本周总览）：看每天的 Story、视频 Reel 与名额；图文 Post 尚未接入
status: decided
owner: pm
decided_on: 2026-10-13
source: session:61a3b5f4
verify_by: 2026-10-20
verify_how: 合并上线后 PM 打开 /dashboard/clients/<CTS 客户 id>/daily-plan?tab=overview：顶部写演练模式或真发已开、已授权与否、「内容已排好，看一遍点一次授权」；按新西兰日期并排 Story 与名额（没配置显示「名额未配置」）；下方 Reel 与「没能进日历」栏；5 秒内出页面
---
范围：只读、仅全局管理员；读取在服务端按客户过滤，不下载原图；不动任何发布、授权、开关逻辑。
名额读 clients.publishing_calendar_config、Story 角色读 story_items.role：两列的建列 SQL 只写未执行（docs/migrations-sql/2026-10-14-publishing-calendar-config-NOT-APPLIED.sql），要 PM 批了才建；没建时页面显示「名额未配置」。
Post 周包与「报名」做出来后再接入图文 Post 与「没能进日历」栏。
