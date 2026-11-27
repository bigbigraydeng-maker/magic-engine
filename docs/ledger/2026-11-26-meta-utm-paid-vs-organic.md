---
id: 2026-11-26-meta-utm-paid-vs-organic
title: 官网表单只有写明付费信号才记成 Facebook 广告线索，自然帖不再被当成广告
status: decided
owner: agent
decided_on: 2026-11-26
source: doc:docs/handoffs/2026-11-01-social-agent-handover-97.md
verify_by: 2026-12-03
verify_how: 下一条带来源 facebook、媒介为 organic 或没写媒介的官网表单，联系人来源显示社媒（非广告），不进广告名单导出；媒介为 paid 或 paid_social 的仍记成广告。不改历史数据。
---
自然帖链接也用 utm_source=facebook。旧判断看见这个来源就记成付费，网站一开始把来源传进表单通知，自然线索就会被当成广告线索。
现在付费只认：付费媒介、广告编号、点击编号加广告编号、或即时表单。没有这些信号记成自然社媒。
广告名单「来自广告才算同意」这句没改。自然社媒因为不再被存成广告来源，所以不会新进这份名单。已入库的旧记录不回填。
即时表单仍算广告来源，即使平台另标了自然。这句要人确认。
