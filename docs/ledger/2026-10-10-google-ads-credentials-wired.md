---
id: 2026-10-10-google-ads-credentials-wired
title: 谷歌广告接口只差开发者令牌一个值就通了，其余全部就绪
status: decided
owner: pm
decided_on: 2026-10-10
source: doc:docs/audits/2026-10-09-google-ads-api-status.md
verify_by: 2026-10-24
verify_how: 开发者令牌补进 Render 后，在已登录浏览器里请求生产只读接口 /api/clients/<CTS>/google-ads/campaigns 并带上账户号查询参数，看返回的是广告系列列表而不是 credentials are not configured；到期仍没补就问 PM 账号验证那一关过了没，没过就把这条线退回 P3 搁置
---
五步走完四步：代码已升 v25 并上线；OAuth 客户端已在 compass 项目建好；刷新令牌已拿到且项目是 In production 所以不会七天失效；Render 上五个变量到了四个；CTS 客户设置里的账户号已填。
当场试跑生产只读接口，返回「凭据未配置」——与只缺开发者令牌吻合，取凭据的函数要四项全齐才放行。
唯一卡点：开发者令牌要在 Ads 后台点 View token 才显形，谷歌只给通行密钥一种验证方式，PM 手机里没有，属账号安全设置问题，不是本条线的技术问题。
PM 自行解法：在已登录的 Mac 上到谷歌账号的通行密钥设置页用 Touch ID 建一个本机密钥，之后验证只需指纹。
详细经过与证据见审计文档第十节，另见 [[2026-10-10-google-ads-api-basic-upgrade]] 与 [[2026-10-10-google-ads-api-v25-upgrade]]。
