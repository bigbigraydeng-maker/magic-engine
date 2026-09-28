---
id: 2026-09-29-ledger-frozen-check-broke-all-open-prs
title: 冻结字段检查合并后，凡是没同步主干的旧 PR 必过检查全部报错——已加引导期豁免
status: done
owner: agent
decided_on: 2026-09-29
source: session:31cdcfa9
done_on: 2026-09-29
done_ref: pr:2189
verify_by: 2026-10-05
verify_how: "抽 2-3 个现存的、没有合并最新主干的旧 PR，触发一次新的检查跑（推一次空提交或点 Rerun），确认「Ledger entries valid」不再报「scripts/ledger-check-frozen.sh 找不到文件」这类错误，改成显示 ::notice 跳过；同时确认新开的、已经带着这份脚本的 PR 上这项检查真的在跑（不是也被静默跳过）。"
---
2026-09-28 #2155（台账正文行数+冻结字段检查）合并进主干后，`Ledger entries valid` 这个必过检查里新加的「Check frozen fields」步骤立刻对**所有在此之前就开着、没有合并最新主干的 PR** 报错——`pull_request` 触发的工作流定义来自 base+head 的合并解读，但检出的代码钉死在 PR 自己的 head，那些 PR 的分支里根本没有 `scripts/ledger-check-frozen.sh` 这个文件，属于设计引入时没考虑到的引导期缺口。子牙审查 #2131 时顺带发现（该 PR 本身内容没有问题，是被这个不相关的检查拖累判红）。
修法：跟 #2177（视频工厂闸门）已经用过的同一个「引导期豁免」写法一致——脚本文件不存在就 `::notice` 跳过、退出码 0，不静默通过也不误杀旧 PR；等旧 PR 各自合并主干、脚本文件到位后，这项检查会自动开始真的跑。
