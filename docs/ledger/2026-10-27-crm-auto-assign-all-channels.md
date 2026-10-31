---
id: 2026-10-27-crm-auto-assign-all-channels
title: 邮件、官网表单、WhatsApp 新来的客人也自动分给跟进人（此前只有 Meta 表单会分）
status: done
owner: agent
decided_on: 2026-10-27
source: session:aedf9b5a
verify_by: 2026-11-03
done_on: 2026-10-27
done_ref: pr:3251
verify_how: 合并部署后，等邮件、官网表单、WhatsApp 各进来至少一位新客人（可以隔几天累计），查库：select c.assigned_to, t.channel, c.first_seen_at from contacts c join contact_touchpoints t on t.contact_id=c.id where c.client_id=CTS and c.first_seen_at > 部署时间，新建的人 assigned_to 不为空（当前名单只有 Lisa，所以都应是她）；命中的老客人 assigned_to 不被改；手工录入和外呼建的人仍是空。每个渠道至少 1 条样本才算验过，没有样本就写「没样本」不要判成。
---
自查发现 1213 位客人只有 1 位有跟进人，邮件 / 官网表单 / WhatsApp 新客人全是未分配。分配放进中心的 resolveContact，各渠道只多传一个开关；只对新建生效、只补空、永不抛错。
没做：历史上 1200 多位客人的回填（写生产数据，需 PM 授权）；Messenger 新客人（PM 没点名）；邮件里推销 / 机器人发件人也会被分到（有效咨询过滤是另一层）。
