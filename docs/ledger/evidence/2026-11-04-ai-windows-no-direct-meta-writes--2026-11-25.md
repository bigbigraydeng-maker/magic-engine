# 证据 · 2026-11-04-ai-windows-no-direct-meta-writes · 2026-11-25
fetched_at: 2026-11-25T03:22:03+13:00
查了什么：Meta activity log (budget category) for CTS main account since 11-04; grep of user settings deny list; gh pr view 3604
数字（带样本量、两边取数状态）：Since 11-04 the only budget change is one ad-set budget update on 11-05 via Power Editor by a human user (not the ads MCP server); 0 MCP-sourced budget/status changes. deny list in settings contains ads_update_entity and ads_activate_entity. PR 3604 merged. NAL and the second CTS account were not read.
来源/命令：见「查了什么」，均为只读查询
结论：成，CTS 主账户 11-04 之后没有 AI 工具改预算的记录，唯一一次改动是人在后台手动改的；两个写入工具仍被禁用。
