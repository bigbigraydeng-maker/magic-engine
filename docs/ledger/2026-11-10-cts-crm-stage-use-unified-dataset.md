---
id: 2026-11-10-cts-crm-stage-use-unified-dataset
title: CTS 客人进展回报用官网在用的那个数据集（Facebook 现在的接入流程就是这样），不另建；ME 去掉「不能与官网数据集相同」的限制
status: decided
owner: agent
decided_on: 2026-11-10
source: session:f2f2eb69
verify_by: 2026-11-17
verify_how: CTS 配置写成试运行后，试运行预览里目标数据集是「CTS Tours 数据」且预检通过；切正式后该数据集的事件清单里出现 Initial Lead / Quoted / Deposit Paid 三种事件，来源标成 CRM，官网原有的留资数没有因此变多
---
PM 11-10 原话「你来设计，我的需求是把从 ME CRM 的数据正确回传回去，帮我广告找到更多的人」。
11-10 在 CTS 事件管理工具实测：连接数据 → CRM → 手动连接，不新建数据集，直接挂到已有的统一数据集。所以去掉上一单复核后加的「线索阶段数据集不能等于网站像素」限制。
第一档事件名用 Initial Lead，不用 Lead，避免跟官网留资事件同名混算。
同日 CTS 主力广告账户已由 PM 移入 CTStours 商务账户（撤不回），这是以后用「按合格线索优化」广告目标的前提。
后续顺序：试运行 → 切正式 → 攒两周数据 → 事件管理工具里配置漏斗（选 Quoted 为优化档）→ 经 ME 草稿流程开一组按合格线索优化的对照广告（花钱，PM 批）。
