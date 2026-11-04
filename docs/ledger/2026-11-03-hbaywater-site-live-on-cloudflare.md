---
id: 2026-11-03-hbaywater-site-live-on-cloudflare
title: HBay 官网 hbaywater.com 换成 V5 新版并上线，托管在 Cloudflare，合并即自动上线
status: done
owner: agent
decided_on: 2026-11-03
source: session:8044207b
verify_by: 2026-11-10
verify_how: 只读查三件：①https://hbaywater.com 返回 200、响应头 server 为 cloudflare、页面标题是 HBay Water；②www.hbaywater.com 和 http 版都 301 到 https://hbaywater.com；③页面引用的字体里没有 Avenir、Majesty（只剩 Fraunces、Figtree）。三件都对算成。
done_on: 2026-11-03
done_ref: doc:docs/clients/hbay-water/2026-11-03-hbaywater-website-and-todo.md
---
PM 当天先要求用 jundongGit/hbay-v5 替换旧演示站，随后定为正式官网、转 Cloudflare。代码在 bigbigraydeng-maker/hbay-magic-engine-demo。
同日修了：收费字体换免费字体、首页大图只留一张、手机端白边与对齐。现状和待办见 done_ref 文档。
