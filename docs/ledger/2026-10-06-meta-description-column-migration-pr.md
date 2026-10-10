---
id: 2026-10-06-meta-description-column-migration-pr
title: 补上"页面描述那一列"的建表记录（生产库本来就有，只是仓库记录漏了）
status: decided
owner: agent
decided_on: 2026-10-06
source: pr:2233
verify_by: 2026-10-13
verify_how: A 级，等 PM 回「合」后合并；合并后在生产库查 client_site_pages 仍有 meta_description 一列、体检写入不报错。不成：到期仍未合并。
---
这是 PR 2233 审查意见里"新建/重放的库缺这一列"的修法，单独成 A 级小 PR，因为碰数据库结构。内容只有一句"没有才加"的建列语句。
