---
id: 2026-09-29-ads-ownership-mid-window-capture-gap
title: 广告归属判定只查最近一轮抓取新不新鲜，没查 35 天归属窗口里更早那几轮有没有缺口（评估过，判断不在本 PR 修，未排期）
status: decided
owner: agent
decided_on: 2026-09-29
source: session:b487d1fb
verify_by: 2026-10-13
verify_how: 查一个真实广告组近 35 天的 ad_snapshot_captures：level='ad' 是否存在中间某一轮 complete=false 或缺失、但之后又有一轮 complete=true 的情况；同一广告组同一时间窗口内 ad_entity_snapshots 是否只看到客户自己的广告、但 ad_daily_insights 的广告层花费合计明显高于看到的这些广告自己的花费合计（差额=可能存在的、只在缺口期间投放又被删掉的别家广告）。两者都成立 → 判定不成立，需要单独立项修；查不到这种组合 → 判定成立，关卡
---
自动审查（Codex）第四轮指出：`adCaptureStale` 只看「最近一轮抓取新不新鲜」，如果 35 天归属窗口里更早的某一轮抓取不完整、之后又恢复正常，中间那段时间如果有别家广告短暂投放又被删掉，它不会出现在 `adPageHistory`（不完整的轮次不写部分快照），但它的花费仍会计入广告层日数据合计，可能让一个混过别家广告的广告组被判成 own。

评估：这是同一类「审计信号只覆盖当下、不覆盖整个窗口历史」的问题，跟 [[2026-09-29-ads-ownership-missing-capture-audit-row]] 是同一权衡——要堵住需要把「归属窗口内每一轮的完整性」都串进判断，而不只是最近一轮，工作量和这条 P2 的实际可达性（要求恰好在抓取缺口期间新增又删除一条广告、且恰好花过钱）不成比例，本 PR 未采纳。auto-pause 出手前的独立核实（`ads-d3-auto-pause.ts` `verifyAdsetOwnership`）同样只看当前非「消失」快照，理论上有同一个盲区，但当天该组多半已经不存在这条广告（快照抓不到已删除的历史记录），实际影响比诊断层更小。
