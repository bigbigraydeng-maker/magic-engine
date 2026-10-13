---
id: 2026-09-27-kernel-arch-test-ci-seo-meta-exempt
title: SEO 标题周循环有 3 个文件绕过内核、直接改客户网站仓库，先登记为临时例外；SEO 3b（B7）落地时必须清掉
status: failed
owner: agent
decided_on: 2026-09-27
source: session:d1add426
verify_by: 2026-10-11
verify_how: 四条都在主干上查，都成才算成，任何一条不成 = 不成（3b 没按期落地或没真迁走，交 SEO 窗口）。①三条完整路径 src/lib/inngest/functions/seo-meta-cycle.ts、src/lib/seo-meta/cycle/apply-adapter.ts、src/lib/seo-meta/cycle/pr-guard.ts 在 src/lib/kernel/boundaries.ts、.eslintrc.json、src/lib/kernel/__tests__/architecture.test.ts 里的 grep 计数都为 0；②git grep -n github-client -- src/lib/seo-meta/cycle/ src/lib/inngest/functions/seo-meta-cycle.ts（以及 3b 挪动或新建的周循环文件）没有代码引用，任何写法都算（import()、require、相对路径），注释不算；并且 grep -rnE '\.(createBranch|commitFile|createPullRequest|mergePullRequest)\(' 在同样这些路径里计数为 0（改之前是 4 处）；不要 grep 整个 src/lib/seo-meta，cts-meta-pr.ts 是另一条旧豁免；③周循环不再调用豁免文件里的写函数（例如 cts-meta-pr.ts 的 runCtsMetaPr），并能指出周循环写客户仓库时提交 action_run 的那一行代码；④npx vitest run src/lib/kernel/__tests__/architecture.test.ts -t "对外写能力" 全绿
done_on: 2026-09-27
done_ref: pr:2079
last_checked: 2026-10-13
check_note: 到期日已过，三条路径仍原样挂在主干的豁免名单里：github-client 3 处引用、对外写函数 4 处调用，跟登记时一字没动。SEO 3b 没按期迁走，交 SEO 窗口
verified_ref: doc:docs/ledger/evidence/2026-09-27-kernel-arch-test-ci-seo-meta-exempt--2026-10-13.md
---
子牙拍板：先豁免、先接 CI，不等 3b。3b 合并日期孔子答「不知道」（前面还排着 #1948 和卫青 task_5ac9a006），verify_by 按两周占位。
按台账规则，这张卡满 7 天会以「做了没验」出现在待办邮件里，属正常：3b 还没落地。
CI 接线与设成必过另见 2026-09-27-kernel-arch-test-ci-required。
