---
id: 2026-09-28-cts-seo-title-dedup-fix
title: CTS 网站6个页面标题改动+2组"两页打一件事"去重，等网站改动真正合并上线后再走14天自动回看
status: decided
owner: agent
decided_on: 2026-09-28
source: session:065e0f34
verify_how: 三个前置条件缺一个都还是"决定了没做"，不能提前当成done：①改标题的那条PR在chinatravel仓库（不是本仓库，本仓库自己同号的PR是另一件早已合并的事，不能拿来对号），要等它真正合并且网站上线后，才把seo_meta_log这6行的`optimised_at`重置成合并上线当天，14天窗口从那天算，不能沿用这张卡写卡当天的日期；②CTS的`seo_config.meta_cycle_enabled`要是true，每周一`cloud-seo-meta-cycle-fanout`才会扫到这6行——如果到合并上线那天仍是false，需要单独拿到"只回看这6行、不重开候选生成/自动改站整条链路"的授权，不能靠直接打开这个总开关代替；③到了回看时间点看`outcome`字段，不是"不为空即算验过"：只有`improved`才转`verified`；`regressed`要转`failed`并另外判断是否要把这6个标题改回去；`insufficient_data`既不算验过也不算失败，保持`done`等下一轮真实流量样本，不能因为字段有值就清出待办。
---
诊断+方案见本会话记录（孔子/SEO agent，PM 2026-09-28 当场"做"授权）。改标题+去重内链的代码改动
是 chinatravel 仓库（github.com/bigbigraydeng-maker/chinatravel）里的一条 PR，当场核实时那条 PR
还没合并、待人工代码复审——所以这张卡先记成"决定了"，等它真正合并上线，再由处理合并的人把状态
翻成 `done` 并补 `done_on` / `done_ref`（`done_ref` 只能写本仓库能查到的指针，chinatravel 那条
PR 号请写进 `done_ref` 指向的证据文档里，不要直接写 `pr:<号>`——本仓库工具只按 `GITHUB_REPOSITORY`
解析 PR 号，会跟本仓库自己同号的 PR 撞车判重）。

seo_meta_log 里已经插入的 6 条基线行的 `optimised_at` 目前记的是 2026-09-28（写这张卡当天），这个
日期是占位的，不是网站真正改动上线的日期；chinatravel 那条 PR 合并上线后必须有人把这 6 行的
`optimised_at` 改成实际上线日，否则 14 天回看窗口会算错（提前判、或网站改动被关闭/未合并时被误判）。

不用新建 Inngest：ME 已有 `cloud-seo-meta-cycle-fanout`（每周一自动跑，读 `seo_meta_log` 里
`optimised_at` 超14天且 `checked_at` 为空的行，自动对比 GSC 真实数据、写回 `outcome`），前提是该
客户 `seo_config.meta_cycle_enabled=true`；当场没有确认 CTS 这个开关现在是不是 true，合并上线时
需要一并核实，缺了就不会被自动扫到。
