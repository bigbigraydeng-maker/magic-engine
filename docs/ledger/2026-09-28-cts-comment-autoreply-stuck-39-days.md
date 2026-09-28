---
id: 2026-09-28-cts-comment-autoreply-stuck-39-days
title: CTS Facebook 评论自动回复从 8/20 起断更 39 天——Meta 钥匙健康检查只测钥匙死没死、测不出缺权限；已加检测通道 + 补权限清单，根治（重新走 Meta 授权、补回 7 条评论）待人工
status: decided
owner: agent
decided_on: 2026-09-28
source: session:dcc2476b
verify_by: 2026-10-05
verify_how: 查 social_comment_engagements 里 CTS 的 stuck（reply_status=failed 且 attempts>=3）行数是否还在涨；查 CTS 名下有没有出现「评论自动回复卡死」这条待办；查这个客户的 Facebook Page 令牌当前有没有 pages_manage_engagement 权限
---
CTS Facebook 评论公开回复 8/20 起断更 39 天、7 条卡死——Meta 钥匙健康检查只测钥匙死没死，测不出缺 `pages_manage_engagement` 权限这类失效，权限清单本身也没列这一项。
[PR #2190](https://github.com/bigbigraydeng-maker/magic-engine/pull/2190) 加了检测通道（认"连续失败到放弃"症状，不猜根因）+ 补上权限清单缺口。
还没做（需要人）：① 有 CTS 这个 Page 管理权限的人重新走一次 Meta 授权，带上这个权限；② 手动去 Facebook 主页回复那 7 条已经卡死的评论。
