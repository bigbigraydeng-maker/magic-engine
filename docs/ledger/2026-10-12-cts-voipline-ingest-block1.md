---
id: 2026-10-12-cts-voipline-ingest-block1
title: CTS 员工电话接入第一块写好了（接收通话事件→写客户记录→录音只记引用），但真实通话还没验过
status: done
owner: pm
decided_on: 2026-10-12
source: session:96dc6edf
verify_how: 等 CTS 在 VoIPLine 门户配好并拿到真实事件样例后，用受控测试号码打 6 种电话，查原始事件进了没、通话状态对不对、客户记录里只有一条。没有真实样例前字段名只是按别名表读的
done_on: 2026-10-12
done_ref: pr:2462
---
PR 2462 草稿，A 级，合并等 PM 回「合」；生产库迁移等 PM 回「同意」。门户配置清单见 docs/clients/cts/2026-10-12-voipline-setup-checklist.md。
没做：录音下载、转写、摘要、待确认页面、保存期限清理。
