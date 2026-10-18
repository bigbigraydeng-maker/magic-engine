# A0 熔断探针 · 当场试跑回执（2026-10-19 NZ 00:49）

卡：`2026-10-18-ads-circuit-probe-a0`（verify_how 第 ② 条的中途证据，不是结案）

## 怎么跑的

探针第一次随 cron 真跑要等 NZ 10-19 06:00，PM 10-19 要求「开始测自动化」、不许拿未来时间当验收，所以在本地用**生产数据**直接调 `probeClientCircuit`（临时脚本，跑完已删）。
探针只读，不写任何表（由 `src/lib/ads-strategy/__tests__/circuit-probe.test.ts` 扫源码钉住，含传递依赖）。

- 时间：2026-10-18T11:49Z = NZ 2026-10-19 00:49
- 命令：`npx tsx --env-file=.env.local <临时脚本>`，退出码 0，无报错
- 覆盖：`ad_strategy_configs` 全部 4 行客户

## 真实输出

| 客户 | autonomy | 探针结论 | 原因码 |
|---|---|---|---|
| Roman HU | observe | 跳过 | `skipped:not_bounded_auto` |
| 30 Kiteroa Rothesay Bay | observe | 跳过 | `skipped:not_bounded_auto` |
| New Asian Logistics | bounded_auto | 判不出 | `facts:account_data_stale`；账户无日上限 → `cap_missing` ×4 倍数 |
| CTS Tours NZ（2 个账户） | bounded_auto | 判不出 | `facts:account_data_stale`；有上限（$40 / $110）但目标日无花费 → `spend_missing` ×4 倍数 |

补充事实：NAL 近 7 天有花费（中位数 $47.42、7 个非零日）但账户日上限为空；CTS 两账户 14 天窗口内非零日 = 0、中位数为空，与「10-10 起欠款停摆」一致。CTS 次账户出现 `deliveringCampaigns=5 / deliveringAdsets=0`。

## 结论（三件事，分开说）

1. **代码跑得通**：生产数据、真实调用、无异常，跳过 / 判不出两条分支都走到了。
2. **它现在给不出熔断结论**，两个原因与卡上第三轮复审的预判一致：NAL 缺日上限、CTS 没有花费。这不是探针的 bug。
3. **有一条还没验**：真 cron 里顺序是「先拉数、后探针」，所以目标日花费在 06:00 那轮应当已入库；本次是在拉数之前跑的，`spend_missing` 里有多少属于这个时序差，要等 10-19 06:00 那轮的 `summary.circuit_probe` 才能分清。

## 同时跑的单元测试

`npm test -- circuit-probe.test.ts ads-d3-auto-pause.test.ts ads-autonomy-sync.test.ts` → 3 文件 / 66 测试全绿，退出码 0。
未运行：类型检查、build、E2E（本次只跑了与试跑相关的定向测试）。
