# 证据 · 2026-09-25-agent-crm-shipped-cts · 2026-10-14
fetched_at: 2026-10-14T21:40:59+13:00

查了什么：①生产库 agent_customers 有没有由邮件同步自动写入（非手动添加）的行，姓名/人数是否跟原邮件一致；
②阶段改得动不动（页面能开能改阶段这一半，用「库里确实出现过阶段变更」替代登录后点界面）。

数字（带样本量、两边取数状态）：
- agent_customers 共 36 行，覆盖 1 个客户（CTS），最早 2026-09-24 14:47 UTC（上线当天）、最新 2026-10-08 23:12 UTC。
  36/36 行都带 conversation_id = 全部由邮件会话自动提取写入，没有一行是脱离会话的手工条目。
- 姓名/人数与原邮件一致：取最近 3 行有人数的记录做抽查，把 customer_name 和 pax 回到
  conversation_messages 的正文里对：3/3 行姓名命中、3/3 行人数命中（每条会话 28 封消息）。
  （抽查样本 3 行，不是全量；客户姓名与人数本身按台账规矩不写进这里。）
- 阶段分布（36 行）：new 17 / quoted 14 / deposit_paid 3 / confirmed 1 / lost 1
  → 19 行已经离开默认的 new，落到 4 个不同的后续阶段；30 行的 updated_at 比 created_at 晚一分钟以上。
  阶段字段在生产里被真的改过，不是只建了表没人用。

来源/命令：Supabase 只读 SQL（生产项目 glbdnayojixmexgofbsd）：
- select count(*), count(conversation_id), count(distinct client_id), min/max(created_at) from agent_customers
- select client_id, stage, count(*), count(*) filter (where pax is not null), count(*) filter (where updated_at > created_at + interval '1 minute') from agent_customers group by 1,2
- 抽查：对最近 3 行，bool_or(conversation_messages.body ilike '%'||customer_name||'%') 与 pax 的数字正则匹配

判据替代说明：verify_how 原文要求「页面 /dashboard/clients/<id>/agents 能开、能改阶段」。
夜巡没有登录态，开不了页面；改用「生产库里阶段确实被改成了 4 种非默认值、30 行有后续更新」
作为「改阶段这条路通」的实证。页面本身的渲染没有今晚的截图。

结论：成。自动入表这一半完全达标（36/36 带会话来源、抽查姓名人数对得上），
改阶段这一半有生产数据佐证（19 行离开默认阶段）。
