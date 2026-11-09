---
id: 2026-11-02-crm-email-cap-dedupe-merges-two-mails-within-two-minutes
title: 7 天上限的去重规则有一处小缺口：库里有、公司邮箱「已发送」里已查不到的信，若和另一封信相隔不到 2 分钟，会被当成同一封，计数少 1；很少见，排在后面（P3），不挡放开
status: decided
owner: agent
decided_on: 2026-11-02
source: session:9562a9b6
verify_how: 修好后：①单元测试复现「库内邮件记录（没有主题）与另一封已发送邮件相隔 16 秒、编号不同」应计 2 封而不是 1 封；②对 2026-11-02 真测里少数 1 封的那类客人重跑预览，计数应与库里邮件镜像一致；这是发信关口的改动，A 级，要 PM 回「合」
---
真测里 27 位客人中有 2 位少数 1 封（4 对 5，都已远超上限，结果仍是拦住）。原因在 src/lib/crm/email-templates/gates/frequency.ts 的 sameMessage：库内邮件记录（touchpoint）没有主题，只要和同地址的另一封信相隔不到 120 秒就判成同一封；若那封信已不在公司邮箱「已发送」里（被删或移走），就被并掉。
影响：只有客人已收 N-1 封、且有这样一对近距离的信时才会多放行一封；需要「删过已发送邮件，加上两分钟内另有一封」，很少见。
按 §11：频率 低 / IMPACT 中 / 收入 低 → P3，不挡放开，等 PM 排期。做法建议：touchpoint 只在编号相同或属于同一条审计记录时才并入，不再按时间近邻并入（偏安全方向：个别重复记录会多计 1 封）。
证据：docs/ledger/evidence/2026-11-02-crm-email-cap-live-check--2026-11-02.md。
