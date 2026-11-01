---
id: 2026-11-02-me-send-gate-p2-cts-sales-mailbox-info-only
title: PM 确认 CTS 销售发客人邮件只用 info@ 一个邮箱（ME 里 bdm@ 的连接已断开，不在必须可读清单里）
status: done
owner: agent
decided_on: 2026-11-02
source: session:33ebcd0b
verify_by: 2026-11-09
verify_how: 看第二步设计稿 docs/specs/2026-11-02-me-send-gate-p2-design-v0.md 的 §3.1（规则快照的必须可读邮箱清单）与 §5.2 F 步是否写明清单 = info@、清单内任一邮箱连接不是 active 就整批拦、清单外断开的邮箱忽略；以后若销售开始用别的邮箱，必须先重新连接并重新授权
done_on: 2026-11-02
done_ref: doc:docs/specs/2026-11-02-me-send-gate-p2-design-v0.md
---
PM 2026-11-02 在 33ebcd0b 窗口回「只用info」。生产只读核对：CTS 的 Microsoft 邮箱连接 1 个 active（info@）、1 个 revoked（bdm@）。
这是审查员（魏征）问的「销售用哪些邮箱发信」的答案：ME 只能看见已连接邮箱里发出的信，所以清单必须准确。
