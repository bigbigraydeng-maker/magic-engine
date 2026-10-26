---
id: 2026-10-18-ads-door-approvals-move-step2
title: 广告门第二步：自动暂停的批准内容整段搬进「等你点头」标签，旧网址改跳转，登记表改一处
status: done
owner: agent
decided_on: 2026-10-18
source: session:c668eb35
done_on: 2026-10-18
done_ref: doc:docs/specs/2026-10-18-ads-door-merge-design-v0.1.md
verify_by: 2026-10-23
verify_how: 打开某客户广告健康页点「等你点头」，应直接看到待批准列表（没有就显示「目前没有等你点头的暂停建议」）；访问旧网址 .../ad-health/auto-pause 应跳到 ads-health?tab=approvals；今日待办里那条自动暂停的链接也应指向新网址。真按一次批准前先确认有待批准项
---
照设计稿 §5 步 2 做的，B 级。搬的只是位置：面板改收 clientId 入参，**两个接口的网址、方法、请求体、409 处理一个字没动**。
旧页面保留为服务端跳转（已发出的待办邮件链接不失效，且登记表守卫要求入口有真实页面文件）。
登记表 path 改一处，待办链接与页面链接一起跟着走；守卫测试的路径解析加了「先砍掉 ?query」。
两条变异验证：改请求体→红 1、改接口网址→红 1，还原 22/22 绿。
