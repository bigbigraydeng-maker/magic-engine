---
id: 2026-09-26-ads-d3-approval-binds-seen-decision
title: 广告自动暂停的批准必须批「人看到的那一份」，一条等批准只出一条待办
status: done
owner: agent
decided_on: 2026-09-26
source: session:67233075
verify_by: 2026-10-10
verify_how: 合并上线后、关掉 D3 演练模式前，只读查生产 D3 等批准与已签批未执行各几条（应为 0）；关掉后第一条真实 D3 等批准出现时，今日待办里恰好一条、链接进专属页能看到、点批准广告组状态真变成暂停（回读 Meta）
done_on: 2026-09-26
done_ref: pr:2063
last_checked: 2026-10-26
check_note: 判不了：前半成立，生产 action_runs 里 ads.auto_pause_on_d3 总共 0 条（等批准 0、签批未执行 0）；后半要等演练模式关掉，ad_strategy_configs 4 个客户 autopilot_dry_run 仍全为 true，还没出现第一条真实 D3 等批准
---
子牙 2026-09-26 查出两处：approveAndRun 不传「人看到的那份审批请求」；同一条 D3 等批准出两条矛盾待办。
共享登记表 src/lib/kernel/dedicated-approval-entries.ts 由本卡负责，孔子 SEO 3b 直接加一行复用。
设计稿 docs/specs/2026-09-26-kernel-approval-decision-binding-and-dedicated-entry.md（§7 三审修订 + 后续事项）。
