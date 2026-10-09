---
id: 2026-10-09-cts-tour-catalog-p1a-core
title: CTS 团目录第一版（P1a）代码已写好并在本机整链路真跑通过：建表脚本、导入/回滚、读写层、后台接口、管理页面；建表脚本尚未应用到生产库，官网未改
status: decided
owner: agent
decided_on: 2026-10-09
source: pr:2383
verify_by: 2026-10-16
verify_how: 改动单合并后，PM 点头再把建表脚本应用到库；然后用 PM 的 2027 出团表上传预览，确认「表 vs 官网」差异行显示、Natural China 因歧义被拒、返程为空的行被拒；应用后回滚一次数据恢复
---
设计稿 docs/specs/2026-10-09-cts-tour-catalog-in-me-design-v0.3.md；代码在 src/lib/tour-catalog/，脚本 supabase/migrations/20261009100000_tour_catalog.sql（A 级，未应用）。
本机临时库 + PostgREST 整链路真跑：读官网 33 个团入目录、输出与官网逐字段一致（仅 Colorful Yunnan 因唯一班期已过期而判为不可售）、PM 的 2027 表预览/加别名/应用/回滚全部符合预期；另 24 项数据库行为检查与 1860 项相关测试通过。
未做：把建表脚本应用到生产库（需 PM 点头）、官网切换（P1b）、两个审查角色对代码的复审、Impeccable 界面检查（需先获准下载）。
