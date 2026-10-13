---
id: 2026-09-29-ads-ownership-missing-capture-audit-row
title: 广告归属判定没有堵住"广告层抓取审计记录一条都没有、但有历史广告快照数据"这种账户（评估过，判断不在本 PR 修，未排期）
status: verified
owner: agent
decided_on: 2026-09-29
source: session:b487d1fb
verify_by: 2026-10-13
verify_how: 查 ad_snapshot_captures 表：找一个 client_id+ad_account_id 组合，level='ad' 的行数=0，但 ad_entity_snapshots 里同一账户 level='ad' 的行数>0。查得到 → 说明这个场景在生产真实存在，需要单独立项修；查不到（在用的账户都是配对写的）→ 判定成立，关卡
done_on: 2026-09-29
done_ref: commit:abfcf100
last_checked: 2026-10-13
check_note: 生产库全量比对（审计 830 行 / 快照 3452 行，均 level=ad）：5 个有广告层快照的账户组合全部有对应审计行，命中 0——当初不修的判断成立
verified_ref: doc:docs/ledger/evidence/2026-09-29-ads-ownership-missing-capture-audit-row--2026-10-13.md
---
自动审查（Codex）建议把"一条广告层抓取审计记录都没有"也当作数据太旧处理。评估后判断：抓取程序把同一轮同一层的快照和审计记录配对写入，正常情况下不会出现"有广告快照、却没有对应审计行"；照字面实现会让大量没显式设置这个字段的既有测试误判，波及面和这条问题的实际发生概率不成比例，本 PR 未采纳，留给夜巡按上面的查法验证一次。

**2026-09-29 更正：上面这条判断错了，已在同一个 PR 修好（见 done_ref）。** Codex 下一轮给了具体代码证据——`snapshot-sync.ts` 的 `captureAccountSnapshots` 先分块写 `ad_entity_snapshots`，再单独一次 insert 写 `ad_snapshot_captures` 审计行，两次写入没有事务包起来，后一步单独失败时前一步已经写进去的广告快照会留下、没有审计记录。当时"配对写入"的说法没有实际去读这份代码验证。补回堵漏后，波及面问题改用给测试 fixture 默认补一条新鲜审计记录解决，不再是"只能不修"。
