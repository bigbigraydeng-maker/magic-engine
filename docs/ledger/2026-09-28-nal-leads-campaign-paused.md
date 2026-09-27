---
id: 2026-09-28-nal-leads-campaign-paused
title: 停掉 NAL 那个「买留资却送去私信」的广告系列：优化目标（留资）跟实际落点（私信）对不上，它要的结果永远达不成
status: done
owner: agent
decided_on: 2026-09-28
done_on: 2026-09-28
done_ref: pr:2151
source: session:e78010ff
verify_by: 2026-10-01
verify_how: 查三件，数字都去 fde_work_logs 该客户 2026-09-28 那条和 ad_daily_insights 取，本卡不留客户经营数据。①那个系列有没有被谁重新打开——看真实投放状态（`effective_status`），名字和 `status` 不作数；②本月最终开聊次数对当月目标差多少（月目标见客户记忆；停的时候还剩 3 天）；③WhatsApp 那个系列独自承担后每次开聊成本有没有变贵——基线取 9/21–9/26 那 6 天的实测值，涨过基线一半就要回头看是不是不该停。②差得多且③没涨 = 停对了但要补量，交回 PM 决定加不加预算
---
PM 2026-09-28 在本窗口看后台截图后授权停投，卫青用 Graph 接口执行：只改该系列 `status=PAUSED`，未动预算 / 定向 / 素材，未碰 WhatsApp 那个系列。
**为什么停**：系列目标是「留资」，但两个在投广告组是「优化目标 LEAD_GENERATION + 落点 MESSENGER」，Meta 收不到它要优化的信号；同期 WhatsApp 系列每次开聊成本明显更低。具体花费、留资数、单次开聊成本见当日 `fde_work_logs` 与 `ad_daily_insights`。
**改前改后核对**（Graph 只读）：改前该系列的花费、留资数、开聊数、日预算四项与 PM 截图逐项一致；改后系列及其下 4 个广告组、6 条广告全部不在投（含 15s 重测那条与 8 月那条），WhatsApp 系列状态与预算未变。
**回滚**：把该系列状态改回 ACTIVE 即可，广告组与广告自身状态都没动，恢复后原样继续投。
**连带取消**：15s vs 82s 素材评审失效，旧卡 [[2026-09-26-nal-messenger-15s-retest]] 已改成 `failed` 并写明是取消、不是判出结果；要测 15s 须挪进 WhatsApp 那套「买开聊」的配置重开新卡。
