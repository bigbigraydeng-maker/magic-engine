---
id: 2026-09-27-auth-next-open-redirect-fix
title: 堵住登录后跳转的外站漏洞（/\evil.com 能把刚登录的人带去别的网站），12 处检查合成一个
status: done
owner: agent
decided_on: 2026-09-27
source: session:e3087553
verify_by: 2026-10-04
verify_how: 合并上线后打开 https://app.magicengine.com.au/api/auth/session-route?next=/%5Cevil.com 和 ?next=/%255Cevil.com（未登录也行），返回的 redirect 必须是 /dashboard 而不是 /\evil.com；再用一个没有任何客户关系的自助注册账号，带正常 next=/meta-ads-ai/mine 登录一次，确认仍落到该页（管理员或有客户关系的账号会被送去自己的首页，不能用来验）
done_on: 2026-09-27
done_ref: pr:2129
---
狄仁杰审 PR 2123 时发现的旧问题：旧检查只挡 `//` 开头，`/\evil.com` 被浏览器当成 `//evil.com`。
新共享函数 src/lib/auth/safe-internal-path.ts：拒绝反斜杠、控制字符、`//` 开头，解码一次后再查。A 级，草稿等子牙+魏征+狄仁杰三审，PM 回「合」才合。
