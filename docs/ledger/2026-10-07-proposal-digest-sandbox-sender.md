---
id: 2026-10-07-proposal-digest-sandbox-sender
title: 「方案被打开」通知邮件一直发不出去：发信人用了邮件服务的沙盒地址
status: decided
owner: agent
decided_on: 2026-10-07
source: session:d925e4da
verify_by: 2026-10-14
verify_how: 合并后下一次有访客的日子，cron_run_logs 里 proposal-view-digest 应记成功、hello@magicengine.cloud 收到邮件；没访客的日子不发信是正常
---
发信人改用全仓统一的正式发信人（已验证域名 magicengine.cloud），收件人不变。
修复后第一次有访客的日子才能看到真实结果，没访客就等。
