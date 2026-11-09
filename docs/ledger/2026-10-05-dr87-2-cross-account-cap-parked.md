---
id: 2026-10-05-dr87-2-cross-account-cap-parked
title: 客户级日上限跨账户失效：PM 决定暂不立项，到期要回头复查三件事
status: decided
owner: pm
decided_on: 2026-10-05
source: doc:docs/ledger/2026-09-27-dr87-2-spend-guard-audit.md
verify_by: 2026-10-11
verify_how: 到期查三件：①重做（WP3 收编）有没有把 execute 那三个动作走内核、boost-post 补审计写入、winner-reel-sync 改成另建独立组；②「客户级日上限跨账户失效」PM 已决定暂不立项、记 P 待办——重新问 PM 广告重做是否告一段落、要不要开工；③按 docs/audits/2026-10-10-cts-real-spend-over-cap.md 第 5.2 节的两级口径重查近 30 天真超支（分账户和客户合计各算一次，客户合计的分母是已配分账户上限之和）：主判据是滚动 7 日均值超过上限 1.00 倍，单日只有超过 1.30 倍才算异常，不要用 1.0 倍逐日比；真超支天数或幅度明显变大说明敞口在扩大，要立刻交回 PM 重排优先级。任一件没动 → 把结论重新交回 PM，不要默认已解决
---
PM 决定：暂不立项，记 P 待办，等广告重做告一段落再回头修；理由是集中火力在三条线上。
事实与「不要默认日上限已在防超支」的提醒见原回查卡 docs/ledger/2026-09-27-dr87-2-spend-guard-audit.md 第 ③ 节。
