---
id: 2026-10-05-content-route-abc-add-auth
title: 内容生成三个接口（route-a/b/c）补上登录和客户归属检查
status: decided
owner: agent
decided_on: 2026-10-05
source: session:07fc4e50
verify_by: 2026-10-12
verify_how: 本地起开发服务，未登录请求这三个接口都返回 401 且没有触发任何 AI 调用或写库；单测覆盖未登录/非本客户/付费限制/通过四种情况
---
这三个接口原先任何人都能调用，会花 AI 费用并往客户内容库写草稿。方案：复用 requirePaidClientAccess，并校验请求里的制作包/执行项编号属于该客户。
全仓其它缺鉴权的写接口已扫出清单，不在本次修改范围内，逐个另开卡。
