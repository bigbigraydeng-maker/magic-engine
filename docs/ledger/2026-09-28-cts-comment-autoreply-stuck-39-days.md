---
id: 2026-09-28-cts-comment-autoreply-stuck-39-days
title: CTS Facebook 评论自动回复从 8/20 起断更 39 天——Meta 钥匙健康检查只测钥匙死没死、测不出缺权限；已加检测通道 + 补权限清单，根治（重新走 Meta 授权、补回 7 条评论）待人工
status: decided
owner: agent
decided_on: 2026-09-28
source: session:dcc2476b
verify_by: 2026-10-05
verify_how: 查 social_comment_engagements 里 CTS 的 stuck（reply_status=failed 且 attempts>=3）行数是否还在涨；查 CTS 名下有没有出现「评论自动回复卡死」这条待办，出现后要不要跟进重新走 Meta 授权；查这个客户的 Facebook Page 令牌当前有没有 pages_manage_engagement 权限
---
PM 顺口一提"CTS Facebook 评论好像没人回了"，查库确认：CTS 的评论公开回复从 2026-08-20 起断更，到发现当天正好 39 天，期间 7 条该回的评论（夸奖/提问类）连续失败 3 次后被系统放弃、不会再重试，报错全部指向 `pages_manage_engagement` 权限，不像限流（限流不会连续几十天 100% 失败）。

现成的"Meta 钥匙健康检查"（`meta-token-health-items.ts`，本身是为 CTS 令牌连死三次专门建的，见同一份文件里的历史注释）只探测"钥匙整个作废了没"（Meta 错误码 190），故意不查具体权限范围，钥匙还活着但缺这一项权限时照样判"活着"，所以没有任何告警。更巧的是，同一份代码里"钥匙坏了怎么修"的操作指南，生成新令牌要勾的权限清单里本身就没有 `pages_manage_engagement`——照着现有指南修一遍，新令牌大概率还是没有这个权限，问题会复发。

按 CLAUDE.md §11：频率——不低（8/23 到 9/21 持续在发生，断更 39 天至今）；IMPACT 闭环关键度——高（这是"社媒"支柱真正接了飞轮的执行动作，不是只诊断的口碑/竞品，`flywheel_actions` 表里 `flywheel='social'` 直接受影响）；收入关联度——高（客户官方主页上，粉丝/潜客提问没人回，直接影响客户对 ME 的观感）。零个低、两个以上高 → **P0**。

**这个 PR 里做了什么**（[PR #2190](https://github.com/bigbigraydeng-maker/magic-engine/pull/2190)）：
1. 新增 `comment-autoreply-stuck-items.ts`：pm-todo 检测通道，查 `social_comment_engagements` 里 `reply_status='failed' && attempts >= MAX_ATTEMPTS` 的行，按客户汇总成一条待办。不猜根因，只认"该回复的评论连续 `MAX_ATTEMPTS` 次都没发出去"这一个直接症状，以后就算失败原因变了这条待办也不会失效。
2. `meta-token-health-items.ts` 两处"生成新令牌要勾的权限"清单都补上 `pages_manage_engagement`，避免下次修令牌重复丢失这项权限。
3. 接进现有的待办类型系统和五类车道穷举表（归 `one_click`，跟同类的 `facebook_sync_failing` 一致）。

**当场验证**（read-only，против production）：直接跑了新检测通道用的那条 SQL（`select client_id, count(*), min(comment_created_at) from social_comment_engagements where reply_status='failed' and attempts>=3 group by client_id`），生产库返回唯一一行——CTS，7 条，最早一条 2026-08-23——跟新函数的分组/计数逻辑完全对得上；真正接进每日待办邮件的那次运行要等下一次自动生成周期，到时候查 CTS 名下有没有真的出现这条待办。

**为什么没有在这个 PR 里现在就做根治**：
- 重新给 CTS 的 Facebook Page 走一遍 Meta 授权（把 `pages_manage_engagement` 勾上）需要有这个 Page 管理权限的人去操作 Meta 自己的网站，agent 做不了。
- 已经卡死的 7 条评论不会被系统自动补发（`MAX_ATTEMPTS` 已耗尽），需要人工登录 CTS 的 Facebook 主页逐条手动回复。

**下一步**（谁来接、接的时候要做什么）：① 有 CTS 这个 Facebook Page 管理权限的人（PM 或对应 FDE）登录 `https://developers.facebook.com/tools/explorer/` 重新生成令牌，这次要勾上 `pages_manage_engagement`，换好后按今日待办的操作步骤更新到 Render；② 手动去 CTS 的 Facebook 主页把那 7 条卡住的评论回复掉；③ 确认这条 pm-todo 检测在下一次待办生成周期里真的对 CTS 报出来了，报出来后这张卡可以关成 `verified`。
