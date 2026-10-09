---
id: 2026-10-09-cts-tour-catalog-p1a-core
title: CTS 团目录第一版（P1a）核心已写好：四张表的建表脚本、事务式导入/回滚、纯逻辑模块与测试；脚本尚未应用到生产库，后台页面和接口还没做
status: decided
owner: agent
decided_on: 2026-10-09
source: pr:2383
verify_by: 2026-10-16
verify_how: 改动单合并后，PM 点头再把建表脚本应用到库；然后用 PM 的 2027 出团表上传预览，确认「表 vs 官网」差异行显示、Natural China 因歧义被拒、返程为空的行被拒；应用后回滚一次数据恢复
---
设计稿 docs/specs/2026-10-09-cts-tour-catalog-in-me-design-v0.3.md；代码在 src/lib/tour-catalog/，脚本 supabase/migrations/20261009100000_tour_catalog.sql（A 级，未应用）。
本机临时库已真跑 24 项检查（应用/回滚/过期并发拒绝/半截不落/越权拒绝/匿名不可读），纯逻辑 105 项测试通过。
未做：后台上传页与接口、种子导入 33 个团、官网切换（P1b）。
