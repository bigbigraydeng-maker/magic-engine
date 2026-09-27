---
id: 2026-09-28-nal-whatsapp-old-creative-paused
title: 停掉 NAL WhatsApp 系列里已疲劳的旧素材：点击率掉到 0.7%、最近两天零聊天还在花钱，新素材已在扛主力
status: done
owner: agent
decided_on: 2026-09-28
done_on: 2026-09-28
done_ref: doc:docs/ledger/2026-09-28-nal-whatsapp-old-creative-paused.md
source: session:e78010ff
verify_by: 2026-10-05
verify_how: 查两件，数字从 ad_daily_insights 按本卡记的广告编号取，本卡不留客户经营数据。①旧素材广告有没有被谁重新打开——看真实投放状态（`effective_status`，`status` 不作数，且要过 `IN_PROCESS` 过渡态确认落到 `PAUSED`）；②新素材单独扛量一周后，点击率和每次开聊成本有没有开始下滑（同样的疲劳信号：CTR 跌破健康区间下限、连续两天零转化还在花钱）——如果有，说明它也快到寿命，要提前准备第三条素材，不要等它也归零才动手
---
PM 2026-09-28 在本窗口看数据后亲口「停旧的」，卫青用 Graph 接口执行：只暂停旧素材那一条广告，新素材广告在另一个广告组，未受影响。
**为什么停**：同一个 WhatsApp 系列里两条广告并行——旧素材上线 24 天，最近两天点击率跌到 0.7%（健康区间 2~3%），且连续两天零开聊仍在花钱；新素材上线 7 天，点击率稳定在健康区间，已承担多数开聊量。判据是同族疲劳信号，不是猜测。
**改前实时核对**：Graph 只读确认广告名称与素材（视频）编号跟本卡记录一致才动手，名字或素材对不上就不执行。
**改后回读**：请求返回成功后 `effective_status` 先短暂显示 `IN_PROCESS`，20 秒后回读确认落到 `PAUSED`；新素材广告同时回读确认仍 `ACTIVE`、未受影响。
**回滚**：把该广告状态改回 ACTIVE 即可，广告组、定向、预算都没动。
