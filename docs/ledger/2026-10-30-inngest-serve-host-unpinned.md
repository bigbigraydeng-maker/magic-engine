---
id: 2026-10-30-inngest-serve-host-unpinned
title: 后台定时任务系统（Inngest）的回调地址没有固定：任何人对服务的任一域名匿名发一个请求，就能把回调地址改登记到那个域名；建议在 Render 加一个环境变量固定住，等 PM 点头
status: decided
owner: pm
decided_on: 2026-10-30
source: session:9562a9b6
verify_by: 2026-11-06
verify_how: PM 回「做」后：在 Render 给服务 crazycontent 加环境变量 INNGEST_SERVE_HOST，值为 ME 主站的完整网址（https 开头、不带路径），手动重新部署一次并核对部署时间晚于改变量；在 Inngest 云端核对 App 登记的回调地址仍是主站的 /api/inngest；等下一个整点，确认定时任务照常跑成功；任何一步没走到，就写卡在哪
---
邮件点击跟踪设计稿的第一轮审查发现（已对着 Inngest SDK 3.54.0 源码核实）：接收端点 src/app/api/inngest/route.ts 没设 serveHost，SDK 在这种情况下用「请求自己的域名」当登记地址，一个匿名 PUT 就会触发重新登记。
这是**早就存在**的风险（Render 默认域名现在就能被这样打），与点击跟踪本身无关；点击跟踪要给服务再挂一个由 CTS 管解析的域名，会让它更危险（设计稿已在该域名上封掉 /api/*）。
做法：不用改代码，只在 Render 设环境变量 INNGEST_SERVE_HOST（SDK 已支持）。Render 改环境变量不会自动重新部署，必须手动部署一次。
没验证：Inngest 云端当前登记的回调地址是否正是主站地址（设之前先看一眼）；这件事没有真发请求试过，只核了 SDK 源码。
