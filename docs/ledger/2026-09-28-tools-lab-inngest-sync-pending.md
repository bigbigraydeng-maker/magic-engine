---
id: 2026-09-28-tools-lab-inngest-sync-pending
title: 工具实验室两个新 Inngest 回执函数（留资捕获 + 报告发信回执）合并部署后要去 Inngest 后台重新 Sync 一次，不然它们安静地不跑——当场试跑只验了函数逻辑本身，没验真实事件投递
status: decided
owner: agent
decided_on: 2026-09-28
source: pr:2163
verify_by: 2026-10-05
verify_how: 合并部署后，用一个真实网站诊断走一遍留报告邮件流程，然后去 Inngest 后台（app.inngest.com，Magic Engine 云端应用）查 `tools_lab/lead.captured` 和 `tools_lab/report_email.attempted` 两个事件是不是真的触发了对应函数、有没有运行记录。没有运行记录 = 新函数没被 Inngest 同步到，需要手动去后台对 `/api/inngest` 端点点一次 Sync。
---

`src/lib/inngest/functions/tools-lab-lead-followup.ts` 新增两个函数（`toolsLabLeadFollowUp`、`toolsLabReportEmailReceipt`），已在 `src/lib/inngest/functions/index.ts` 登记。PR #2163「当场试跑」段只验证了函数体本身的逻辑（本地直接调用 `.fn`，两次都成功返回预期形状），没有、也不可能在合并部署前验证 Inngest 真实事件总线会不会把事件投递给它们——这需要新函数先在 Inngest 后台注册成功（重新 Sync），仓库里 `lead-sheet-sync.ts` 文件头已经记过这条规矩："新增函数必须有人去 Inngest 后台对 `/api/inngest` 重新 Sync 一次，不然它安静地不跑，跟一切正常长得一模一样"。

不验证的后果：留资信号和报告发信回执这两个"审计留痕"功能会静默失效——不影响主流程（网站诊断、报告邮件、今日待办都不依赖这两个事件，见 `lead-events.ts`/`report/route.ts` 头注释），但意味着这两个事件的回执彻底消失、没人知道。
