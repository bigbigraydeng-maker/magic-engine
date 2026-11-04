---
id: 2026-11-04-ads-autonomy-human-only-resync-verify
title: 自动暂停建议改成一律要审批、被拦的进今日待办——上线后当场手动同步一次，核两家规则
status: done
owner: agent
decided_on: 2026-11-04
source: doc:docs/ledger/evidence/2026-11-04-ads-auto-pause-policy-check.md
verify_by: 2026-11-11
verify_how: 部署后当场手动发一次同步事件（用新的事件编号，CTS、NAL 各一次），回读两家 ads.auto_pause_on_d3 生效规则为 require_approval，且 ads_autonomy_sync_receipts 各有一行对应 to_mode=require_approval 的回执；不等 11-12，不靠每日对账。这一步会写生产规则表，需 Ray 合并时一并授权，合并后由 74 号执行。任何一家仍是 auto_approve 或没有回执算不成
done_on: 2026-11-04
done_ref: pr:3596
---
代码改动（风险 A）：同步规则从动作定义读「只能人点头」，与内核拒绝判据同一条；今日待办新增「暂停建议被拦下」（近 7 天、按客户+广告组去重、排除核实过是别人主页的组、被拒 run 以执行内核记录为准），通用「开发欠账」对这个动作的被拒不再重复发。替代旧卡 2026-11-04-fix-sync-policy-respect-human-only（判据改了，按规矩新开）。
后续事项（不在本 PR 做）：同步规则与内核 authorize 的「要人点头」判据现在是两处各写一份，抽成一个共用函数（子牙 P2-2）。
