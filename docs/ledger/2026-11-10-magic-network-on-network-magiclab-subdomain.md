---
id: 2026-11-10-magic-network-on-network-magiclab-subdomain
title: Magic Network 用二级域名 network.magiclab.co.nz，ME 老页面跳转改到这个地址（PM 11-10「接上」）
status: decided
owner: pm
decided_on: 2026-11-10
source: session:e5aca2ac
verify_how: 上线后打开 https://app.magicengine.com.au/partner/apply?ref=ABCD2345 ，应跳到 https://network.magiclab.co.nz/join?ref=ABCD2345 ；https://app.magicengine.com.au/ai-steward 应跳到 https://network.magiclab.co.nz/products/ai-steward ；https://app.magicengine.com.au/partner 不跳。
---
PM 11-10 买了 magiclab.co.nz（Magic Lab 是上级品牌），定 Magic Network 和 Magic Academy 都不买独立域名、用二级域名。
network.magiclab.co.nz 已接到 Magic Network 网站：Render 自定义域名已验证、证书有效，7 个页面实测能打开。域名在 Hello@magicengine.cloud 的 Cloudflare 账号里。
本单（pr:3775）把 ME 两个老页面跳转的默认地址从临时网址 magic-network.onrender.com 换成 network.magiclab.co.nz；临时网址仍然能用。
没做：academy.magiclab.co.nz（Magic Academy 还挂在 ChatGPT 托管上，要先搬出来）；magiclab.co.nz 总站还是空的。
