---
id: 2026-11-13-ad-intraday-sample-clicks
title: 十分钟花费样本补上链接点击和成效，旧行留空
status: decided
owner: agent
decided_on: 2026-11-13
source: doc:docs/ledger/2026-11-13-ad-intraday-sample-clicks.md
verify_by: 2026-11-16
verify_how: Ray 亲手套用新列之后，下一轮 ad-intraday-spend-sample 写入的新样本带链接点击和成效；套用前的旧行这两列为空。封顶确认卡的判定不因新列改变。广告级样本不在这一轮。
---
Ray 决定先在旧的十分钟采样上补字段，以后再迁到新平台。
新列可空、不回填、不造 0。成效按健康页口径取表单和私信的较大值，重叠类型不累加。
表要等 Ray 同意后才套用。套用前采样仍只写花费和展示，封顶照旧。
广告级样本和版位留到后面，这一轮只加列。
