---
id: 2026-11-10-conversion-past-window-reason
title: 超过平台时限的成交核对自动标不发送，原因用超过时限，邮件和页面对齐
status: done
owner: agent
decided_on: 2026-11-10
done_on: 2026-11-10
done_ref: commit:a54b1fcb37597c706ea634035fea1c513f9e54ff
source: doc:docs/ledger/2026-09-26-conversion-expired-sweep-regardless-of-toggle.md
verify_by: 2026-11-17
verify_how: 核对页「不发送」能选「超过时限」。今日待办里过了窗口的不再写成几天前，客人名和页面一致。用邮件链接打开不再报客户编号读不出来。自动审核关着的客户，过了窗口的待核对也会被标成不发送，并留一条写明过期的记录。
---
派活等级 L4，写代码模型 Grok 4.7。这是云端代理直接写的，不是默认的 Opus 派活。
过了广告平台 7 天窗口的待核对，标成不发送、原因「超过时限」，不发给广告平台。自动审核关着也清。还差不到 1 小时才过期的，只在自动审核开着时提前清。
邮件用页面上的名，不再用姓的缩写。过了窗口的不再以「7 天前」列进待办。
已报价自动回传见 docs/ledger/2026-11-10-quoted-lead-auto-send.md。按金额自动回传成交仍另做。
上线前要先让数据库认得「超过时限」这个原因。本窗口没有改生产数据。
