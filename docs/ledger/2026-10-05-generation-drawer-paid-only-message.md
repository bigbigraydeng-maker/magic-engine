---
id: 2026-10-05-generation-drawer-paid-only-message
title: 自助版用户在后台点「生成内容」被拒后会看到英文报错，需要中文升级提示
status: decided
owner: agent
decided_on: 2026-10-05
source: session:07fc4e50
verify_how: 改完后写单测证明坏请求被拒，并在本地起开发服务手动试一次（不碰生产）
---
route-a/b/c 加登录检查后，自助版（self_serve）用户会收到 paid_only 的 403；GenerationDrawer 只显示 json.error，没有用 reason 触发升级弹窗。
需要 PM 确认自助版是否本就应该能用这个功能（目前它能免费用只是因为没鉴权）。
