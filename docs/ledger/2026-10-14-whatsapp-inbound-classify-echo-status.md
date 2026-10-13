---
id: 2026-10-14-whatsapp-inbound-classify-echo-status
title: WhatsApp 收信三分类：员工手机回声记成我方发出、送达失败对账，历史同步先拒收（下一步做历史收件箱和无人认领号码待办）
status: done
owner: agent
decided_on: 2026-10-14
source: session:12233466
verify_how: 并存接入后，让员工在手机 App 里回一条已有会话的客人，看 ME 里出现一条「手机 App 员工」发出的消息且客人的最后来信时间不变；日志里不应出现 sender_not_our_number
done_on: 2026-10-14
done_ref: pr:2592
---
第一步代码已写完，等统筹问 PM 拿「合 N」；合并前不要订阅 history 字段（它先回 503，第二步才收）。
第二步（另一个 PR）：历史待认领表、号码无人认领时的待办（还 1331 欠账）、当场试跑脚本；迁移只写不应用。
回声和历史没有真号码，只能用官方样例验证；测试号只能触发普通来信和送达状态。
