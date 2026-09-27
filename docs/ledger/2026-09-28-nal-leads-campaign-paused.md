---
id: 2026-09-28-nal-leads-campaign-paused
title: 停掉 NAL 那个「买留资却把人送去私信」的广告系列：它买的结果几乎一次也没买到，每次开聊比 WhatsApp 贵一倍以上
status: done
owner: agent
decided_on: 2026-09-28
done_on: 2026-09-28
done_ref: pr:2151
source: session:e78010ff
verify_by: 2026-10-01
verify_how: 查三件，数字都去 fde_work_logs 该客户 2026-09-28 那条和广告库里取，本卡不留客户经营数据。①那个系列有没有被谁重新打开——看真实投放状态（`effective_status`），名字和 `status` 不作数；②9 月最终开聊次数对月目标差多少（月目标见客户记忆，停的时候还剩 3 天）；③WhatsApp 那个系列独自承担后每次开聊成本有没有变贵——基线取 9/21–9/26 那 6 天的实测值，涨过基线一半就要回头看是不是不该停。②差得多且③没涨 = 停对了但要补量，交回 PM 决定加不加预算
---
PM 2026-09-28 在本窗口看后台截图后授权停投，卫青用 Graph 接口执行：只改该系列 `status=PAUSED`，未动预算 / 定向 / 素材，未碰 WhatsApp 那个系列。
**为什么停**：系列目标是「留资」，但两个在投广告组是「优化目标 LEAD_GENERATION + 落点 MESSENGER」。Meta 收不到它要的结果，优化引擎几乎无信号，每次开聊成本是 WhatsApp 系列的两倍以上。逐日数字与成本对比见 `fde_work_logs`（该客户 2026-09-28）与 `ad_daily_insights`。
**改前实时核对**：Graph 只读取数与 PM 截图逐项一致（花费、留资数、开聊数、日预算四项）。
**改后回读**：系列 PAUSED/PAUSED；其下 4 个广告组、6 条广告全部不在投；WhatsApp 系列仍 ACTIVE、日预算未变。
**回滚**：把该系列状态改回 ACTIVE 即可，广告组与广告自身状态都没动。**连带取消**：15s vs 82s 素材评审失效，旧卡 [[2026-09-26-nal-messenger-15s-retest]] 已改成 `failed` 并写明原因；要测 15s 须挪进 WhatsApp 那套「买开聊」的配置重开新卡。
