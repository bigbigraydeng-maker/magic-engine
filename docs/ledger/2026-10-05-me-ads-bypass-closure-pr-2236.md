---
id: 2026-10-05-me-ads-bypass-closure-pr-2236
title: 私信广告第二步精简版代码做完：旧一步投流入口已停用，私信系列不能用「恢复」开启，草稿 PR 等 PM 回「合」
status: done
owner: agent
decided_on: 2026-10-05
source: session:e7d5acf3
verify_by: 2026-10-12
verify_how: 查三件。①PR 是否在 PM 亲口回「合」后合并，合并后第一步的 base 是否已改回主干；②合并后对一个 ME 建的私信系列调「恢复」是否返回 422，调旧一步投流入口是否返回 410；③守卫查库的写法是否在真库上验过一次
done_on: 2026-10-05
done_ref: pr:2236
last_checked: 2026-10-12
---
守卫不按客户过滤（偏离 PM 原指令「同一客户」），原因见 PR 正文；PM 2026-10-05 回「认」，已定。
已知局限：账本没记系列编号的私信系列拦不住；绕过 ME 在 Meta 后台直接开启归第 3 步对账。
