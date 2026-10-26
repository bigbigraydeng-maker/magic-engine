---
id: 2026-10-27-crm-backfill-unassigned-contacts
title: 把 CTS 1165 位未分配的老客人一次性分给 Lisa（已写入生产库，可撤销），并让轮流分配只比最近 30 天新进来的
status: done
owner: pm
decided_on: 2026-10-27
source: session:aedf9b5a
verify_by: 2026-11-03
done_on: 2026-10-27
done_ref: pr:3260
verify_how: 看 CTS 客人页「我的待跟进」：Lisa 名下约 1166 位，「未分配」只剩 47 位（16 位别再联系 + 31 位非咨询 / 不感兴趣 / 已付全款）；库里 select count(*) filter (where assigned_to is null), count(*) from contacts where client_id=CTS 应为 47 对 1213 起步（之后新客人会增加总数）。Baker 加进名单后，新进来的客人应开始分给他而不是全给 Lisa。员工若反映 Lisa 名单太乱，按 check_note 的撤销办法处理。
check_note: 撤销办法（只撤本次回填）：update contacts set assigned_to=null where client_id=CTS and assigned_to=Lisa 的登录邮箱 and first_seen_at <= '2026-10-26 20:34:45+00' and id <> 'd15604f1-a62c-4621-a63f-72eb50467a5b'。回填时间 2026-10-26 20:34:45 UTC，当时 1212 位未分配、写入 1165 位，读回核对一致。
---
PM 2026-10-27 回「可以回填」。先只读演算（1165 将分、47 跳过），再单条 UPDATE，条件带「只补空」，读回数字一致，名单只有 Lisa 一人所以全分给她。
跳过的 47 位不进跟进人待办：16 位别再联系、31 位非咨询 / 不感兴趣 / 已付全款。
副作用已在本 PR 修：轮流分配原来数名下全部客人，回填后 Baker 加进来会被连续分到所有新客人；现在只数最近 30 天新进来的。
