---
id: 2026-11-08-winner-sync-propose-only
title: 赢家素材同步和补素材只出确认卡，不再直接改广告
status: done
owner: agent
decided_on: 2026-11-08
source: session:6ccc65ad
verify_by: 2026-11-15
verify_how: 相关单测里，扫描不调用建广告和暂停；确认后只建暂停广告并回读，对不上不再写第二次；暂停只走已有暂停卡。
done_on: 2026-11-08
done_ref: pr:3665
---

每日扫描和补素材按钮只出确认卡。确认后新广告只建成暂停，开投要另一张卡。暂停建议走已有暂停卡。客户若原来设成自动上线，现在也只出建议。
