---
id: 2026-09-27-ads-check-notify-on-meta-approval
title: Meta 批下广告读取权限后，给已经注册、在等 Facebook 连接的自助客户发邮件通知（页面上已承诺「审核一通过我们会发邮件通知你」）；群发前先问 PM
status: decided
owner: agent
decided_on: 2026-09-27
source: session:4bb834a6
verify_by: 2026-10-27
verify_how: 查 Meta 应用的 ads_read 是否已获批；已获批就查通知是否已发（名单 = 验证过邮箱、从 /meta-ads-ai/mine 进来的自助客户，website_lead_events 里 tool_signup 那批），以及群发前是否问过 PM。还没获批就把这张卡往后挪。
---
来源：工具实验室第一步设计审（魏征 SHOULD 4）——体检页和介绍页都写了「开放后发邮件通知你」，但还没有名单和发送功能。同时要打开 META_ADS_AI_PUBLIC_CONNECT 开关。原官网候补名单的人也要收到新入口（同样先问 PM）。
