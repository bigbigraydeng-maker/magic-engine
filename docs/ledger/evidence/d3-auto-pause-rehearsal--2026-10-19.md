# D3「花钱没结果」自动暂停 · 当场演练回执（2026-10-19 NZ 01:25）

PM 2026-10-19 指令：「用测试数据演练一次，不碰真广告」。

## 为什么要演练

生产库 `flywheel_actions` 里 `ads.auto_pause_on_d3` **0 行**。查清原因：**它天天在跑，但判据从没命中过。**
`ad_health_narratives.payload.portfolio_diagnoses` 近几天逐日可见：D3 每天都是 `not_comparable`（样本不可比），D7 每天 `hit`。
所以"零记录"不是没跑，是没有东西可记——它不会为"这次没事"留一行。等真命中可能很久，故用测试数据先看它会判什么。

## 怎么跑的（不碰真广告、不碰生产库）

- 走**真代码** `processD3Hit`（`src/lib/inngest/functions/ads-d3-auto-pause.ts:296`），不是另写一份逻辑
- 数据库换成只记在内存的替身；提交 Kernel 那一步也是替身 → **没有任何请求发到 Meta，生产库一行没写**
- 环境变量用的是假的本地值（`127.0.0.1:1/unused` + dummy key），保证连不到真实库
- 客户 / 广告账户 / 广告组全是 `TEST-` 前缀的编造值
- 临时脚本跑完已删除，不进仓库

## 五个场景的真实输出

| 场景 | 结论 | 提交 Kernel | 回执 status |
|---|---|---|---|
| ① 演练模式开（**现在所有客户的真实状态**） | `dry_run_logged` | 0 次 | `dry_run_logged` |
| ② 演练模式关（将来真自动暂停的样子） | `awaiting_approval` | 1 次 | `awaiting_approval` |
| ③ 广告组不是这个客户的 | `skipped_not_client_owned` | 0 次 | `blocked` |
| ④ 系统核实不了归属（读失败） | `skipped_not_client_owned` | 0 次 | `failed` |
| ⑤ 共用广告账户 | `skipped_shared_account` | 0 次 | `blocked` |

③ 与 ④ 的区分是对的：「查过了、不是这个客户的」记 `blocked`，「系统没法核实」记 `failed`，两者没混。

场景②提交给 Kernel 的内容（替身收到的原文）带齐了：客户、广告账户、广告组、诊断码、日期、触发来源、人话理由（诊断标题）、证据（花费 / 结果数 / 样本 / 归属核实结果）。

## 查出一个小问题（没在本次修）

**场景②的回执没有人话说明**：① ③ ④ ⑤ 四条都带 `reason`，唯独 `awaiting_approval` 那条没有。
后果：将来真要人批准时，PM 在待办里看到的是一条没有一句说明的记录，得自己去拼 `diagnosis_title`。
建议补一句，例如「花钱没结果，已提交等你批准暂停这个广告组」。属 C 级小改动，单独开卡。

## 结论

**这个功能的判断逻辑是通的，五条分支都走到了，闸门方向都偏严不偏松。**
它现在不出手的唯一原因是判据没命中，不是坏了。
真要让它动手，还差：①判据为什么天天 `not_comparable` 要查清 ②`autopilot_dry_run` 要关（PM 本人决定）。

## 未运行

未跑 build / E2E / 全量测试；本次是演练脚本 + 定向读库。
