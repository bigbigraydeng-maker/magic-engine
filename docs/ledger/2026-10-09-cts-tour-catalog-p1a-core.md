---
id: 2026-10-09-cts-tour-catalog-p1a-core
title: CTS 团目录第一版（P1a）在本机做完：建表脚本、班期表导入/回滚、团与班期编辑、修改记录、AI 助手对话改团；PM 要求全部本地测好再上线，建表脚本未应用到生产库，官网未改
status: decided
owner: agent
decided_on: 2026-10-09
source: pr:2439
verify_by: 2026-10-16
verify_how: 改动单合并后，PM 点头再把建表脚本应用到库；然后用 PM 的 2027 出团表上传预览，确认「表 vs 官网」差异行显示、Natural China 因歧义被拒、返程为空的行被拒；应用后回滚一次数据恢复
---
设计稿 docs/specs/2026-10-09-cts-tour-catalog-in-me-design-v0.3.md；代码在 src/lib/tour-catalog/，脚本 supabase/migrations/tour_catalog.sql（A 级，未应用）。
本机临时库 + PostgREST 整链路真跑：读官网 33 个团入目录、输出与官网逐字段一致（仅 Colorful Yunnan 因唯一班期已过期而判为不可售）、PM 的 2027 表预览/加别名/应用/回滚全部符合预期；另 24 项数据库行为检查与 1860 项相关测试通过。
2026-10-10 增：后台编辑（团/班期，乐观并发，触发器写修改记录，第二份脚本 tour_catalog_edit.sql）与 AI 助手（只提议，PM 点应用才经既有接口保存）。审查：子牙/魏征/狄仁杰各两轮，测试 agent 三轮，均通过后仍待 PM 本机试用。
未做：把两份建表脚本应用到生产库（需 PM 点头）、官网切换（P1b）、Impeccable 界面检查（需先获准下载）、团图片管理（另一张卡）、AI 助手的用量/金额上限与限流、提示缓存、单价常量与现有封装共用（见设计稿 §6.7 后续事项）。
