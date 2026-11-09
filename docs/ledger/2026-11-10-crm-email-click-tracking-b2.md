---
id: 2026-11-10-crm-email-click-tracking-b2
title: CRM 员工发出的信里，指向 CTS 官网的链接加一小段编号；客人一点，往来记录和「最近发送」表就能看到他点了手册还是哪个团（刀 B2）
status: decided
owner: agent
decided_on: 2026-11-10
source: session:9562a9b6
verify_by: 2026-11-24
verify_how: 全部上线且 PM 回「开追踪」后，只在测试邮箱 hello@ 上验：①发一封④目录信，链接带 ?me=，点开是手册 PDF、地址栏编号自动去掉；②十分钟后往来记录和「最近发送」出现「点了 2027 手册」；③用 HEAD 请求同一链接，被标成疑似自动检查、不显示为客人点击；④Inngest 收到一次 crm.email_link.clicked。四条都对才算成。
---
设计稿 docs/specs/2026-11-10-crm-email-click-tracking-b2-design-v0.md（子牙、魏征已审，v0.1）。PM 11-10 回「开始 B2」「开始写」。
分四步上线：第 0 步只让发信设置认识 link_tracking（不改任何行为）；第 1 步 ME 发信打编号 + 收点击接口 + 两张新表（Ray 亲手合）；第 2 步 CTS 官网中间层回传（chinatravel 仓库）；第 3 步 PM 回「开追踪」才在设置里打开。
待 PM 定：CTS 官网隐私政策要不要加一句「邮件链接会记录点击」。回滚：先存一版不带 link_tracking 的设置，再回退代码。
