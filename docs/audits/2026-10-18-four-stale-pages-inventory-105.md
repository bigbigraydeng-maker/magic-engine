# 四个「半年没动」页面的盘点（计划与目标类）· 105 号 · 2026-10-18

只读盘点，**没改任何东西**。代码来自主干当前版本，数字来自生产库只读查询（查不到就写查不到）。
结论按统筹要求偏向「并 / 退」。

| 页面 | 读写什么 | 最近一次真实使用 | 和现有页面重不重 | 结论 |
|---|---|---|---|---|
| `/clients/[id]/brief` | 走 `/api/clients/[id]/light-brief`（GET + POST），只碰 `clients` 与 `client_portal_users` 两张表 | **查不到**：这条路径不写任何业务表，写的是客户档案本身，没有独立的时间戳可查 | 与「客户档案 / master_brief」那条线重叠；系统里真正在读的是 `master_briefs` | **并入**客户档案页 |
| `/clients/[id]/strategy` | 走 `/api/clients/[id]/strategy`（GET / PATCH / generate POST），主表 `content_strategy_items` | **2026-08-25**（整表最后一条）；按月：5 月 58 条、6 月 35 条、7 月 3 条、8 月 2 条，**之后为零** | 与「推广计划」「目标」在职责上重叠：选题建议现在实际走的是每日计划与内容线文档 | **退役候选**：近两个月零写入，且下游没人读 |
| `/clients/[id]/goals/history` | 走 `/api/clients/[id]/goals`，表 `goals` | 目标表本身很活：**2026-10-17** 还有更新，共 33 条 | **重**：目标页已有当前目标；这页只是「历史」视图，没有别处链接进来（我 grep 过，零入口） | **并入**目标页做一个「看历史」开关 |
| `/clients/[id]/execution/timeline` | 走 `/api/clients/[id]/execution`，牵涉 11 张表（`execution_items` `execution_logs` `content_posts` `production_items` `reels_drafts` `visual_assets` `flywheel_actions` `luban_messages` `prescriptions` `marketing_plans` `clients`） | `execution_items` **2026-10-17**（1674 条）；`execution_logs` **2026-10-04**（107 条） | **重**：执行看板已经在用同一批表；这页是时间线视图，同样**零入口**（grep 无链接） | **并入**执行看板做一个「按时间看」开关 |

## 三条支撑证据（都查实了）

1. **四页里有两页根本没有入口**：`goals/history` 与 `execution/timeline` 在 `src/app`、`src/lib` 里都搜不到指向它们的链接，只能靠手敲网址进去。
2. **`strategy` 那条线的数据在 8 月就停了**：`content_strategy_items` 最后一条 2026-08-25，7 月和 8 月合计只有 5 条，5–6 月有 93 条——是明显的「用过一阵就不用了」。
3. **`execution_items` 还很活，但不是这页在写**：按来源拆，`zhuge` 1070 条（最近 10-12）、`diagnostic` 263 条（10-13）、`proactive_signal` 21 条（10-17）；而 `marketing_plan` 来源的 289 条**最后一条停在 2026-06-08**。所以活的是执行看板和诸葛那条线，不是这个时间线页，**也说明营销计划派任务这条路实际上早就没在跑**（和子牙复审里「派发路是关着的」对得上）。

## 没核实的

- `brief` 页的真实使用频率：它不写业务表，没有可查的时间戳；要知道有没有人用，得看访问日志，我没有。
- 四页是否有客户（非内部）在用：权限是内部后台，但我没逐页核权限配置。
- 「并入」的具体工作量：没拆，需要接手的窗口自己估。
