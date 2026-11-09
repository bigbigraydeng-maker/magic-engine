# 证据 · 2026-09-25-ledger-only-pr-auto-merge · 2026-10-14
fetched_at: 2026-10-14T21:40:59+13:00

查了什么：①9/27 或 9/28 夜巡开出的 claude/ledger-verify-* PR 是不是没人点、自己合进了主干；
②「Ledger refs exist」红的时候改了 src/ 的 PR 是不是真的按不了合并。

数字（带样本量、两边取数状态）：
- ① 已合并的夜巡 PR 共 4 个（head:claude/ledger-verify 搜索全量）：#2097（20260927）、#2170（20260928）、
  #2396（20261009）、#2590（20261013b）。
  判据点名的那两个：
  · #2097：autoMergeRequest.enabledAt = 2026-09-26T14:53:19Z，mergedAt = 2026-09-26T14:54:36Z
    （开启自动合并后 77 秒自己合掉），reviews 列表为空 —— 没有任何人做过批准动作。
  · #2170：autoMergeRequest.enabledAt = 2026-09-28T09:22:54Z，mergedAt = 2026-09-28T09:25:49Z
    （175 秒后自己合掉），reviews 只有机器人 chatgpt-codex-connector，没有人的批准。
    两个都是 CI 转绿后由自动合并队列落地，不是 PM 点的「合并」按钮。
- ② 主干规则集「Protect main」（ruleset 20550157，enforcement=active，作用于 ~DEFAULT_BRANCH）的
  required_status_checks 共 8 项，其中三项台账检查都在必过清单里：
  "Ledger entries valid"、"Code change has ledger entry"、"Ledger refs exist"
  （另外 5 项：ai-orchestrator-tests、ops-review-loop-tests、Kernel architecture test、
  Application build、Tour catalog boundary test）。
  bypass_actors = []（空）→ 连管理员都没有豁免通道。
  所以「Ledger refs exist」为红时，任何 PR（含改了 src/ 的）都合不进主干。

来源/命令：
- gh pr list --state merged --search "head:claude/ledger-verify" --json number,headRefName,mergedAt,title
- gh pr view 2097 / 2170 --json mergedBy,autoMergeRequest,mergedAt,reviews
- gh api repos/bigbigraydeng-maker/magic-engine/rulesets
- gh api repos/bigbigraydeng-maker/magic-engine/rulesets/20550157（取 required_status_checks / bypass_actors / conditions）

判据替代说明：② 原文说的是「开一个改了 src/ 的测试 PR 看按不按得下合并」。夜巡不开测试 PR
（会污染主干规矩、也违反本任务只动 docs/ledger/ 的约束），改用规则集本身作为实证：
该检查在必过清单里且无豁免者，等价于「红了就合不进」。

结论：成。两条都达标 —— 夜巡 PR 确实无人干预自动合并，台账三道检查确实是主干必过且无豁免。
