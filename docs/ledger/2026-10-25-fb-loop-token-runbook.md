---
id: 2026-10-25-fb-loop-token-runbook
title: Facebook 闭环先修令牌：运行手册和断点查询已写好，Meta 后台还没做
status: decided
owner: pm
decided_on: 2026-10-25
source: issue:3087
verify_by: 2026-10-27
verify_how: Claude 在 Ray 在场时按 docs/runbooks/meta-system-user-token.md 做完系统用户和令牌，并在该 PR 上回报每家客户断在哪一环；令牌值没有出现在聊天、GitHub 或日志里
---
Ray 要求先跑通 Facebook 主页、广告和 CRM。这一步只写操作说明和只读查询。
令牌放进现有环境变量，名字在运行手册里。不改程序，不连生产库，不发帖，不建广告。
#3092 的客户代号和真名对不上，待确认。#3076 未合并，死的主页令牌仍可能被当成有效连接。
