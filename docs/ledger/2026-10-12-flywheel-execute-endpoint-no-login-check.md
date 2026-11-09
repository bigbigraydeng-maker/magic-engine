---
id: 2026-10-12-flywheel-execute-endpoint-no-login-check
title: 一个老接口没有登录校验：不登录也能往客户的动作流水账里插记录
status: decided
owner: pm
decided_on: 2026-10-12
source: session:65be206b
verify_how: 修完后不带登录信息请求这个接口必须被拒绝（返回未登录），而不是进入参数校验；页面上原有的调用仍能用
---
src/app/api/flywheel/execute/route.ts 没有任何登录或客户归属校验，中间件也不覆盖 /api。
2026-10-12 对生产发了一个空请求，返回的是「缺少必填字段」而不是「未登录」，说明不登录就能走到写入那一步（没有发有效内容，没写入任何数据）。
插进去的记录不带状态时会在客户看板上显示成已完成，也会进归因和记忆。属鉴权问题，A 级，需单独开窗口修。
唯一调用方：src/app/dashboard/clients/[id]/execution/_components/FlywheelDrawer.tsx。
