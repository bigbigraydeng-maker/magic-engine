---
id: 2026-10-27-lead-form-watch-stop-faults
title: 表单留资系列进每小时盯盘，三种故障才去叫暂停
status: done
owner: agent
decided_on: 2026-10-27
source: doc:docs/specs/2026-10-26-prescription-to-act-full-auto-design-v0.1.md
verify_by: 2026-10-28
verify_how: 总开关打开且暂停入口、通知都上线后，下一小时新西兰整点后第 20 分钟的盯盘回执里能看到表单系列的故障和暂停结果；开关关掉时不得暂停。本卡交付时没有跑生产、没有调真实广告接口。
done_on: 2026-10-27
done_ref: pr:3217
---

表单留资系列通过客户配置登记，不写死某一条广告。超日上限、线索进不了 CRM、广告被拒，命中才调只暂停入口。入口没开或没部署只记原因，不动广告。
