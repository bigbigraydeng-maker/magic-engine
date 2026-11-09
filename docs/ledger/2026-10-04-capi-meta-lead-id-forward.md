---
id: 2026-10-04-capi-meta-lead-id-forward
title: 成交回传给 Meta 时带上 Facebook 线索编号（草稿 PR，等批准后才上线）
status: done
owner: pm
decided_on: 2026-10-04
source: session:02d64622
done_on: 2026-10-04
done_ref: pr:2211
verify_by: 2026-10-11
verify_how: PM 批准并执行数据库那一步后，等下一次每日同步跑完，在 ME 成交审核页的预览里看"匹配键_有"出现"Facebook 线索编号"，且新生成的成交记录 meta_lead_id 非空；真实发送前先看一条试运行预览
last_checked: 2026-10-29
check_note: 10-29 查生产库 me_sale_outcomes：共 699 条，带 meta_lead_id 17 条；10-04 以后新生成 6 条里 4 条非空(最新一条 10-17)；PR 2210/2211 均已合并。成交审核页预览里的匹配键要登录后台看，夜巡判不了
---
做了什么：线索表第一列的 Facebook 线索编号一路带到发给 Meta 的 user_data.lead_id（官方参数，不加密）；事件名、金额、去重都没动。
已上线：10/4 PM 点头后已在生产库执行迁移（680 行未动，约束校验通过），PR 2210 已合并。首次每日同步后核对见日历 10/6。
已知限制：Meta 的 CRM 线索阶段回传（28 天内、每月 200 线索）和 7 天事件窗口仍然适用；CTS 成交周期长，旧成交补不回，只改善今后的匹配。
实现 PR：pr:2210（已合并）；done_ref 指向本收尾 PR，因为台账门禁要求改卡的 PR 必须被一张卡指向。
