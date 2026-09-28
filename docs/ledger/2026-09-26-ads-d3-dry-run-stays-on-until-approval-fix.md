---
id: 2026-09-26-ads-d3-dry-run-stays-on-until-approval-fix
title: 广告自动暂停的演练模式（只记不停）保持开着，直到审批修复合并上线
status: decided
owner: pm
decided_on: 2026-09-26
source: session:67233075
verify_how: 关演练模式那天先确认 PR 2063 已合并上线，并做过一次只读查存量（D3 等批准 / 已签批未执行）
---
不修就关：人看到的是 A，期间被重排成 B，点「批准」会批 B 并立刻暂停客户在投广告。
修复见 pr:2063 与卡 2026-09-26-ads-d3-approval-binds-seen-decision。
