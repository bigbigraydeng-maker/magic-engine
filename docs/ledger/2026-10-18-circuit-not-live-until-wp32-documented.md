---
id: 2026-10-18-circuit-not-live-until-wp32-documented
title: 把「WP3.2 做完前熔断等于不存在」写进 ROADMAP 和代码注释，免得下个窗口以为这道防线在工作
status: done
owner: agent
decided_on: 2026-10-18
source: session:c668eb35
done_on: 2026-10-18
done_ref: doc:docs/specs/2026-10-18-ads-agent-whole-design-and-code-gaps-v0.1.md
verify_by: 2026-10-25
verify_how: 读 docs/ROADMAP.md「WP3.2 链条」那条下面有没有那行红字、src/lib/capabilities/ads/envelope-facts.ts 熔断检查处有没有同义注释；再查生产库 ads_circuit_events 是否仍 0 行（是则这两处说明仍成立，不要删）
---
只改文档与注释，不动任何逻辑。
起因：10-18 查实今天没有任何熔断保护（五条判据零调用方、ads_circuit_events 0 行、执行前闸恒放行、PM 待办恒空），
而写 trip 的人是韩信 step 1（设计稿 2026-09-25-ads-impact-wp3-design-v1.md §2.2 第 1 行），属 WP3.2 未开工。
ROADMAP 原来只写了 WP3.2 的范围，没写「在那之前熔断不生效」——读 envelope-facts.ts 的人会以为防线在工作。
整体方案与 WP3.2 工作量估算见 done_ref 那份设计稿（§2.2、§6.5）。
