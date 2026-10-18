# 社媒线闭环登记表（97 号，2026-10-18）

- 性质：只读核实，没改代码、没写库。代码读的是本地 origin/main `ad7cc7e1d`（未刷新）；生产库为 2026-10-18 只读查询。
- 结论：三条线「发出去之后」都没闭环。Reel 转公开靠人手且不回写；Story 发布和回执通但发后没核实；图文 Post 近 14 天一条没发。三条线都没有表现数据回到下一轮计划。

## 登记表（通 / 断 / 未验证）
| 环节 | Story | 图文 Post | Reel |
|---|---|---|---|
| 触发 | 通：Inngest 每 10 分钟 | 通：Inngest 每小时 20 分，近 14 天 156 次完成 | 通：Render 定时任务每小时 05 分 |
| 谁做 | 通：机器发，须先有人授权整周包 | 未验证：授权表 0 行，从未真发 | 断：上传是机器，转公开是 74 号人手 |
| 闸门 | 通：全局开关+客户名单+周包授权+文件指纹 | 通：开关+按计划版本授权，但从未真发 | 断：只有全局 FACTORY_PUBLISH_LIVE，没有按条授权 |
| 产出 | 通：近 14 天 8 条已发 | 断：0 条 | 断：近 30 天 14 张「已发布」里 11 张其实是草稿 |
| 回执 | 通：story_items.provider_receipt | 机制通/无数据：attempts 表 0 行 | 断：工单与动作行的 video_state 不一致 |
| 核实日 | 断：无发后回读，只有待办提醒 | 断：无发布，无核实 | 断：转公开后无核实步骤 |
| 回写表现 | 断：Story 无表现采集 | 断：接线在，库里 0 行，下一轮计划不读 | 断：接线因 DRAFT 被跳过 |

## ① Reel 最后一步（断）
- 没开 FACTORY_PUBLISH_LIVE 只存草稿但工单记 published：已在 PITFALLS.md:20 与 2026-10-08 稳定性审计记录；最近运行 live:false。
- 工厂 Reel 没有任何代码调用 `promoteReelToPublished`（`facebook-reel-adapter.ts:242`，仅讲课片 `lecture-publish.ts:147` 在用）。
- 近 30 天 published 工单 14 张，published_ref 空 0 张；但 11 张 video_state=DRAFT；3 张为人工转公开后手写（带 promoted_note）。flywheel_actions 的 video_state 永远 DRAFT。
- **最小成本修法（不需要新表）**：做一个仅管理员、绑定单条工单、授权后单条「转公开」的动作，套现成 `promoteReelToPublished`；转完同时写工单 published_ref.video_state=PUBLISHED 与 flywheel_actions.payload.video_state=PUBLISHED，再发 reel-published-event，这样表现采集的接线条件才满足。
- **风险级：A**（发布路径、对外不可逆副作用）。需子牙+魏征+狄仁杰审、PR 保持草稿、PM 本人点头；写代码走 DeepSeek 或例外说明。授权要按条，不复用全局开关。

## ② 表现回写（断）
- 代码写得通：`daily-plan-post-measurement`、`factory-reel-measurement-adapter` 已注册（`inngest/functions/index.ts:6,8,54`），写 flywheel_actions（social.publish_post）与 social_post_measurement_receipts（T+4h、T+72h）。
- 生产库近 30 天两者都是 0 行。原因：Reel 接线器要求动作行 PUBLISHED，实际永远 DRAFT；Post 没发过。
- 下一轮计划不读：读 receipts 的只有 `tune-suggestions/route.ts` 与 `flywheel/tune/social-post-cohort.ts`，只用于后台页展示建议；`src/lib/campaign/` 无读取点。周包/选题间接读取：未验证。
- 另一条：social-engagement-pullback 每天 04:00 UTC，近 14 天 14 次完成，但最近一次 metricsWritten:0，5 客户中 3 个主页读取报错（2 权限、1 not_bound_page）。

## ③ Story / Post 回执与核实日
- Story：发布与回执通（近 14 天尝试 10 次、成功 8 且都有回执、错过时段 2、不确定 0）。`story.item.attempted` 事件无人消费，无发后回读；台账 2026-10-12 的 verify_by 10-19 只验「每 10 分钟在跑」，不验发后核实。
- 图文 Post：授权表 0 行、attempts 0 行，全部为「机制在、没跑过」。台账 2026-10-10-daily-plan-auto-publish-golive-prereqs 的 verify_by 10-17 已过期，仍是 decided；10 项清单做到几项：未验证。

## 建议的修断点顺序（只用现有零件，新表另报 A 级）
1. Reel 按条转公开并回写（A 级，见上）——修好后 ② 的 Reel 表现采集自动解锁。
2. 把 receipts 的读取接进下一轮计划/周包生成（B 级，读现有表，不新增表；先设计再做）。
3. Story 发后核实：复用已有待办提醒，不新增表（B 级，先定要核实什么）。
4. pullback 的 3 个主页权限/绑定问题（连接器配置，非代码）。

## 没验证到的
Render 上三个 LIVE 开关真实值（只能从运行记录反推）；周包/选题是否间接读表现；自动发布 10 项清单进度。
