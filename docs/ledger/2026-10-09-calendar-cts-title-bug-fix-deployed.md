---
id: 2026-10-09-calendar-cts-title-bug-fix-deployed
title: CTS 自动改标题的漏洞修复已合并上线，开关不用关
status: done
owner: agent
decided_on: 2026-10-09
source: doc:docs/ledger/evidence/2026-10-09-calendar-cts-title-bug-fix-deployed--2026-10-09.md
verify_by: 2026-10-10
verify_how: 10/10 重新核实：`git merge-base --is-ancestor <PR 1948 的合并提交> origin/main` 退出码 0，且 Render 最新一次部署状态为 success；并重新看 9/28 起新周循环（Inngest）产生的标题单有没有错改（已退役旧优化器产生的 chinatravel 的 213 号单 不算在内，见 2026-09-29-cts-retired-seo-optimizer-ran-again）。判成：祖先成立、部署成功、无新错改。
done_on: 2026-10-09
done_ref: doc:docs/ledger/evidence/2026-10-09-calendar-cts-title-bug-fix-deployed--2026-10-09.md
check_note: "#1948 已于 2026-09-26 14:12Z 合并，位于 origin/main 祖先链上，main 最新部署（dd3692a8，2026-10-08）状态 success；9/28 周一那轮已在修复后跑过（样本 1 轮），不需要关开关。"
---
日历提醒「看一下 CTS 自动改标题的漏洞修好上线没有；没上线就回孔子「关」」的巡检结果，详见证据文件。
