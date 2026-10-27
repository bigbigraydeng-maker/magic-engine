---
id: 2026-10-27-crm-assignee-worklist
title: 「每天提醒跟进人」第一刀：把 Meta 表单、邮件、WhatsApp 三个检测器并起来、按跟进人切，做成只读接口（不发信）
status: done
owner: pm
decided_on: 2026-10-27
source: session:aedf9b5a
verify_by: 2026-11-03
done_on: 2026-10-27
done_ref: pr:3271
verify_how: 合并部署后，用已登录的 Chrome 打开 /api/clients/<CTS>/crm/followup-worklist?assignee=<Lisa 的登录邮箱>：①errors 为空对象（三个检测器都测成了，不为空要写明哪个渠道没测成）②entries 里邮件、WhatsApp 客人都有，不只 Meta 表单③响应全文搜不到「@」邮箱和 7 位以上连续数字④抽查 5 位：每位在库里最后一句确实是客人说的、之后没有真人回过⑤byAssignee 加起来等于去重后的总人数。把真实名单（姓名 + 来源 + 等了多久）给 PM 看，由 PM 决定刀 2 的信怎么写。没数据的渠道写「没样本」，别当成「没有」。
---
现有每日汇总只看 Meta 表单，Meta 线索停了 16 天它每天说「窗口内 0 条」，邮件 / WhatsApp 新客人一个都不在里面。本刀不重写判据，只把三个现成检测器并起来再按 assigned_to 切；官网表单已被邮件检测器收进来（6/6）。
读 .env.local 被权限规则拒绝，没绕开：真实名单要等接口上线后用已登录浏览器取。
没做：信件格式、收件人读名单、客户开关、干跑发到 ME 自己邮箱（刀 2）；对 Lisa 打开（刀 3，A 级、要 PM 批准）。
