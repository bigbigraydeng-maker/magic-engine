---
id: 2026-10-30-ads-breakdown-day-dimension
title: 广告健康页「多维数据」加上「按天」维度（每天花费、点击、展示、进线、每条进线）
status: done
owner: agent
decided_on: 2026-10-30
done_on: 2026-10-30
done_ref: pr:PRNUM
source: session:90a50c3b
verify_how: 合并部署后，PM 打开广告健康页「多维数据」标签，能看到「按天」表：每天一行、最新日期在上，每天花费合计等于同一天按小时那张表的合计；单独一天不打「偏贵/偏便宜」
---
PM 2026-10-30 要求多维数据要有 day 的维度。花费、展示、点击来自当天每小时数据加总；进线来自客户系统里按本地日期的表单进线；一天样本太少，只给数字不给判断。
只读，不新增表、不调 Meta。
