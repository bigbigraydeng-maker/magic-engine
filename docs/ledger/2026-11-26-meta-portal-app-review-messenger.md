---
id: 2026-11-26-meta-portal-app-review-messenger
title: 新版 ME 回私信要过 Meta 审核——PM 11-25 回「提审」，测试调用 11-26 已做，等计数后录屏、交 PM 看材料再提交
status: decided
owner: claude
decided_on: 2026-11-25
source: session:8e47c9bf
verify_by: 2026-11-27
verify_how: 用 Meta 开发者工具查「Magic Engine Portal」应用 pages_messaging 与 pages_manage_metadata 两项的测试调用数——都≥1 算成，可以把两项加进审核草稿、开始录屏；仍是 0 算不成，第一步在图谱 API 探索工具里用该应用再调一次 /{测试主页}/conversations 和 /subscribed_apps，再等 24 小时
---
11-25 ReelsMate 广告带来的真客人私信，在新版 ME 里人工回复和 AI 回复都被 Meta 退回（错误码 10）。原因：新版 ME 用的「Magic Engine Portal」应用只有回私信的标准权限，只能回给应用上有角色的人。主页订阅回调地址是 portal.magicengine.com.au，据此确认是这个应用。这条客人当天已在 Meta 后台手动回复。
PM 回「提审」后做了这些：审核材料写在 docs/specs/2026-11-26-meta-portal-app-review-messenger.md，只申请回私信需要的三项权限。pages_show_list 已加进审核草稿（未提交）。PM 回「授权」后，11-26 早上在图谱 API 探索工具里用该应用做了三次只读调用，都成功：读主页列表、读测试主页订阅、读测试主页会话。这三次调用都不发消息。ME 平时的正常调用不算测试调用：11-25 04:52 成功回过一条，24 小时后计数仍是 0。
还差两步：一是录约 2 分钟的演示视频，要 PM 用个人号给主页发一条消息；二是把材料给 PM 看，PM 回「交」后才提交。联系邮箱未验证，目前不挡提交。
