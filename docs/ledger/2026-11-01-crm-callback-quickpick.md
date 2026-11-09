---
id: 2026-11-01-crm-callback-quickpick
title: CRM 记一笔旁边加「约回电」快捷按钮：点一下就把回电时间排上，不再靠 AI 读原话
status: decided
owner: agent
decided_on: 2026-11-01
source: session:96dc6edf
verify_by: 2026-11-10
verify_how: 看 11-02 之后员工在抽屉里点「约回电」存下的触点：metadata.callback_at 都有值且 outcome=callback_set；到点那天这些人出现在今天要联系的 callback_due 里；员工没反映「约了没提醒」
---
背景：以前员工要在笔记里打「约了明天下午 2 点回电」，靠 AI 抽出时间，抽不出来就静悄悄没排上。
做法：抽屉记一笔旁加 明天上午10点 / 明天下午2点 / 下周一上午10点 / 自选时间 四个选项，时间由服务端按客户所在地时区算并校验（不能是过去、最多 60 天），写成 callback_set，赢过 AI 读出来的。原话原样保存。
核对现状：约定当天他留在原位（已处理）；第二天约定时间之前在「先放着」；到点回到今天要联系最上面（callback_due）。
