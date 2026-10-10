---
id: 2026-10-08-daily-plan-price-fact-check
title: 每日计划发布前核对帖子里的价格数字：跟客户资料对不上、或没资料可对，一律整批拦下并出待办
status: decided
owner: agent
decided_on: 2026-10-08
source: session:3a3c382a
verify_by: 2026-10-15
verify_how: PR 过三审并由 PM 回合后上线；到期看生产里 CTS 补齐单人房、小费、团链接资料后，每日计划演练能过且错价会被 409 拦下
---
接在 2026-10-08-daily-plan-publish-price-gate 后面（A 级，草稿，未合并）。事实源是客户设置里的资料包（官网核实后由 PM 或 FDE 填），代码里不写任何客户价格。
当场试跑：CTS 两份真实计划 10 条含价格帖，补资料后 0 条被拦；2,699 改 2,399、7,188 改 6,188 各 5 条被拦。DeepSeek 五轮合计约 0.04 美元。
