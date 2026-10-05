---
id: 2026-10-04-capi-meta-lead-id-forward
title: 成交回传给 Meta 时带上 Facebook 线索编号（草稿 PR，等批准后才上线）
status: decided
owner: pm
decided_on: 2026-10-04
source: session:02d64622
verify_by: 2026-10-11
verify_how: PM 批准并执行数据库那一步后，等下一次每日同步跑完，在 ME 成交审核页的预览里看"匹配键_有"出现"Facebook 线索编号"，且新生成的成交记录 meta_lead_id 非空；真实发送前先看一条试运行预览
---
做了什么：线索表第一列的 Facebook 线索编号一路带到发给 Meta 的 user_data.lead_id（官方参数，不加密）；事件名、金额、去重都没动。
没上线：需要先执行一条加列的数据库迁移（PM 点头才执行），合并也要 PM 点头（A 级）。
已知限制：Meta 的 CRM 线索阶段回传（28 天内、每月 200 线索）和 7 天事件窗口仍然适用；CTS 成交周期长，旧成交补不回，只改善今后的匹配。
