# 证据 · 2026-09-27-kernel-arch-test-ci-seo-meta-exempt · 2026-10-13

fetched_at: 2026-10-13T23:05:28+1300

查了什么：verify_how 的四条「都成才算成，任何一条不成 = 不成」。本晚在今晚新建的主干工作副本（HEAD cd55d2a04，取自 origin/main）上查前两条，已足以判定。

数字（带样本量、两边取数状态）：
- ①三条豁免路径在三个登记文件里的出现计数，要求全为 0，实测全部非 0（9 组合，无一为 0）：
  seo-meta-cycle.ts → boundaries.ts 1 / .eslintrc.json 1 / architecture.test.ts 1；
  apply-adapter.ts → 1 / 1 / 2；pr-guard.ts → 1 / 1 / 1。
- ②要求周循环里 github-client 零引用，实测 3 处仍在（seo-meta-cycle.ts:31、apply-adapter.ts:39、pr-guard.ts:17）；
  要求四个对外写函数调用计数为 0，实测仍是 4 处，全在 apply-adapter.ts 的 145 / 146 / 155 / 241 行——跟登记时的「改之前是 4 处」一模一样，没动过。
- ③④未查：①②已判不成，按 verify_how「任何一条不成 = 不成」不必续查。

来源/命令：`grep -c -F <路径> src/lib/kernel/boundaries.ts .eslintrc.json src/lib/kernel/__tests__/architecture.test.ts`；`git grep -n github-client -- src/lib/seo-meta/cycle/ src/lib/inngest/functions/seo-meta-cycle.ts`；`grep -rnE '\.(createBranch|commitFile|createPullRequest|mergePullRequest)\(' <同样路径>`

结论：不成——到期日 2026-10-11 已过，SEO 3b 没有按期把这三条路径迁走，临时豁免仍原样挂在主干上。按 verify_how 交 SEO 窗口。
