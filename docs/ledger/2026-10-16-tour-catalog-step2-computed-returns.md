---
id: 2026-10-16-tour-catalog-step2-computed-returns
title: 团目录草稿按完整行程天数补算 3 个返程日（上海 5/25、丝路 10/21、传奇 9/3），未发布
status: done
owner: agent
decided_on: 2026-10-16
source: session:87d912df
verify_by: 2026-10-23
verify_how: 后台导入记录里批次未被撤销；三个班期返程为 6/3、11/7、9/19；CTS 书面回复 5/25 上海返程日后核对；团目录仍未发布
done_on: 2026-10-16
done_ref: doc:docs/specs/2026-10-16-tour-catalog-as-root-step2-extra-departures.md
---
规则：返程=出发+行程天数−1（含首尾，最后一天抵奥克兰）。原值：上海5/25 返6/2、丝路10/21 返11/6、传奇9/3 返空。批次 2a408f71-c528-4611-bb81-568cc464ddae，回滚=撤销这次导入。
