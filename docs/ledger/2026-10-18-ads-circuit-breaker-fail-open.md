---
id: 2026-10-18-ads-circuit-breaker-fail-open
title: 广告熔断今天完全不生效（表 0 行、执行前闸恒放行、PM 待办恒空）——写 trip 的韩信属 WP3.2 未开工，不是坏闸
status: decided
owner: pm
decided_on: 2026-10-18
source: session:c668eb35
verify_by: 2026-10-25
verify_how: 看 PM 是否决定开 WP3.2。开完后验：人为造一次超上限 → ads_circuit_events 出现 kind='trip' 行 → 执行前闸拦住 → PM 待办出现一条。今天查的基线：该表 0 行
---
更正我自己早先说的「熔断闸是坏的」：写 trip 的是韩信 step 1（设计稿 2026-09-25-ads-impact-wp3-design-v1.md §2.2 第 1 行），属 WP3.2 未开工，是分刀交付不是缺陷。
但今天实情是没有任何熔断保护：五条判据零调用方、执行前闸恒放行、pm-todo/ads-circuit-items.ts 恒为空。
同根还有两处：通用审批页批准后无人执行（Kernel WP07）、Check/Tune 未接（WP3.3）——都等编排层。
整体方案与 WP3.2 工作量估算：docs/specs/2026-10-18-ads-agent-whole-design-and-code-gaps-v0.1.md §2.2、§6.5。
