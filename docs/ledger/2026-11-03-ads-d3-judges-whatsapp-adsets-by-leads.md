---
id: 2026-11-03-ads-d3-judges-whatsapp-adsets-by-leads
title: 线上「花钱没结果」（D3）拿客户配的留资去数 WhatsApp 开聊组，CTS 一个 WhatsApp 组连着 6 天被误报
status: done
owner: agent
decided_on: 2026-11-03
source: session:f765a75f
verify_by: 2026-11-17
verify_how: 修好合并后，近 7 天日报和今日待办里，按开聊优化的广告组不再因为「零留资」出现在花钱没结果里；按留资优化的组照常判，D3 自动暂停提议数不比修前多
done_on: 2026-11-03
done_ref: pr:3535
---
生产库只读：CTS 广告组 …493473（优化目标 CONVERSATIONS、目的地 WHATSAPP）10-25 → 10-30 每天都命中 D3「花钱没结果」，进了内部日报和今日待办。CTS 配的主结果是留资，这个组本来就不出留资。
D3 自动暂停提议到目前只有 2 条，都在按留资优化的组上，没有误停。D2 / D10 已经按广告组自己的结果种类判（rules/core-metric.ts 的 resolveCoreMetric），D3 没接。
修法：D3 按广告组自己的结果种类数；跟客户主结果不是一种的组，改出「判不了：结果种类对不上」，不出命中。改 src/lib/ads-strategy 下的规则，A 级，要 Ray 本人合并。
