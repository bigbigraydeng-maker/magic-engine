---
id: 2026-10-15-ads-agent-capability-gap-upgrade
title: 广告 Agent 八个动作里三个是空壳，PM 拍板升级；先做换素材与挪预算
status: decided
owner: pm
decided_on: 2026-10-15
verify_by: 2026-10-22
verify_how: "grep src/lib/capabilities/ads/deferred-to-human.ts 还剩哪几个动作在占位；swap_creative 与 budget_move_plan 两条应已有独立实现文件、被 kernel 真实调用（grep 调用点）、PR 过子牙+魏征两审且由 PM 本人点头合并"
source: session:90a50c3b
---
事实：`registry-ads.ts` 注册 8 个广告动作，5 个真能执行（停广告组/停系列/减组预算/减系列预算/加组预算），3 个共用 `deferred-to-human.ts` 永远抛「转人工」：换素材、挪预算、新建再营销广告组。能刹车，不能换方向。
§11 打分：换素材 频率高/IMPACT 高/收入中 → P0；挪预算 频率中/IMPACT 高/收入高 → P0；新建再营销 频率低/IMPACT 高/收入中 → P2 暂不做。
另一件事：行业剧本 5 本（通用/旅游/物流/地产/电商）每本只有 3 个字段，全是叫法用词，阈值与权重仍是所有行业共用一套 → 分层判 P2，记入待认领。
派出：116 号做换素材、117 号做挪预算，均 A 级、派 DeepSeek 写、草稿 PR、两审后要 PM 本人点头才合。
未做：没有动任何广告账户、没有改 registry 声明、没有碰行业剧本。
