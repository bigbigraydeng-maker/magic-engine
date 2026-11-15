---
id: 2026-11-16-crm-list-change-log-migration
title: CRM 名单治本第 1 刀：数据库加「改动记号」表和触发器，等 Ray 亲手合并、再回「装」才上正式库
status: decided
owner: pm
decided_on: 2026-11-16
source: session:96dc6edf
verify_by: 2026-11-20
verify_how: Ray 合并本 PR 并回「装」后，正式库装上；装完当场只读核对：crm_list_change_log 在有人写入后行数增加、业务写入无报错；不成就按 migration 文件末尾的撤回办法删掉触发器
---
PM 2026-11-16 回「开始」。做法比设计稿更保守：不是把一个数字加一（两个同时写会互相等，还可能死锁），而是每次真实改动只追加一行，读的一方数行数。本机 Postgres 17 副本实跑 31 种情况全过（场景脚本在 docs/ledger/evidence/2026-11-16-crm-list-change-log-scenarios.sql），另测了两个事务同时写不互相等、5000 次单条写入多花约 25 毫秒。

这一刀不改任何页面行为，正式库还没动。合并不等于装上：合并后要 PM 回「装」才对正式库执行。
