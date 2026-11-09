---
id: 2026-10-06-site-audit-meta-description-column-migration
title: 仓库里补一条"页面描述那一列"的建表记录，新搭的库才不会缺这一列
status: decided
owner: agent
decided_on: 2026-10-06
source: pr:2233
verify_by: 2026-10-13
verify_how: 看另开的那条数据库小改动 PR 是否开出并由 PM 回「合」合并；合并后在 CTS 生产库查 client_site_pages 仍有 meta_description 一列（该语句本就是"没有才加"，生产上不会有变化）。不成：到期仍没有这条 PR。
---
生产库早就有 client_site_pages.meta_description，但仓库的建表记录里从来没写过，所以按记录从零重建的库会缺这一列，网站体检写入会失败。
审查机器人在 PR 2233 上提了这点（线程已过期）。碰数据库结构属于 A 级，不塞进 B 级的 PR 2233，另开一条只含 `ADD COLUMN IF NOT EXISTS` 的 A 级小 PR，由 PM 点头后合。
