---
id: 2026-10-24-client-home-entries
title: 客户登录后只看到自己打得开的入口
status: done
owner: agent
decided_on: 2026-10-24
source: issue:3100
verify_by: 2026-11-01
verify_how: 用一个 scoped_admin 为 false、access_type 为 both 或 dashboard、且不在管理员名单里的门户账号登录，客户主页没有 Story、记忆库、本周总览、短视频；侧栏写 Client view。精确管理员名单里的账号仍看得到这些入口。
done_on: 2026-10-24
done_ref: pr:3117
---
门户成员不是内部账号。内部只认管理员精确名单、管理员域名、DEMO_ADMINS、scoped_admin。
both 和 dashboard 都是付费客户视角，不是管理员。
记忆库的服务器拒绝在 pr:3113，这张只藏入口。
