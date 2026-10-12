---
id: 2026-09-28-wp3-1b-pr-a-opened
title: WP3.1b 重做 PR A 已开出（#2162），旧的 #2087 已关闭并留话取代
status: done
owner: agent
decided_on: 2026-09-28
done_on: 2026-09-28
done_ref: pr:2162
source: session:d9b147f8
verify_by: 2026-10-05
verify_how: 查 PR #2162 的审查状态：子牙、魏征两位是否都过了。子牙+魏征都过、且 PM 在对话里明确说"合"之后才能合并（本 PR 碰安全/鉴权/数据库结构，A 级，机器不自动合）。合并前重新确认 CI 全绿。跟主干同步这一步已经做完（2026-09-28，统筹拍板用 merge、不用 rebase），不用再单独确认。
last_checked: 2026-10-12
check_note: 夜巡盖章：本晚未取到 verify_how 所需的线上/生产证据，不翻状态，仅盖章
---
广告自治熔断器 + 账户级日预算上限那批改动收尾，开成草稿 PR：[#2162](https://github.com/bigbigraydeng-maker/magic-engine/pull/2162)。

范围：熔断五条判据、按账户/客户两级派生态查询、人工解除熔断接口、人工止损信封、两层"人工触发身份"防伪造围栏、resolver 挂进生产 Kernel 三件套、账户级日预算上限（含 PATCH 路由）、WP2 两处遗留缺陷修复、今日待办展示。**不含**止损真正接线（还在直调 Meta，没走 Kernel）和前端契约修——这两块统筹拍板挪进下一个 PR（PR C），台账另开一张卡记这个洞。

旧的 PR #2087（照错的设计稿实施）已留话说明被取代、已关闭，分支按 Git 红线不删。

2026-09-28 补充两件事：① 分支已跟主干同步（`git merge origin/main`，冲突只在 `pm-todo` 两个文件，纯并列保留，`boundaries.ts` 等核心文件零冲突；合并后补了 `five-kinds.ts` 一行分类映射）；② 小秘书要的 DR87/W87 十一条对账表已全部补进 PR 正文（原来只有 DR87-2 一条，其余十条小秘书从自己压缩前的记录里找到发我了）。
