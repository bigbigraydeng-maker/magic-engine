---
id: 2026-10-27-zhuge-drawer-three-readonly-tools
title: 诸葛抽屉可以只读处方进度、计划种子和花费线索
status: done
owner: agent
decided_on: 2026-10-27
source: issue:3304
verify_by: 2026-11-03
verify_how: 单测覆盖三个工具的读得到、读不到和没权限。抽屉里问一份处方走到哪一步时，读不到就写读不到，不填默认数字。不对生产库试跑，因为每次调用都会记一行动作记录。
done_on: 2026-10-27
done_ref: commit:16b755457
---
三个只读工具加在现有诸葛只读工具里，抽屉页面没改。
权限沿用原接口，没有放宽。读不到就写读不到。
花费读的是已经存好的检查回执，不打广告平台，也不读实时心跳。
后记：调用不再写入动作记录。见 2026-10-27-zhuge-readonly-tools-no-db-write。
没有对生产库试跑。
