---
id: task_meta_client_token_db_verify
title: 验证 DB 存储的客户 Meta 口令能被各路代码正确读取
status: decided
owner: agent
decided_on: 2026-10-25
source: PR #3145
verify_by: 2026-11-01
verify_how: 口令存入 DB 后第一个工作日，检查三件事：1) google-data-pullback-daily cron 能用 DB 口令拉到该客户的 Meta 数据（看 cron 日志有无报错）；2) 今日待办里该客户的 Meta 口令健康检查显示 alive 且来源是「ME 后台数据库」而非 Render 环境变量；3) CAPI 回传（如该客户有开）正常发出且 source 记为 platform_oauth_connections
---
PR #3145 加了从 platform_oauth_connections 读客户 Meta 口令的代码路径（DB 优先、env-var 兜底）。因为还没有 Settings UI 让 PM 把口令存进 DB，新路径目前不会被走到。等 Settings UI 做完、PM 粘贴了第一个客户的口令之后，要验证上面三件事。
