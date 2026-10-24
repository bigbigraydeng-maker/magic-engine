---
id: 2026-10-20-projects-page-client-imports-server-module
title: 后台「项目」页在浏览器里引了服务端模块，控制台报缺服务端密钥（审查官顺带发现，需确认页面是否真的打不开）
status: decided
owner: agent
decided_on: 2026-10-20
source: session:ec90bb17
verify_by: 2026-10-30
verify_how: 在浏览器登录后打开 /dashboard/clients/<客户id>/projects：页面正常显示，浏览器控制台没有「Missing SUPABASE_SERVICE_ROLE_KEY」；若报错，把引用服务端模块的客户端文件拆成纯函数文件后重试
---
2026-10-20 审查 PR 2945 时，审查官在生产页面 /projects 的浏览器控制台看到了和 2945 白屏同款的错误：客户端组件引了依赖服务端密钥的模块。
是否影响页面可用还没核实（只看了控制台症状）。优先级按 §11：频率低 / 闭环关键度低 / 收入关联低 → P3，先记账不抢资源。
