# 证据 · 2026-09-27-application-build-required · 2026-11-01
fetched_at: 2026-11-01T21:34:53+1300
查了什么：卡上判据①规则集 20550157 必过检查里有没有 Application build、bypass_actors 是否为空；②最新 PR 的 --required 里有没有 Application build。
数字（带样本量、两边取数状态）：
- gh api repos/bigbigraydeng-maker/magic-engine/rulesets/20550157：updated_at 2026-10-31T09:32+13:00；required_status_checks 只剩 1 项「Run PR checks」，无 Application build；bypass_actors 有 1 项（RepositoryRole actor_id=5，always）。取数成功。
- gh pr checks 3483 --required（最新合并 PR）：只有 Risk gate、Run PR checks 两项，无 Application build。
- .github/workflows/pr-light-checks.yml 第 20–23 行注释写明：整仓类型检查和生产构建不在 PR 检查里（省免费分钟数，靠 Render 部署时构建）。
来源/命令：上面两条 gh 命令 + 读主干 origin/main(8b8472b27) 的工作流文件。
结论：不成——判据①两条都不满足（无 Application build、bypass 非空），且从工作流注释看是有意摘掉，需 PM 决定接受现状另开卡，还是恢复必过。
