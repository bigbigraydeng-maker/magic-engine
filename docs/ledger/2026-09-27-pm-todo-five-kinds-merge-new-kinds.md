---
id: 2026-09-27-pm-todo-five-kinds-merge-new-kinds
title: 接手 PR #2065 解冲突：主干新增的 4 种待办类型分进五类车道表
status: done
owner: agent
decided_on: 2026-09-27
source: session:9032e329
verify_by: 2026-09-29
verify_how: 上线后第一个工作日，若下列任一待办触发，确认它落在指定车道（连同母卡 2026-09-26-pm-todo-five-kinds 一起验）：deploy_not_live 出现在「系统进不去、要你点一次」栏、magic_bridge_quota 与 meta_data_deletion_failure 出现在「要你拍板」栏、deploy_check_failed 不进 PM 邮件正文（只进后台开发欠账 + 顶部盲点提示）。合并前已由穷举类型检查 + pm-todo 494 条测试 + 子牙复审坐实
done_on: 2026-09-27
done_ref: pr:2065
last_checked: 2026-10-11
---
原作者窗口（hopeful-williamson）归档后转手接手，把 PR #2065 的 CONFLICTING 解掉。

冲突只有一个文件 src/lib/pm-todo/daily-todo.ts：主干在 PR 基线（dd3dc7ff）之后新增了 4 种 ManualItemKind
（deploy_not_live / deploy_check_failed / meta_data_deletion_failure / magic_bridge_quota），落在被本 PR 删掉的
旧名单 INFORMATIONAL_KINDS / DEV_OWNED_KINDS 里。按「保留双方意图」删掉旧名单（本 PR 的机制）、把 4 种类型改分进
src/lib/pm-todo/five-kinds.ts 的穷举车道表 LANE_OF_KIND：

- deploy_not_live → one_click（上线卡住要人接一下；主干明确要它 PM 可见、不埋开发欠账，进了 NEVER_DROP_KINDS）
- deploy_check_failed → dev（+ BLIND_SPOT_NOTE；检查自己没跑成 = 开发欠账，how 写「回我一句我去修」）
- meta_data_deletion_failure → decide（法定删除义务没兑现，对外 / 合规敞口）
- magic_bridge_quota → decide（加不加免费额度、由 PM 定，花钱）

子牙（架构复审）：4 个车道判定全同意，无需改动。manual-items.ts / manual-item-types.ts 自动合入，
三个新来源函数（deploy-health / data-deletion / magic-bridge）接线完好。合并提交 a883b2f7。

验证：类型检查零新增错误（穷举表完整）；pm-todo 494 条全过；完整验证范围仅既有 33 条失败
（attribution / registry，已在 origin/main 同环境坐实同样 33 条）；9-25 夹具当场试跑 166 → 25 复现；
内核架构检查 181/181（CI PASS）。风险级别 A（改到周报生产定时任务路由），由 PM 亲口回「合」+ --admin 合并。
