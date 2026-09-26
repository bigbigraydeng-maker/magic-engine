---
id: 2026-09-27-ads-circuit-events-append-only-table
title: 熔断判定进一张只能追加的账本表，同一天同一条判据可以留多行，谁也不覆盖谁
status: done
owner: agent
decided_on: 2026-09-27
source: session:d9b147f8
done_on: 2026-09-27
done_ref: commit:071230667a69
verify_by: 2026-10-04
verify_how: 生产库上再查一次两件事——访问策略角色一栏必须只有 service_role；试着写一行取值不在允许清单里的必须被数据库拒。两条都对才算建对。
---
PM 2026-09-27 说「go 建表」→ 已在生产库 glbdnayojixmexgofbsd 通过 Supabase MCP apply_migration 建表。
现场验过闸真的咬得住：DO block 里连续插两行坏取值（outcome='deny' 与 trigger_code='made_up_code'），
CHECK 各 catch 一次；查行数 rows_left=0，没有任何东西漏进表里。
访问策略：{service_role} / ALL / USING true / WITH CHECK true，跟 ads_autonomy_sync_receipts 形状一致。
这张表刻意不加「同客户同天同判据唯一」的约束：一天可能跑多轮，每次都是独立事实。
