---
id: 2026-10-15-ads-agent-capability-gap-upgrade
title: 广告 Agent 八个动作只有五个能执行；换素材已落地，挪预算卡在设计稿明文
status: decided
owner: pm
decided_on: 2026-10-15
verify_by: 2026-10-22
verify_how: "grep src/lib/capabilities/ads/deferred-to-human.ts 还剩哪几个动作在占位（应只剩 add_retargeting_adset）；swap_creative 应有独立实现文件并被 capabilities/index.ts 真实接上（grep 调用点），PR 过子牙+魏征两审且由 PM 本人点头合并；budget_move_plan 看 PM 回「改声明」还是「保持人工」"
source: session:90a50c3b
---
事实：`registry-ads.ts` 注册 8 个广告动作，5 个真能执行（停广告组/停系列/减组预算/减系列预算/加组预算），3 个不能。能刹车，不能换方向。
§11 打分：换素材 频率高/IMPACT 高/收入中 → P0；挪预算 频率中/IMPACT 高/收入高 → P0；新建再营销 频率低/IMPACT 高/收入中 → P2 暂不做。
换素材已落地（PR #2695，草稿，A 级待 PM）：只换成素材池已批准、账户里已存在、同主页的素材，不自己建 creative。
**更正（117 号查出、我已核实）**：挪预算不是「没做完的空壳」，是设计稿明文决定不进 Kernel（`docs/specs/2026-09-25-ads-impact-wp3-design-v1.md:419`），动作声明的输入里根本装不下两条腿（`additionalProperties: false`）。要自动化得先改 A 级声明并把闸门从一次审一笔改成逐腿各审一次 → 等 PM 拍板，没有他的字不动。
行业剧本 5 本每本只有 3 个字段，全是叫法用词，阈值与权重仍所有行业共用一套 → 分层判 P2，记入待认领。
未做：没有动任何广告账户、没有改 registry 声明、没有碰行业剧本。
