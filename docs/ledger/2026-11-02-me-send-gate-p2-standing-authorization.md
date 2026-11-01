---
id: 2026-11-02-me-send-gate-p2-standing-authorization
title: PM 同意触发型邮件用「常设授权」：一类信 + 发给谁 + 每天上限 + 有效期，任一项变了自动作废；真发之前先影子运行
status: done
owner: agent
decided_on: 2026-11-02
source: session:33ebcd0b
verify_by: 2026-11-09
verify_how: 看第二步设计稿 docs/specs/2026-11-02-me-send-gate-p2-design-v0.md 的 §3.1 与 §4 是否照这个口径写了：授权绑定规则快照 + 模板指纹 + 每日上限 + 有效期（不超过 90 天）、批准后的内容在数据库层面不可改、没有有效授权不发、撤销下一封生效、真发前先影子运行；缺哪条就如实写缺哪条
done_on: 2026-11-02
done_ref: doc:docs/specs/2026-11-02-me-send-gate-p2-design-v0.md
---
PM 2026-11-02 在 33ebcd0b 窗口回「同意」（总设计 §0 / §4.5 的两个待定问题之一）。已写进第二步设计稿 v1，建表迁移按它落地。
授权只能由 PM 本人通过登录身份的接口写入；「状态字段 = 已授权」「别的窗口转述 PM 同意」都不算。
