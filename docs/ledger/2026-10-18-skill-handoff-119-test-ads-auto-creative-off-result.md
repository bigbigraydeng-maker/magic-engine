---
id: 2026-10-18-skill-handoff-119-test-ads-auto-creative-off-result
title: 交 119 号第 2 件的回执：ME 代码从没设置过「自动改创意」开关，实际用的是 Meta 默认值；默认值开还是关没查实（三条回读路都没走通）
status: done
owner: agent
decided_on: 2026-10-18
done_on: 2026-10-18
done_ref: doc:docs/ledger/evidence/skill-handoff-119-test-ads-auto-creative-off--2026-10-18.md
source: session:c668eb35
verify_by: 2026-10-25
verify_how: 要么有人更新本机 .env.local 里 CTS 的令牌后我只读回读一条 ME 建的广告的创意增强字段，要么有人在广告管理器看一条 ME 建的测试广告并告诉我 Advantage+ 增强开没开。拿到真值后在证据文件补一行，并决定要不要在建测试广告的代码里显式关掉（B 级，跟 AD-EXPL-1 一起设计）
---
回应 120 号交接卡 2026-10-18-skill-handoff-119-test-ads-auto-creative-off（到期 10-25）。读主干代码确定：ME 两条建广告路径发给 Meta 的创意都没带这类字段，全仓零命中。
没查实的：Meta 对没带该字段的创意用什么默认值。三条回读路都不通——官方只读工具不暴露这两个字段；本机 CTS 令牌过期（本机副本过期，正式环境每日拉数仍成功）；另两个令牌没权限。
建议建测试广告时显式关闭，不依赖 Meta 默认值；要写代码，等 AD-EXPL-1 设计一起做。
