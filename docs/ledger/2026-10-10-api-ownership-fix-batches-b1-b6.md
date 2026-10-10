---
id: 2026-10-10-api-ownership-fix-batches-b1-b6
title: 接口越权修复分六批（匿名大门/自报账号越界/免费档越权/受限管理员/定时任务密钥/防回潮测试），待 PM 逐批点头
status: decided
owner: pm
decided_on: 2026-10-10
source: doc:docs/audits/2026-10-10-api-client-ownership-audit.md
verify_by: 2026-10-17
verify_how: 每批合并后，该批接口的「别家客户号被拒」测试全绿，且全仓路由守卫清单测试通过
---
批次内容、文件范围见报告第六节；均为 A 级，需 PM 说「合」。B3 需 PM 先定哪些接口本就该对免费档开放。
