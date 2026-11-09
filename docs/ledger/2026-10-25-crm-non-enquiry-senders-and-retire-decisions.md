---
id: 2026-10-25-crm-non-enquiry-senders-and-retire-decisions
title: CRM 两件 P0：群发营销来信不再出现在「今天要联系」（挪到「先放着」并写明原因，不删不藏），今日决策清单页退役并入「Magic Engine 智能」（PM 回「修」；判据经子牙+魏征两轮复审后大幅收紧）
status: done
owner: pm
decided_on: 2026-10-25
source: session:96dc6edf
done_on: 2026-10-26
done_ref: commit:175e9f40d79c73bc706180e7f25febad9f22b294
verify_by: 2026-11-08
verify_how: 合并部署后，①打开 CTS 的「全部客人 → ✨ Magic Engine 智能 → 今天要联系」，Vietnam Tours Direct(anzacvn@221832422.mailchimpapp.com) 和 Afterpay Team(hello@info.e.afterpay.com) 不应再出现；②展开「先放着」能找到这两个，原因写着「看着不是客人来咨询（群发…）」，抽屉、历史、联系方式都在，抽屉里仍可点「回了他」类按钮（= 没有凭空消失、没有变成死胡同）；③ZORAVYO、Twilio 通知、grokbot、chajense 这 4 个**仍会出现**（判据刻意不管它们，靠人点一次抽屉里的「不是有效咨询（退回）」永久清掉）；④访问 /dashboard/clients/<CTS>/crm/decisions 应自动跳到 /crm/all?view=smart，导航条不再有「决策清单（只读）」；⑤本地 `npx vitest run src/lib/crm src/app/dashboard/clients` 全绿
---
起因：PM 2026-10-25 让我站在用户视角体验 CRM。逐页实测发现「今天要联系」第一屏就混着推销和机器来信，而 PM 10-21 要的「只留有效咨询」筛选器虽已合并，却因为「开关先关、机器不自动移人」从未生效；按 §11 打分（频率高/IMPACT 高/收入高）判 P0，PM 回「修」。
做法一（垃圾不进名单）：新增**纯确定性**的发件人形状判据，命中就从「今天要联系」挪到「先放着」并写明原因。三条边界：只碰「进线了还没人联系」这一段、真人推进过阶段就永不再降、保留原本的建议渠道（否则误判的人抽屉里连「回了他」都点不了）。
做法二（退役最慢的页）：「今日决策清单」与「Magic Engine 智能」给的是同一批人同一套建议，但它实测 8.3 秒（`/crm/today` 接口 6.9 秒）且按「等了多久」排序，等 127 天的排最前、昨天刚进线的排到第 300 多位。改成跳转到 `/crm/all?view=smart`，导航移除入口；顺带让智能视图可用网址直达。
子牙 + 魏征两审把第一版判据否了：他们各自实跑出真实误杀（中国高校 `mail.` 前缀 / `co.nz` 两段公共后缀 / 自有品牌邮箱 / 同行 `partnerships@` / 大厂企业客户），判据因此砍到只剩三条高确信规则，自动挡掉的从 7 个降到 2 个，其余靠人点一次既有的「不是有效咨询（退回）」。
当场试跑（CTS 1210 人真实数据，只读）：今天要联系 372 → 370，挪走的 2 个都是群发营销；6 处关键判断做了变异测试全部被测试判红。遗留：判据三张表仍是源码常量，下一轮若放宽必须先下沉成客户/行业配置并加开关。
