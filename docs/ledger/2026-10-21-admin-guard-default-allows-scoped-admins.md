---
id: 2026-10-21-admin-guard-default-allows-scoped-admins
title: 管理员守卫默认放行「限定单个客户的管理员」：约 46 个后台接口只套了 guardAdmin，含能提权的 admin/mcp-keys 和 admin/users；根治办法是把默认反过来（先出设计，A 级，P3）
status: decided
owner: agent
decided_on: 2026-10-21
source: session:1f83deb6
verify_by: 2026-11-18
verify_how: docs/specs 下有「管理员守卫默认拒绝限定客户的管理员」的设计稿，子牙和魏征审过；设计稿要回答：哪些接口显式改用带范围的守卫、怎么加全仓接口守卫清单测试防止新接口漏掉、admin/mcp-keys 和 admin/users 的提权怎么先堵；或者 PM 明确说搁置。到期没动就顺延，不算失败。
---
内容工厂 4 个入口的修复审查时，子牙数了一下：src/app/api 下只套了 guardAdmin / requireAdmin、没有任何客户范围或全局检查的接口有 37 个，另有 9 个 voice 接口用 requireVoiceAdmin，同样只认环境变量里的管理员。其中 admin/mcp-keys 的 POST 能让限定客户的管理员给自己发一把管全部客户的管理员钥匙，admin/users 的 POST 能把任意邮箱加进任意客户（提权）。
现在生产里没有限定客户的管理员走得到这些接口（统管 18 号 10-21 查：DEMO_ADMINS 没设），所以是潜在口子，不是现行事故；内容工厂那一个 PR 只收 4 处，不能写成“限定客户的管理员已经隔离好了”。
另有一个老问题：whitelist.ts 的 getUserPermissions('') 在 ADMIN_EMAILS 末尾多一个逗号时，会把没有邮箱的登录当成全局管理员；内容工厂那个 PR 的新函数已自己拦掉空邮箱，whitelist.ts 本身没改，修法是一行判空，可并入根治设计。
根治方向：guardAdmin 默认拒绝限定客户的管理员，按客户的接口显式改用 requireAdminScope；再加一个全仓接口守卫清单测试，新接口漏不了。
