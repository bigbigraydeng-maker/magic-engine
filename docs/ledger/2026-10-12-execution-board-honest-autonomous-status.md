---
id: 2026-10-12-execution-board-honest-autonomous-status
title: 执行看板不再把没真执行的自动动作（演练、被拦、失败、等确认）显示成「已完成」，客户也拿不到内部原因
status: done
owner: agent
decided_on: 2026-10-12
source: session:65be206b
verify_by: 2026-10-15
verify_how: 合并上线后查三件事——①账上没写状态的记录在看板上仍是「已完成」、条数不变；②账上状态属于没做成（演练/被拦/失败/否决）的记录，内部账号看到「已跳过+固定说明」，客户账号在看板和广告操作历史里都看不到；③广告操作历史接口的响应里没有 reason / diagnosis_evidence / ownership。目前生产库没有任何一条自动暂停记录，②要等第一条出现才有样本，没样本就只盖章写明
done_on: 2026-10-12
done_ref: pr:2481
---
看板和「广告操作历史」读 flywheel_actions 时原来不看账上的 payload.status。现在统一走
src/lib/flywheel/autonomous-action-board.ts 这张翻译表：认不出的状态一律不算完成。
客户成员（含演示 / 试用账号）只看到真做了、已提交等上线、等确认的；其余只给全局管理员看，且只显示固定说法。
没改的部分见后续卡 2026-10-12-execution-board-honesty-followups。
