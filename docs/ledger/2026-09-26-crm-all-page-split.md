---
id: 2026-09-26-crm-all-page-split
title: 「全部客人」页从 1034 行拆到 867 行，共享类型标签和时间线条目搬进 _components（纯搬家，逐字节证明没改）
status: decided
owner: agent
decided_on: 2026-09-26
source: session:5b9407a2
verify_by: 2026-10-03
verify_how: 打开 CTS 全部客人页，展开任一客人看时间线：渠道/方向/结论标签、相对时间、冷热配色都跟搬家前一样。行为有任何差别说明搬家不纯
---
WP3 R6。page.tsx 1034 行超了 800 行上限，R7 还要往里加分段组件，先拆。
搬出去两块：_components/contact-table-types.ts（ContactRow / CustomColumnMeta / TimelineEntry 三个类型 + 四张标签表 + ts / fmtDate / relTime 三个格式化函数）和 _components/TimelineItem.tsx。
用脚本搬不用模型：纯搬家这种活脚本能逐字节证明「一个字都没改」，模型不能。搬完把三个文件里属于搬家内容的部分拼回来，跟 git 里原始文件的对应行区间做精确比对，两块都逐字节一致。
避开了 MarkWonPanel / ImportantMarkerEditor / ContactDetail 那一段 —— 另一个会话正在修那里的红测试（nal-mark-won-panel），不双写。那三块留给 R6 第二轮。
既有失败：nal-mark-won-panel 那 3 个测试在干净主干上就是红的，本轮前后都红，正由另一个会话修。
