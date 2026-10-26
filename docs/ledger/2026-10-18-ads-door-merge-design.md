---
id: 2026-10-18-ads-door-merge-design
title: 广告门合一设计稿已出（第四道门，照 97 号三道门的约定写），等统筹和 PM 点头才动代码
status: decided
owner: pm
decided_on: 2026-10-18
source: session:c668eb35
verify_by: 2026-10-23
verify_how: 看统筹和 PM 是否对设计稿点头；点头前不写代码。点头后第一步（加「等你点头」标签骨架）是 C 级，第二步搬 auto-pause 是 B 级需一次独立审查核对批准请求体没变
---
设计稿：docs/specs/2026-10-18-ads-door-merge-design-v0.1.md。
结论是广告门不用大动：118 号已把入口收成一张卡，真正要定的是三件——那张卡上 3 个次级链接其实归 97 号的计划门（会撞车）、auto-pause 是独立半截页面该收成标签、两个全局页不该塞进按客户的门。
顺带发现通用审批页对广告动作「只签不执行」而页面上没说，建议加一行文案（C 级），根因属 Kernel WP07 不在本稿。
四步全 C/B 级，不碰库、不碰授权、不碰闸。
