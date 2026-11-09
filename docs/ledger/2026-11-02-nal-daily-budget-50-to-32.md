---
id: 2026-11-02-nal-daily-budget-50-to-32
title: NAL 物流广告每天预算 NZ$50 降到 NZ$32（PM 亲口定）
status: done
owner: agent
decided_on: 2026-11-02
done_on: 2026-11-02
done_ref: doc:docs/ledger/2026-11-02-nal-daily-budget-50-to-32.md
source: session:90a50c3b
verify_by: 2026-11-09
verify_how: 11/09 在 Meta 读 NAL 广告账户 尾号4498626 广告系列 尾号1605725（物流广告组-WhatsApp）：①每天预算仍是 NZ$32（没被 ME 自动调整改回去）；②11/03–11/09 每天实际花费与开聊数、每个开聊成本，对比 10/19–11/01 的日均（花费约 NZ$50、近 7 天 68 个开聊、每个约 NZ$5.1）。开聊数掉得比花费多（每个开聊成本明显变贵）才算降预算有副作用，回 PM 决定；没掉就保持。
---
PM 2026-11-02 说「NAL 日广告向下调整 20%，应该是 32 刀/每天附近，核实一下」。核实结果：Meta 里每天预算一直是 NZ$50（14 天没变），降 20% 应是 NZ$40，NZ$32 是降 36%。PM 看到后回「32」，agent 在 Meta 后台把广告系列 尾号1605725 的每天预算改成 NZ$32，读回确认 daily_budget=32、状态仍开启。

只改了这一个数。Meta 后台 NAL 账户里留着 1 条别人留下的、带错误的未发布广告草稿（物流广告-WhatsApp - 广告副本），agent 没碰，发布时只发布了预算这一项。

未处理：ME 里 NAL 的自动调整是开的（bounded_auto，日上限 NZ$100，autopilot_dry_run=true），它每天读一次 Meta 现状，可能把预算再调回去，需要 NAL 窗口把 32 记成新的目标预算。本窗口是 CTS 广告总控，没有改 NAL 在 ME 里的任何设置。
