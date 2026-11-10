---
id: 2026-11-09-live-ad-approval-receipts
title: 在投广告的红字只点名没有开投回执的广告组
status: done
owner: agent
decided_on: 2026-11-09
source: doc:docs/specs/2026-10-21-ads-spend-requires-approved-plan-gate-design-v0.7.md
verify_by: 2026-11-16
verify_how: 打开一份草稿和一份已批准的推广计划，只有没有「已执行并读回」开投回执的广告组才出红字；一份处方对上两支已开投广告时，两支都出检查结论。
done_on: 2026-11-09
done_ref: pr:3693
---
红字不再因为计划还是草稿、或账户有花费，就说没有批准记录。
每条开着的广告组对已有开投回执：已执行，并且有读回。
一份已批准处方对上多支广告时逐支检查，不再整份放弃。
挂到当前已批准计划和预算变动依据放下一张卡。本卡不改表、不调 Meta。
