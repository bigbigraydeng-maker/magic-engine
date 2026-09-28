---
id: 2026-09-28-wp3-1b-pr-a-opened
title: WP3.1b 重做 PR A 已开出并合并（#2162 → main commit 0c05c6b5），旧的 #2087 已关闭并留话取代
status: verified
owner: agent
decided_on: 2026-09-28
done_on: 2026-09-28
done_ref: pr:2162
verified_ref: commit:0c05c6b5
last_checked: 2026-09-29
check_note: 亲自查过——0c05c6b5 已在 origin/main 里（git merge-base --is-ancestor 确认），旧 PR #2087 已关闭。
source: session:d9b147f8
verify_by: 2026-10-05
verify_how: 这张卡自己定的验收标准已经全部满足：子牙+魏征两位都过了（子牙审出一个真漏洞——币种校验漏了，已当场修复、补测试、重新过审）；PM 本人在对话里原话说"合"；统筹执行合并，落到主干 commit 0c05c6b5。真正要长期盯的不是这张卡，是止损绕过熔断器那个洞（另一张卡），那个洞现在因为这次合并变成了生产上真实存在的状态，不是理论风险。
---
广告自治熔断器 + 账户级日预算上限那批改动收尾，开成草稿 PR：[#2162](https://github.com/bigbigraydeng-maker/magic-engine/pull/2162)。

范围：熔断五条判据、按账户/客户两级派生态查询、人工解除熔断接口、人工止损信封、两层"人工触发身份"防伪造围栏、resolver 挂进生产 Kernel 三件套、账户级日预算上限（含 PATCH 路由）、WP2 两处遗留缺陷修复、今日待办展示。**不含**止损真正接线（还在直调 Meta，没走 Kernel）和前端契约修——这两块统筹拍板挪进下一个 PR（PR C），台账另开一张卡记这个洞。

旧的 PR #2087（照错的设计稿实施）已留话说明被取代、已关闭，分支按 Git 红线不删。

2026-09-28 补充两件事：① 分支已跟主干同步（`git merge origin/main`，冲突只在 `pm-todo` 两个文件，纯并列保留，`boundaries.ts` 等核心文件零冲突；合并后补了 `five-kinds.ts` 一行分类映射）；② 小秘书要的 DR87/W87 十一条对账表已全部补进 PR 正文（原来只有 DR87-2 一条，其余十条小秘书从自己压缩前的记录里找到发我了）。

2026-09-29 收尾：PR #2162 已合并进主干，commit `0c05c6b5`。**止损绕过熔断器那个洞没有跟着解决**——统筹原话"别当已解决"，处理方式不变：并入 PR C，跟另外三条旁路收编（`meta-ads/execute` / `boost-post` / `winner-reel-sync`）一起做。详见另一张卡
[docs/ledger/2026-09-28-stop-loss-bypasses-circuit-breaker-until-pr-c.md](./2026-09-28-stop-loss-bypasses-circuit-breaker-until-pr-c.md)。
