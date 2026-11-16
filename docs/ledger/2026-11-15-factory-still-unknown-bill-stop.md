---
id: 2026-11-15-factory-still-unknown-bill-stop
title: 静图改图没回报价时按估价记账并停下
status: done
owner: agent
decided_on: 2026-11-15
done_on: 2026-11-15
done_ref: doc:src/lib/factory/still-produce.ts
source: pr:3860
verify_by: 2026-11-22
verify_how: 开关打开后，改图抛错且没有花费和请求号时，账本有一笔负的估价，这一轮不再出下一张。
---

供应商抛错时改图结果是可能已扣费，但花费和请求号都是空的。这时按一张静图的估价记账，并停下这一轮。
开关默认仍然关着。没有报价、也不是这种可能已扣费的失败时，不按估价补记。
