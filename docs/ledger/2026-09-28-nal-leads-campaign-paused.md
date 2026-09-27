---
id: 2026-09-28-nal-leads-campaign-paused
title: 停掉 NAL 那个「买留资却送去私信」的广告系列：优化目标（留资）跟实际落点（私信）对不上，效果没法达成
status: done
owner: agent
decided_on: 2026-09-28
done_on: 2026-09-28
done_ref: doc:docs/ledger/2026-09-28-nal-leads-campaign-paused.md
source: session:e78010ff
verify_by: 2026-10-01
verify_how: 查三件。①那个系列有没有被谁重新打开——看真实投放状态（`effective_status`），名字和 `status` 不作数；②本月最终开聊次数对当月目标差多少，数字以 fde_work_logs 记录为准；③WhatsApp 那个系列独自承担后，每次开聊成本有没有明显变贵——基线取 fde_work_logs 里最近 6 天的记录，涨幅异常就要回头看是不是不该停。②差得多且③没明显变贵 = 停对了但要补量，交回 PM 决定加不加预算
---
PM 在卫青窗口看到后台截图后要求暂停，卫青用 Graph 接口执行，只改该系列 `status=PAUSED`，未动预算 / 定向 / 素材，未碰 WhatsApp 那个系列。
**为什么停**：系列目标是「留资」，但两个在投广告组的落点都是 Messenger（优化目标 LEAD_GENERATION + 落点 MESSENGER），Meta 收不到它要优化的信号；同期 WhatsApp 系列的每次开聊成本明显更低。具体花费、留资数、单次开聊成本见当日 fde_work_logs。
**改前改后核对**（Graph 只读）：改前该系列的花费、留资数、开聊数已与 PM 截图逐项核对一致；改后系列与其下 4 个广告组、6 条广告全部 PAUSED/不在投（含 15s 重测那条与 8 月那条），WhatsApp 系列状态与预算未变。
**回滚**：把该系列状态改回 ACTIVE 即可，广告组和广告的自身状态都没动，恢复后原样继续投。
**连带取消**：原定 9/29 的「15s vs 82s 私信素材二选一」评审失效——两条广告都在这个错配系列里，数据不可用，接替判定见台账卡 2026-09-26-nal-messenger-15s-retest（已改状态标记失效）；要测 15s 应放进 WhatsApp 那套「买开聊」的配置重测。
