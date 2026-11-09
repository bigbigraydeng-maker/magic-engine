---
id: 2026-10-18-ads-account-status-todo
title: Meta 广告账户状态不是正常超过 24 小时，进今日待办（PM 看得见欠款停摆）
status: done
owner: agent
decided_on: 2026-10-18
source: doc:docs/specs/2026-10-18-ads-loop-three-fixes-design.md
verify_by: 2026-10-25
verify_how: 合并部署后今日待办里能看到 CTS 个人账户（状态 3，从 10-11 起）那一条，点开链接到体检页；账户结清后那条自动消失
done_on: 2026-10-18
done_ref: pr:2805
---
修复①：账户状态读取抽成共享函数，新增三种待办（异常超 24 小时 / 读不到 / 已关闭每周一次）。
只读、不改 Kernel、不写库；作战地图展示不变。
