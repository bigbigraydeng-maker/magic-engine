---
id: 2026-10-10-work-logs-client-ownership-fix
title: 工作日志接口补上客户归属校验：客户只能读自己那份，写和删只给 ME 团队
status: done
owner: agent
decided_on: 2026-10-10
source: session:1a8b735d
verify_how: 合并上线后用一个客户账号实测：读自己客户的日志成功、把网址里的客户编号换成别家返回 403、发写入和删除请求返回 403；再用 ME 管理员账号确认读写删正常
done_on: 2026-10-10
done_ref: pr:2433
---
A 级，草稿 PR，待子牙、魏征、狄仁杰三审与 PM 本人回「合」。
「客户可读」口径由统筹窗口转述 PM 2026-10-10 的回答，PM 合并时确认。
单测 28 条全过、8 处变异全被抓到；真实登录态只能上线后验。
