---
id: 2026-11-25-ledger-expired-status
title: 台账加「过期没验」状态，PM 同意把 233 张不碰钱的老卡标过期
status: done
owner: agent
decided_on: 2026-11-25
source: session:2d8903d5
verify_by: 2026-11-27
verify_how: 主干上 src/lib/ledger 测试全绿；批量改卡的改动单合并后，再数 docs/ledger 里 status 为 expired 的卡应为 233 张、每张都有 check_note；当天待办邮件的台账栏里这 233 张一张都不出现
done_on: 2026-11-25
done_ref: pr:3935
---
PM 在本窗口回「批」。范围：过期两周以上、不碰钱/广告/外发/客户数据/在线客户的卡；不到两周的 18 张留给夜巡。
