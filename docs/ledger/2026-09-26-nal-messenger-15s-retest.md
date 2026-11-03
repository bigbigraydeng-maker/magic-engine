---
id: 2026-09-26-nal-messenger-15s-retest
title: NAL Messenger 15 秒实拍视频重测——单独新广告组跑 3 天，跟 82 秒原广告比每次开聊成本，再决定留哪个
status: verified
owner: agent
decided_on: 2026-09-26
source: doc:docs/PITFALLS.md
verify_by: 2026-09-29
verify_how: 在 NAL 广告账户拉 9/26–9/28 的广告层逐日数据（level=ad，time_increment=1），比新广告「物流_Message_15s实拍_重测_0926」与原广告「物流_潜在客户_Message_8月」的花费、开聊数、每次开聊成本，并附 WhatsApp 同期；两个 Messenger 广告各至少 10 次开聊、取数无报错才算能判，不够就写「样本不够再等 3 天」。数字写进 check_note；留哪个是 PM 的决定，机器不翻这张卡
done_on: 2026-09-28
done_ref: pr:2151
verified_ref: doc:docs/ledger/2026-09-28-nal-leads-campaign-paused.md
last_checked: 2026-09-28
check_note: 实验取消、不是判出结果：所在广告系列 9/28 按 PM 授权整个停投，15 秒与 82 秒两条都已不在投，数字不可用。要测 15 秒须挪进 WhatsApp 那套「买开聊」的配置重开新卡
---
PM 2026-09-26「重测」。9/24 那张卡（2026-09-24-nal-messenger-15s-creative-3day-review）的测试没跑成：换上的 15 秒素材被 Meta 拦下、主力广告停约 23 小时，9/25 已改回原素材——那张卡 9/25–9/27 的数字其实是 82 秒原素材的成绩，不能用来判 15 秒。

这次的布局：同一个按系列分预算的广告系列（每天 $35，总花费不变）里新建广告组「物流潜在客户广告组-15s实拍重测-0926」+ 上面那条新广告，主力广告不动（冻结到 10/2）。
新组归因只能设 1 天点击（原组是老设置 7 天点击 + 1 天浏览），开聊数可比，留资数不可直接比。
各对象编号、经过与根因见 docs/PITFALLS.md D13；日历 9/29 09:00 已建。
