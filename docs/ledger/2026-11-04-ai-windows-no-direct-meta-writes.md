---
id: 2026-11-04-ai-windows-no-direct-meta-writes
title: AI 窗口不许直接用 Meta 广告工具改预算、开关广告，一律走 ME（本机已禁用两个写入工具，CLAUDE.md 加规则）
status: done
owner: agent
decided_on: 2026-11-04
source: session:f765a75f
verify_by: 2026-11-18
verify_how: 读 CTS / NAL 广告账户 11-04 之后的活动日志（只读），预算和开关改动里来源为 "ads MCP server" 的应为 0；若有，查是哪个窗口、用的什么入口
done_on: 2026-11-04
done_ref: pr:3604
---
PM 11-04 回「同意」。起因：Meta 活动日志显示 CTS 组 A 10-30~11-01 被 AI 窗口经 Meta 工具加了三次预算（$50→$60→$72→$100，最后一次 +39%），绕过 ME 的 20% 上限、72 小时冷却、加钱只认 PM 本人。
机器闸：~/.claude/settings.json permissions.deny 加 ads_update_entity、ads_activate_entity，已实测被系统拒绝。文字规则给 Codex 等窗口。PM 本人手机改不受限。
