---
id: 2026-10-31-claude-resolve-own-threads
title: Claude 只能解决自己开的审查对话，新建分支只能在 claude/ 下
status: decided
owner: agent
decided_on: 2026-10-31
source: session:679e38ca
verify_by: 2026-11-07
verify_how: Ray 亲手合入后，在非 A 级 PR 上让 Claude 列出并只解决它自己开的对话，并新建一条 claude/ 分支；人开的或 Codex 开的对话应被拒。
---
包装命令写死一条解决对话的请求，并核对线程、本仓库、触发本次的 PR、未解决、作者是 claude。
新建分支只允许 claude/ 加一段小写名字，拒绝 claude/ledger-verify-。
不改这个自动任务的权限，仍禁止合并、强推、改写历史、批准、标成可合并、删分支。
合这个改动要 Ray 亲手合：这是给 Claude 自己加权限。
