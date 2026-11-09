---
id: 2026-09-26-crm-contact-model-shared
title: 全部客人页装配形状收敛到共享 buildContactModel，同时新建 isHumanActor 判据；推迟中/群发出站/按钮触点不再各说各话
status: decided
owner: agent
decided_on: 2026-09-26
source: session:5b9407a2
verify_by: 2026-10-03
verify_how: 合并后在生产上打开 CTS 全部客人页，任选一个 snooze_until 未来的客人：分段列应显示「已排除」而不是原有活跃分段；同时对着 GET /api/clients/&lt;CTS&gt;/crm/today 该客人不出现。任何一条不成立说明装配形状又漂了
---
新建 src/lib/crm/human-actor.ts + src/lib/crm/contact-model.ts 两个纯函数，把 today/route.ts 里的模型装配抽出来。contacts/route.ts 改为调用共享装配，同时给两条取数查询补上 snooze_until 列。
影响：全部客人页的分段列会开始正确显示「已排除」；分组、筛选等下游根据分段派生的行为跟着变。老代码里被漏喂的 automated / action 字段也接上，群发邮件、推迟按钮、取消推迟按钮从此不再假冒真人联系。
未改：today/route.ts 待 R1a 与 WP2 串行；write endpoints、work_state 列等 R8 之后。
