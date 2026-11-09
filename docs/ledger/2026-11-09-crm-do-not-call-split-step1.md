---
id: 2026-11-09-crm-do-not-call-split-step1
title: 「只别打电话」和「别再联系」分开——第 1 刀：纯判断函数 + 存量只读名单（不接任何线上逻辑，不改任何客人）
status: decided
owner: agent
decided_on: 2026-11-09
source: session:96dc6edf
verify_by: 2026-11-16
verify_how: 看 PR 已合并且 src/lib/crm/refusal-scope.ts 的测试全绿；用 scripts/crm-refusal-scope-dryrun.ts 对 CTS 存量「别再联系」备注重跑，phone_only 名单与 PR 里给 PM 看的名单一致（Minnie Lillian Kake、gerowlands 在内；Stacey McConnochie 的别再联系 10-16 已被人工纠正过，不在待改名单里）。线上 classifyNote 行为应与合并前完全一致（note-parser 测试 93 条仍绿）。
---
PM 11-09 在 76 号窗口定：客人说「不要打电话」不等于「不要联系」，短信/邮件/WhatsApp 照样可以联系；设计稿 docs/specs/2026-11-09-crm-do-not-call-split-design-v0.md（子牙 APPROVE WITH CHANGES、魏征两轮 BLOCK 后 v1）。
PR 3692 含三刀：第 1 刀纯判断函数；2A 只读一侧（拨号拦截、分段、页面小标+撤销条）；2B 写入一侧（白名单词表、AI 合并修正、自动解除保留电话限制）。PM 11-09 回「合 3692」。测试 350 个文件 6975 条通过，每条新规则做过故意破坏。
存量试跑：「不要电话」类被改成只别打电话的有 Minnie Lillian Kake、gerowlands（Stacey McConnochie 10-16 已被人工纠正；John Oxley 后来发过 Unsubscribe 仍全拦）；改存量是第 4 刀，PM 看名单说「改」才动。
上线后留意：有些说法比旧代码拦得更严，被拦的人要员工「放回名单」；自动解除真写（CRM_DNC_REENGAGE_WRITE_CLIENTS）打开前要确认带「补写只别打电话」；AI 电话接上线前必须接 isDoNotCall。
未做：私信客户卡片的拨号链接（拿不到客人档案标记）；第 4 刀改存量；Mailchimp 与短信渠道无需改动。
