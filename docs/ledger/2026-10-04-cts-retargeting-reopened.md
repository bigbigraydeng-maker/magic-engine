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
verify_how: 数字从 ad_daily_insights 与 Meta 账户活动日志取，本卡不留客户经营数据。样本门槛：重新打开后累计花费不少于日预算的 3 倍且有投放的天数不少于 5 天；不满足时夜巡不判成败，只盖 last_checked 并写 check_note，连续两晚判不了就把 owner 改成 pm 交人。样本达标后按下面三条判。①通过=重新打开后没有被再次停掉、没有改预算，且 Meta 真实投放状态回读为 ACTIVE；否则 failed。②基线取修改前连续 7 个投放日（基线区间与数字见客户工作日志，不含账户付款异常的日期）的日均花费与单条留资成本；通过=样本达标且单条留资成本不高于基线的 1.3 倍、日均留资数不低于基线的 70%；任一项超界线 failed；留资数为 0 且花费已达日预算 3 倍也 failed。③通过=任一单日花费不超过日预算的 1.25 倍；超过则记 failed 并写明是补量还是需要加日上限，不单独当作成败之外的待判项。以上①②③全部通过才记 verified
last_checked: 2026-10-11
check_note: 2026-10-11 夜巡到期复核未取得新证据，仅盖章；待下一晚按 verify_how 实查。
---
PM 2026-10-04 用手机 App 手动停了该系列，同日在卫青窗口回「可以开」。卫青用 Meta 广告官方连接器只做一件事：把该系列状态改回 ACTIVE。
**改前实时核对**：系列状态 PAUSED，其下广告组仍是 ACTIVE，所以只需要恢复系列。
**改后回读**：系列与广告组均为 ACTIVE，没有改预算、定向、素材。
**回滚**：把该系列状态改回 PAUSED 即可。
**业务依据与数字**：见 CTS 客户工作日志（fde_work_logs）与客户私有记忆，本卡不记。
