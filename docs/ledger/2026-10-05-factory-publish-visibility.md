---
id: 2026-10-05-factory-publish-visibility
title: 视频工厂发布环节：失败原因看得见、不再标成 Oztop、看板分清草稿和已公开
status: decided
owner: agent
decided_on: 2026-10-05
source: session:6ed79d56
verify_by: 2026-10-12
verify_how: PR 合并后，下一次真实发布（或失败）出现时，到 /dashboard/factory 看该单有没有「已发布(草稿,未公开)/已公开」标签或失败原因；样本≥1 条
---
改了什么、怎么审的、测试证据见 docs/audits/2026-10-05-factory-publish-visibility.md。
不做按单公开、不改全局开关、不加迁移。
