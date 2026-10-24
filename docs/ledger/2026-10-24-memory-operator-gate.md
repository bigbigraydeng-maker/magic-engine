---
id: 2026-10-24-memory-operator-gate
title: 客户记忆库只对内部账号开放，门户成员打不开也改不了
status: decided
owner: agent
decided_on: 2026-10-24
source: issue:3098
verify_by: 2026-11-01
verify_how: 用 access_type 为 both 或 dashboard、且 scoped_admin 为否的客户账号打开记忆页，应看到拒绝，接口返回 403；内部名单或 scoped_admin 账号仍能打开并编辑。不要用生产库核对账号。
---
页面文案写着仅内部可见，接口却只查了付费成员。客户角色（both / dashboard）因此能读、改、删、导出。
门改成认内部身份：精确管理员名单、管理员域名、受限管理员。不认 access_type。
