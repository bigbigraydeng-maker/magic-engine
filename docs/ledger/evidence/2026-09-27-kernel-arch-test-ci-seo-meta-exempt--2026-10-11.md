# 证据：2026-09-27-kernel-arch-test-ci-seo-meta-exempt · 取数 2026-10-11（本仓库主干只读核实）

| 检查项 | 命令 | 结果 |
|---|---|---|
| ① 三条路径在三处豁免清单的计数 | `grep -c <文件名> src/lib/kernel/boundaries.ts .eslintrc.json src/lib/kernel/__tests__/architecture.test.ts` | seo-meta-cycle.ts / apply-adapter.ts / pr-guard.ts 每条在三处各 1，**都不是 0** |
| ② 周循环引用 github-client | `git grep -n github-client -- src/lib/seo-meta/cycle/ src/lib/inngest/functions/seo-meta-cycle.ts` | 3 处：seo-meta-cycle.ts:31、apply-adapter.ts:39、pr-guard.ts:17 |
| ② 直接写客户仓库 | `grep -rnE '\.(createBranch\|commitFile\|createPullRequest\|mergePullRequest)\(' 同上路径` | 4 处：apply-adapter.ts:143、144、153、204 |

## 结论
verify_how 规定任一条不成即不成：①②均未达标，豁免仍在、旁路仍在，SEO 3b 未落地。判 failed，交 SEO 窗口。
