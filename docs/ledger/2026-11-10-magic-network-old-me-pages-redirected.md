---
id: 2026-11-10-magic-network-old-me-pages-redirected
title: ME 里的老 AI 数字人管家营销页和经销商申请页，跳转到独立的 Magic Network 网站（PM 11-10「Redirect now」）
status: decided
owner: pm
decided_on: 2026-11-10
source: session:e5aca2ac
verify_how: 上线后打开 https://app.magicengine.com.au/ai-steward 和 https://app.magicengine.com.au/partner/apply?ref=ABCD2345 ，应该分别跳到 magic-network.onrender.com/products/ai-steward 和 /join?ref=ABCD2345；https://app.magicengine.com.au/partner 不跳（老经销商后台照常）。
---
Magic Network 已经是独立网站，规则也按 PM 选的「USANA 式」改过（取消平级 5%、取消自购升级）。ME 里这两个老页面还挂着旧规则和收入示例，所以先跳走。
跳转是临时的（不是永久跳转），因为正式域名还没注册；域名好了以后在 Render 上设 MAGIC_NETWORK_URL 就换地址，不用改代码。
经销商后台 /partner 不跳：唯一一位经销商「大瑞」还在 ME 的数据库里，新网站的数据库还没开。等新库开好、搬完人，再撤 ME 里的老页面代码和后台入口。
11-10 晚更新：PM 买了 magiclab.co.nz，Magic Network 用二级域名 network.magiclab.co.nz（已接好，证书有效）。跳转的默认地址改成这个新域名，所以 verify_how 里的目标地址以 network.magiclab.co.nz 为准。
