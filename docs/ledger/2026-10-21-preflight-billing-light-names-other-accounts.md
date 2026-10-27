---
id: 2026-10-21-preflight-billing-light-names-other-accounts
title: 追踪检查「账户与账单」灯不再只说“只核对这一个账户”：读出其它登记账户（含被隐藏的）里开着的预算——旧个人账户已隐藏但欠款，仍有 4 个系列开着（日预算 NZ$115），还款即与官方账户合计超客户总上限
status: verified
owner: agent
decided_on: 2026-10-21
source: session:1f83deb6
verify_by: 2026-10-22
verify_how: 合并部署之后，读 cron_run_logs 里 ads-tracking-preflight 最近一条 completed 的运行：env.account_billing 灯为黄，原因文字点名旧个人账户（尾号 7274、已隐藏、账户欠款、4 个系列开着、日预算 115.00 NZD）和“合计 249.00 NZD 会超过客户总上限 150.00 NZD”，建议写“不要给欠款的账户还款……”；evidence 里 other_accounts_read = true、other_live_daily_budget_cents = 11500。旧个人账户那 4 个系列被暂停后，下一轮应转绿（文字出现“没有开着的预算”）。合并后第一次自动运行是次日 07:00 NZDT，所以验收日 10-22；还没合并就顺延，不算失败。
done_on: 2026-10-21
done_ref: pr:3032
verified_ref: doc:docs/ledger/evidence/2026-10-21-preflight-billing-light-names-other-accounts--2026-10-24.md
last_checked: 2026-10-24
---
74 号 10-21 要求把黄灯的“只核其一”改成“只核官方账户、说明旧个人账户已隐藏”。只读查线上发现：隐藏只是广告健康页不显示，旧个人账户（尾号 7274）账户状态码 3（欠款，投不出去），却仍有 4 个系列开着、日预算合计 NZ$115，还款即恢复投放，与官方账户 NZ$134 相加 NZ$249，超过客户总上限 NZ$150。所以灯保持黄、文案点名，74 号同意（Meta 返回账户欠款不允许写操作，这 4 个系列停不了）。
实现：新增只读模块 other-accounts.ts，从库里的快照读其它登记账户开着的预算（不加 Meta 请求）；判灯只有在其它账户都没有开着的预算时才转绿；读不到时回到旧的“只核对这一个账户”黄。
未做：其它账户在正常投放、且合计超上限时现在仍只出黄不升红（要不要升红由 74 号 / PM 定）。
当场试跑：本机用真实 Meta 和生产库只读试跑，灯与文案如上，没有写库、没有令牌泄露。
