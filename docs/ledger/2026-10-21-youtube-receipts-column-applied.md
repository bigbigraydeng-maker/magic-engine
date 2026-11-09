---
id: 2026-10-21-youtube-receipts-column-applied
title: 生产库 YouTube 回执表加了 content_post_id 一列和一个索引（PM 本人回 go apply 后应用，已读回）
status: done
owner: agent
decided_on: 2026-10-21
source: session:ec90bb17
verify_by: 2026-10-21
verify_how: 查库：youtube_publish_receipts 有 content_post_id 列、部分索引和指向内容帖表的外键；看板接口不再报缺列；内容工厂页能打开且没有红字。
done_on: 2026-10-21
done_ref: doc:docs/sops/2026-10-21-youtube-receipts-content-post-go-apply.md
---
内容工厂页 10 月 18 日起读 youtube_publish_receipts.content_post_id，生产库一直没有这一列（10 月 18 日那份迁移来自 PR 2864，没应用），页面靠 PR 2985 的兜底才没死。
2026-10-21 PM 本人回「go apply」，统管 18 号用 apply_migration 应用了这一份：只加 1 列 + 1 个部分索引，表里 0 行，不动已有数据。读回见证据文件。
读回证据：docs/ledger/evidence/2026-10-21-youtube-receipts-column-applied--2026-10-21.md。另两份还没应用的迁移（回链列、素材关联加固）不属本卡，没动。
