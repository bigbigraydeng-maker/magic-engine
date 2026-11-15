---
id: 2026-11-16-telegram-todo-push-pr1
title: 今日待办接到现有 Telegram，先只推文字不点批准
status: decided
owner: agent
decided_on: 2026-11-16
source: session:b1e5b1e5
verify_by: 2026-11-20
verify_how: 开关保持关闭时，出确认卡和早间待办邮件都不发 Telegram；打开后只发文字和链接。点按钮和打字都不会执行。不新建机器人，也不改回调地址。
---

PR-1 只验密钥、只认 Ray 的账号、推早间清单和出卡提醒。文字和按钮都不算批准。PR-2 才接按钮。机器人是 @magicengine_ray_bot；仓库里原先没有这个名字，也没有旧的环境变量名。
