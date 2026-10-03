---
id: 2026-10-04-cts-retargeting-reopened
title: CTS 的 Retargeting 系列 10/4 被 PM 手动停掉、同日由 PM 授权重新打开
status: done
owner: agent
decided_on: 2026-10-04
done_on: 2026-10-04
done_ref: pr:2209
source: session:e78010ff
verify_by: 2026-10-11
verify_how: 数字从 ad_daily_insights 与 Meta 账户活动日志取，本卡不留客户经营数据。①该系列重新打开后有没有被再次停掉或改预算，并核对真实投放状态已落到 ACTIVE；②重新打开后的花费与留资表现对比修改前的基线（基线区间与数字见客户工作日志，不含账户付款异常的日期）；③一周内有没有单日花费显著超过日预算，超过的话判断是补量还是需要加日上限
---
PM 2026-10-04 用手机 App 手动停了该系列，同日在卫青窗口回「可以开」。卫青用 Meta 广告官方连接器只做一件事：把该系列状态改回 ACTIVE。
**改前实时核对**：系列状态 PAUSED，其下广告组仍是 ACTIVE，所以只需要恢复系列。
**改后回读**：系列与广告组均为 ACTIVE，没有改预算、定向、素材。
**回滚**：把该系列状态改回 PAUSED 即可。
**业务依据与数字**：见 CTS 客户工作日志（fde_work_logs）与客户私有记忆，本卡不记。
