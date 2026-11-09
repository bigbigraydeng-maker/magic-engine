---
id: 2026-10-24-ads-health-internal-diagnosis-and-write-lockdown
title: 广告健康页：内部诊断不再发给客户账号，止损 / 补素材 / 暂停审批只给内部账号
status: done
owner: agent
decided_on: 2026-10-24
source: issue:3093
verify_by: 2026-11-07
verify_how: 上线后用非内部账号调广告健康接口，返回里搜不到 portfolio_diagnoses 和 D11；同账号调止损、补素材、暂停审批（批准和驳回）都回 403；内部账号仍正常
done_on: 2026-10-24
done_ref: pr:3097
---
S1（P0）：非内部账号拿到了内部诊断。现在 `latest.payload` 和 `campaigns[]` 都按白名单只发页面用到的字段，内部管理员仍看全量。
S2（P1）：止损、补素材、自动暂停审批（批准和驳回）改为只给内部账号，客户员工回 403；补素材加 10 分钟近似去重，查不到日志时不放行（503）。页面对 403 / 429 单独提示。
代码在 PR 3097（draft）；本机复验 782f4ae0 全绿。上线后按 verify_how 实测才算验过。
