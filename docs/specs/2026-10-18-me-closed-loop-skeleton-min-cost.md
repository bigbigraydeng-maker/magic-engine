# ME 闭环工作流骨架（最小成本版）· 统管窗口 · PM 10-18 授权「你来定骨架，检测当前代码，用最小成本解决」

## 结论
骨架就是产品定义里已有的 IMPACT（Inspect→Measure→Prescribe→Act→Check→Tune）。**零件基本都已经在代码里，缺的不是新系统，是「接线」**。做法：①每条业务线填一张「闭环登记表」，每个环节标 通 / 断 / 未验证；②只修「断」的，复用已有零件，不建新系统；③新表、新字段一律先问（新表是 A 级）。

## 每条线必须回答的七问 → 现有零件（2026-10-18 读代码 + cron_run_logs）
| 环节 | 必须有 | 现有零件 | 现状（证据） |
|---|---|---|---|
| 触发 | 事件或定时 | `lib/inngest`（40+ 函数）、`/api/cron/*`（54 个任务有运行记录） | 通：多数任务昨天都在跑 |
| 谁做 / 授权 | 人还是 AI、谁批 | `lib/kernel`（authorize/human-approval/outward-authorization）、`kernel-approval`「等你点头的动作」页、推广计划批准闸 | ⚠ 内核「代码在 main，生产只手动试跑过 2 次，无自动触发」（STATE.md），**没接进业务流** |
| 闸门 | 机器 fail-closed | 风险闸、预算上限、校验、人声闸、出处闸、相邻不同曲；内容实质闸（设计稿） | 部分通；内容闸未建 |
| 产出 / 任务 | 可点开的东西 | `execution_items`、`content_work_orders`、`plan_data.promo` | 通 |
| 回执 | 机器可读 | `published_ref`、`ads_autonomy_sync_receipts`、`cron_run_logs`、kernel lineage | 通；但 `published_ref` 不回写人工转公开（10-14 总表已写） |
| 核实 T+N | 到期回头查 | `docs/ledger`（verify_by）+ 夜巡 `calendar-closure-audit`、`daily-plan-post-measurement`、`factory-reel-measurement-adapter`、`promo-plan-daily-watch`、`crm-lead-followup-digest` | 通：昨天均在跑（calendar-closure-audit 10-17、promo-plan-daily-watch 10-17、crm-lead-followup-digest 10-17） |
| 回写 | 结果回到下一轮 | `lib/flywheel`（Meta/Social/TikTok/SEO 等适配器，outcomes）、`goal-pace` | 未验证：适配器是否把 CTS 广告/社媒结果真写回计划，没核 |
| 给人看的出口 | 只在预算/授权处出现 | `pm-todo`「今日待办」5 类、`kernel-approvals`、广告健康页 | 通；但**失败不一定变成人工任务**，见下 |

**反例：线索同步 `meta-leads-sync` 已连续 ≥12 次（至少 24 小时）失败**，每次 3/7 个客户（含 Magic Lab Class）因 Meta 页面权限取不到线索，记录在日志，**是否进了今日待办我没查**。这就是「发现死在日志里」，违反 CLAUDE.md §3。

## 四条线的闭环登记表（初版，各负责人去填实、去核）
| 线 | 负责 | 已知「断」的环节 | 最小成本修法（复用，不建新） |
|---|---|---|---|
| 广告 | 74 / 105 | 需求（先做片后挑片）；素材入广告账户库（官方账户看不到主页视频）；销售承接前置；成交回写 | 105 的设计稿：判断卡/需求单/承接闸放进 `plan_data.promo`，不建表；素材入池规则改现有 creative_pool 写入；成交回写用联系人归因（contacts.attr_* 已有 522/1187）做查询，不加列 |
| 社媒 | 97 | 发布最后一步（总开关没开→草稿→人工转公开，回执不回写）；发布后表现回写计划 | 把 74 的「草稿转公开」函数做成「授权后单条转公开」按钮，并回写 published_ref；核实 daily-plan-post-measurement 是否回写 |
| 出片 | 106（模版总负责人待 PM 定） | 出片不由计划驱动；模版无统一负责人；内容实质闸未建 | 需求单同广告；内容闸按 2026-10-18-content-substance-gate-design |
| 客人 | 76 | 同一人被拆成两个联系人（无合并功能）；24 小时回电话没人保证（121 条私信没人回）；成交没快照来源 | 76 的合并设计稿；`crm-lead-followup-digest` 已在跑，核实它是否产出带负责人的人工任务；成交来源用现有归因 |

## 通用规则（骨架本身）
1. 每条线每个环节必须写成：触发 → 谁做 → 闸门 → 产出 → 回执 → 核实日 → 回写；写不全就是「断」。
2. 断点只用现有零件修；要新表的，标 A 级，先问 PM。
3. 每周一次「闭环巡检」（复用 calendar-closure-audit 的模式，不新建系统）：每条线每个环节昨天有没有回执；没有就进今日待办，带 what / how / href。
4. 三层分开：骨架放平台层；行业规则（毛利、提前期）放行业层；CTS 的数字和人名放客户层，不进共享代码。
5. 真人只在预算、审核、授权三处出现。

## 没核实的
kernel 为何没接线、接线要多大成本；flywheel 适配器是否在写 CTS 结果；`meta-leads-sync` 失败是否已变成待办；各 measurement 函数写回的是哪张表。
