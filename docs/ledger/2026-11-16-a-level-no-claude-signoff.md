---
id: 2026-11-16-a-level-no-claude-signoff
title: A 级合并不再等 Claude 签字，库表和广告花费仍由 Ray 亲手合
status: decided
owner: agent
decided_on: 2026-11-16
source: doc:.github/merge-authorization.md
verify_by: 2026-11-22
verify_how: 本修复合进主干后，找一条不碰库表、Meta 凭证、广告花费的 A 级拉取请求：必过检查全绿、审查对话已解决、不是草稿时，Risk gate 为绿并打开自动合并，即使没有签字。另找一条改了迁移或广告花费的请求，确认仍是红的并留给 Ray。必过检查未绿或对话未解决的必须仍是红的。
---
Ray 2026-11-16 定：A 级去掉 Claude 签字，也不再等 Codex。放行只看必过检查、审查对话、不是草稿、不是 fork。
库表或迁移、Meta 凭证、广告系列/预算/出价仍判红，打 needs-ray-merge。改动清单读不到照旧留给 Ray。
p0 标签只作建议，不挡合并。自动审查照常跑，结论不挡。
当场跑不了：这道闸的脚本从主干取出，草稿请求跑的仍是旧规则，合进主干前看不到新判定。
