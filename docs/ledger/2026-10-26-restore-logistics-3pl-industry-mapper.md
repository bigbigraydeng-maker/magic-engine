---
id: 2026-10-26-restore-logistics-3pl-industry-mapper
title: 第三方物流行业字典被盖掉后已补回，物流客户和同行基准能对上号
status: done
owner: agent
decided_on: 2026-10-26
source: pr:3216
verify_by: 2026-10-28
verify_how: 本 PR 合并进主干后，在主干跑 npx vitest run src/lib/huatuo/__tests__/industry-mapper.test.ts，12 条全过，且 ecommerce fulfilment 加 warehousing 仍映射到 logistics_3pl、单独的 travel 仍映射到 tourism_operator。PR 还没合并时只记还没合并。
done_on: 2026-10-26
done_ref: pr:3216
---
原因：#712（提交 8f3d3a39，7 月 31 日）在行业字典加入 logistics_3pl 和中文名「第三方物流/仓储履约」；#664（提交 3803ff92，8 月 5 日）合并时把这两处整段盖掉。#664 留下的 tourism_operator 关键词 travel 仍保留。
改动：字典项放回 ecommerce_d2c 后面，中文名补回；测试加一条，单独的 travel 映射到 tourism_operator。代码在 pr:3216。
测试：npx vitest run src/lib/huatuo 退出码 0，7 个文件 76 条全过。industry-mapper 12 条（原来 11 条加 1 条）。ecommerce fulfilment 加 warehousing 映射到 logistics_3pl 通过。
影响：物流客户的行业标签能识别成 logistics_3pl；同行基准按这个行业聚合后有人读；录入域名时的行业白名单重新包含这一项。
