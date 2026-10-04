---
id: 2026-09-26-ads-wp3-1a-autonomy-sync
title: "广告自治开关同步到执行内核：Settings 面板拨的 observe / bounded_auto 会自动翻译成内核策略表六个 ads.* 键的 require_approval / auto_approve，内核一行不动，deny 永不覆盖"
status: done
owner: agent
decided_on: 2026-09-25
source: issue:1997
verify_by: 2026-10-02
verify_how: "生产库 client_automation_policies 里 CTS/NAL 六个 ads.* 键各一活动行 mode=auto_approve 且 updated_by 以 autonomy-sync: 开头；翻回 observe 后 24h 内变 require_approval"
done_on: 2026-09-26
done_ref: commit:ca11ecc8
last_checked: 2026-10-04
check_note: 本晚夜巡未逐项复核此卡，仅批量更新检查日期；待下轮夜巡补查
---
WP3.1a（A 级）。写入口仍是现有 PATCH /api/clients/[id]/ad-strategy-config（全局管理员闸），只多记 autonomy_mode_updated_by 并发一条 Inngest 叫醒铃；
worker `cloud-ads-autonomy-sync` 回库读当前值，经 SQL 函数 ads_sync_autonomy_policy 逐键写策略表（全仓唯一调用点，架构测试锁死），每键一行 ads_autonomy_sync_receipts；每日 pullback 末尾再对账一次。
同步失败进今日待办「需要你动手」。migration 只随 PR 提交，apply 需 PM go；上线后要手动 Sync /api/inngest。
设计稿 docs/specs/2026-09-25-ads-impact-wp3-design-v1.md §4。
