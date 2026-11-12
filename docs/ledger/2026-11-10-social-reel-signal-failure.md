---
id: 2026-11-10-social-reel-signal-failure
title: Reel 发布信号结构失败要留一条待办，发送失败仍交给补发
status: decided
owner: agent
decided_on: 2026-11-10
source: doc:docs/specs/2026-10-29-social-wp1-readback-implementation-brief-v2.md
verify_by: 2026-11-16
verify_how: 开关正好打开后，一条已公开但主页编号不合格的 Reel 在今日待办出现一条结构不合格，原因只有字段名。发送失败不写这条。开关没开时跟以前一样不写。
---
结构不合格写入已有的读回结果记录，不新建表，也没有在任何库执行。
只记字段名。发送失败仍由补发重试，不进待办，免得成功之后还留着一条假失败。
同一个工单的同一种结构失败只写一次。开关不是正好打开时不写。
规格见社媒读回实施说明里的补发失败留痕。不调 Meta。
开关打开后，用一条不合格的已公开 Reel 看今日待办是不是只有字段名。
