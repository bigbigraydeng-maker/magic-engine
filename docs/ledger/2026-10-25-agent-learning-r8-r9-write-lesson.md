---
id: 2026-10-25-agent-learning-r8-r9-write-lesson
title: 学到的规则以后能一次写进经验库：来源、有效期、脱敏结论同时落地，缺一项就不写
status: done
owner: agent
decided_on: 2026-10-25
source: session:0255470c
verify_how: PR 3139 合并后，在主干跑 npx vitest run src/lib/memory 全过且 tsc 退出码 0。这个函数还没有调用方、也不需要迁移，线上行为不变，所以没有线上指标要看
done_on: 2026-10-25
done_ref: pr:3139
---
PR 3139（草稿）给跨客户经验库的唯一写入函数加了可选的来源信息：带来源时先校验再写、一条语句写完、脱敏时间由函数自己填；不带来源时和以前完全一样。
还没人调用它；调用方（同步技能卡）和新增数据库列都要等后面的 L2/L3，合并与迁移仍由 Ray 决定。
