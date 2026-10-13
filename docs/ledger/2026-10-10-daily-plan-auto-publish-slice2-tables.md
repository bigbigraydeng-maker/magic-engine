---
id: 2026-10-10-daily-plan-auto-publish-slice2-tables
title: 自动发布第二刀：两张记授权的表要等 PM 同意才建，建完上线才算数
status: decided
owner: pm
decided_on: 2026-10-10
source: pr:2430
verify_by: 2026-10-14
verify_how: PM 回「建表合并」后：线上两张表已存在（只有后台服务能读写），授权接口预览能走通；没动静就是卡在 PM 这一步
---
代码与建表文件在草稿 PR #2430（风险 A，三位审查已过）。建表是改线上数据库，必须 PM 明确同意；先建表、再合代码。
第三刀（定时自动发布）的硬前置条件见 docs/specs/2026-10-10-daily-plan-auto-publish-design.md §16。
