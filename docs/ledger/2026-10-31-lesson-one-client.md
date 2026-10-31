---
id: 2026-10-31-lesson-one-client
title: 一条专家经验可以只给一个客户开，其它客户读不到
status: decided
owner: agent
decided_on: 2026-10-31
source: session:34e65133
verify_by: 2026-11-07
verify_how: 合并上线后，在广告引擎页把 Glenn Gabe 那条建议采用的经验只给 CTS 开。该客户的助手能读到，其它客户的助手读不到。没写名单的经验仍是所有符合范围的客户都读。
---
名单写在已有 evidence 里的 pilot_client_ids，不加数据库字段。只给一个客户开时开关仍是开，读取时按名单过滤。点「恢复」会清掉名单并对所有客户打开。本卡不启用任何经验。
