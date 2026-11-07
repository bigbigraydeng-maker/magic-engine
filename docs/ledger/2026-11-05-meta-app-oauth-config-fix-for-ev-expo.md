---
id: 2026-11-05-meta-app-oauth-config-fix-for-ev-expo
title: 129 号窗口修的应用跟门户实际用的不是同一个——门户的 Facebook 登录仍坏
status: failed
owner: pm
decided_on: 2026-11-05
source: session:72cde643
verify_by: 2026-11-06
verify_how: 俊东确认门户部署的 META_APP_ID 指向哪个应用，并在 Meta 开发者后台给那个应用配好 Facebook 登录
done_on: 2026-11-05
done_ref: doc:docs/ledger/2026-11-04-ev-expo-sprint-meta-only-split-from-squid.md
---
129 号窗口修好了 Meta 应用 3955651258064982 的 OAuth 配置（回调地址、域名、Facebook 登录开关）。
但 PM 11-05 试连时发现门户实际发出的 OAuth 请求里 client_id=1814506663549438，不是 3955651258064982。

**根因**：新 ME 门户（me2.cloud02.top / portal.magicengine.com.au）用的是编号 1814506663549438 的应用，不在我们 Meta 开发者账号下（7 个应用全查了，没有这个）。整个代码仓库里也搜不到这个编号。该应用大概率在俊东（ME 2.0 平台 `magic-engine-dev/magic-engine-platform` 的开发者）的 Meta 开发者账号下。

**下一步**：需要俊东（或有该应用开发者权限的人）去 Meta 开发者后台，对应用 1814506663549438 做跟 129 号窗口一样的配置：打开 Facebook 登录、设回调地址、改应用域名、切正式模式或给管理员测试权限。
