---
id: 2026-10-11-onboarding-complete-writes-unbounded-into-work-logs
title: 客户自助开通时填的求助内容会原样写进 ME 内部工作日志，不限长度、可重复提交、看起来像同事写的
status: decided
owner: agent
decided_on: 2026-10-11
source: session:1a8b735d
verify_how: 修复后同一客户重复提交不再新增日志行，单项和总长度有上限并有单测，后台日志面板能一眼区分客户自助提交与 ME 同事写的内容
---
狄仁杰在 pr:2433 复核时实证：src/app/api/clients/[id]/onboarding/complete/route.ts 只限 20 项，不限单项长度，不去重。
只影响自家客户、客户自己读不到，不构成泄露；风险是误导 ME 同事和超大内容拖垮后台客户页。无脚本注入。
不在 pr:2433 修。B 级偏上，应另开窗口。
