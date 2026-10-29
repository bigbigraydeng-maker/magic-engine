---
id: 2026-10-09-calendar-cts-title-bug-fix-deployed
title: CTS 自动改标题的漏洞修复已合并上线，开关不用关
status: verified
owner: agent
decided_on: 2026-10-09
source: doc:docs/ledger/evidence/2026-10-09-calendar-cts-title-bug-fix-deployed--2026-10-09.md
verify_by: 2026-10-10
verify_how: 10/10 重新核实：`git merge-base --is-ancestor <PR 1948 的合并提交> origin/main` 退出码 0，且 Render 最新一次部署状态为 success；并重新看 9/28 起新周循环（Inngest）产生的标题单有没有错改（已退役旧优化器产生的 chinatravel 的 213 号单 不算在内，见 2026-09-29-cts-retired-seo-optimizer-ran-again）。判成：祖先成立、部署成功、无新错改。
done_on: 2026-10-09
done_ref: doc:docs/ledger/evidence/2026-10-09-calendar-cts-title-bug-fix-deployed--2026-10-09.md
check_note: 10-29 重查：修复提交 b80d2954 在主干上，10-24 部署 dbbe67e4 成功且包含它；9/28 后周循环只有 chinatravel 的 214 号一个单子，无错改
last_checked: 2026-10-29
verified_ref: doc:docs/ledger/evidence/2026-10-09-calendar-cts-title-bug-fix-deployed--2026-10-29.md
---
日历提醒「看一下 CTS 自动改标题的漏洞修好上线没有；没上线就回孔子「关」」的巡检结果，详见证据文件。
