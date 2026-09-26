---
id: 2026-09-27-kernel-arch-test-ci-seo-meta-exempt
title: SEO 标题周循环有 3 个文件绕过内核、直接改客户网站仓库，先登记为临时例外；SEO 3b（B7）落地时必须清掉
status: decided
owner: agent
decided_on: 2026-09-27
source: session:d1add426
verify_by: 2026-10-11
verify_how: 在主干上 grep 三条完整路径 src/lib/inngest/functions/seo-meta-cycle.ts、src/lib/seo-meta/cycle/apply-adapter.ts、src/lib/seo-meta/cycle/pr-guard.ts，在 src/lib/kernel/boundaries.ts、.eslintrc.json、src/lib/kernel/__tests__/architecture.test.ts 三个文件里的计数都为 0，且主干上 npx vitest run src/lib/kernel/__tests__/architecture.test.ts -t "对外写能力" 全绿；还剩任何一条 = 不成（3b 没按期落地，交 SEO 窗口）
---
子牙拍板：先豁免、先接 CI，不等 3b。3b 合并日期孔子答「不知道」（前面还排着 #1948 和卫青 task_5ac9a006），verify_by 按两周占位。
按台账规则，这张卡满 7 天会以「做了没验」出现在待办邮件里，属正常：3b 还没落地。
CI 接线与设成必过另见 2026-09-27-kernel-arch-test-ci-required。
