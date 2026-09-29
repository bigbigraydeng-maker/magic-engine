---
id: 2026-09-30-ads-campaign-budget-inngest-pending
title: 广告系列预算下调代码已接入 Kernel 与 Inngest，仍需在应用部署后同步并安全验证云端函数
status: decided
owner: agent
decided_on: 2026-09-30
source: conversation:ads-automation
verify_by: 2026-10-07
verify_how: 应用版本部署后，在 Inngest 控制台同步 `/api/inngest`，用无 Meta 写入的探针确认函数已注册与事件可投递；预算变更真实试跑需 PM 单独批准并使用指定测试账户。
---

`ads.cut_campaign_budget` 是人工发起的 CBO 系列日预算下调，只能降低预算；请求先写 Kernel action run，再投递 `ads.campaign_budget.decrease_requested`，由 Inngest 执行并写结果回执。预算副作用及 Meta 因预算更新暂停系列后的恢复尝试都在 Kernel capability 内，恢复失败会显示警告。已运行相关定向测试、架构测试和 lint；全量类型检查与生产构建尚未通过验证，Inngest 云端同步/投递也未验证。不要把本地单测视为生产就绪，不要启用客户自动模式。
