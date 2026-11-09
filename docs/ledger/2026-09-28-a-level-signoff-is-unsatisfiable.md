---
id: 2026-09-28-a-level-signoff-is-unsatisfiable
title: 最高风险档 PR 要求的「三方签字」今天谁都签不上，于是每一个都只能靠 PM 绕过——审过和没审过在闸门眼里长得一样
status: decided
owner: agent
decided_on: 2026-09-28
source: pr:2131
verify_by: 2026-10-12
verify_how: 查两件。①签字这条路通没通：不能只看 GitHub 仓库变量 `ME_SIGNOFF_TRUSTED_LOGINS`（工作流里映射成进程环境变量 `SIGNOFF_TRUSTED_LOGINS`）是否有值——它只是签字评论作者的可信名单，`.github/merge-authorization.md` 里写明「签字标记的自动写入路径尚未建成（自治计划 B3 的后半）」，配了值也不会自动产生绑定当前 base/head 的三方标记。真正要核实的是 **B3 签字自动写入路径本身是否已上线**：在一个测试 PR 上跑一遍，确认由**一个**可信机器身份（`.github/merge-authorization.md` 里写死的独立身份——不是 `github-actions[bot]`、不是 PR 作者、不是 PM 登录名）写出绑定当前 base+head、覆盖子牙/魏征/狄仁杰三个角色的 `<!-- me-review-signoff:{...} -->` 标记（`evaluateSignoffs` 校验的是三个 `role`，不要求三个不同作者），`Risk gate` 因此转绿，或者至少完整走一次签字闭环并留下证据；②在 B3 没通之前，闸门有没有**真的变得有区分力**——判据不是「改个提示文案」：`check-risk-gate.mjs:281` 今天就已经在输出「现阶段：签字自动写入尚未建成，A 级由 PM 决定是否以管理员身份合并」，所以「文案写明机制未建成」这条**今天就已经满足**，拿它当验收等于零成本通过而问题原封不动（Codex 复审第二轮指出，成立）。要算做到，必须是闸门**解析并展示**人工签字记录，且显示「签字 SHA=X，与当前 head 一致 / 不一致」。**记录只能有一个来源，且写下它必须能让闸门重新判一次**（Codex 复审第三轮指出，成立并已核实：`.github/workflows/pr-risk-gate.yml:23-28` 只监听 `pull_request_target`，正文 `edited` 会重跑，**发评论 / 改评论都不会**——所以「签字写在评论里」这条路今天写完了闸门也不刷新，PM 看到的还是旧状态）。二选一：**要么**来源定为 PR 正文（今天就会重跑）；**要么**保留评论并给工作流加 `issue_comment` 事件（类型 created / edited） 触发——但**加触发器本身不够**（Codex 复审第四轮指出，已核实）：工作流现在的每个入参都取自 `github.event.pull_request.*`（`pr-risk-gate.yml:57-62` 的 `PR_NUMBER`/`BASE_SHA`/`HEAD_SHA`/`PR_AUTHOR`/`PR_DRAFT`/`PR_IS_FORK`，连 `:34` 的并发分组键也是），而 `issue_comment` 事件的载荷**没有 `pull_request` 对象**，于是这些变量全空、`check-risk-gate.mjs` 的 `requiredEnv()` fail-closed，**贴完评论只会得到一次失败的运行，不是重判**。走这条路必须同时：先确认该评论属于 PR（`github.event.issue.pull_request` 存在），从 `github.event.issue.number` 取号，再用 API 补齐 base/head/作者/草稿/fork 这些字段，并给并发分组另立一个键。验收时要实际看到：贴上记录之后有一次**新的**闸门运行，且它显示了记录和 SHA 匹配状态，文案如实写明「同一 GitHub 账号自述、非独立身份、未经机器认证」，不得出现「已审查」这类会被读成已验证的说法（子牙 2026-09-27 要求配测试断言这两点）。两件都没做到 = 把结论交回 PM，并说明每个 A 级 PR 仍在靠绕过放行
---
⚠️ **先说清：这不是新发现，我该先查权威源。** `.github/merge-authorization.md` §现阶段行为 早已如实写明「签字标记的自动写入路径尚未建成（B3 后半）· `ME_SIGNOFF_TRUSTED_LOGINS` 今天为空 · 所以今天所有 A 级 PR 的 `Risk gate` 都是红的」，连「agent 不得自行对 A 级 `--admin`」都写了。卫青当成实测新发现开了这张卡 = 又一次没先查权威源。**本卡真正还成立的只有下面第二段那个后果**：那份文档写的是另一件相邻的事（机器分不清「PM 说了 go」还是「agent 自己决定」），**没有覆盖「分不清审过没审过」**，而便宜解也确实不在任何地方。Codex 复审另纠正了 4 处（变量真名、按 role 不按身份、验收不能只看变量非空、§11 该判 P3），已全部照改。

2026-09-28 卫青在推 PR #2131（A 级）时实测：闸门要 `ziya/weizheng/direnjie` 三个签字，但 GitHub 仓库变量 `ME_SIGNOFF_TRUSTED_LOGINS`（工作流里映射成进程环境变量 `SIGNOFF_TRUSTED_LOGINS`）是空的（运行日志里该变量打印为空值，不是遮掩的密钥），而 `selectTrustedSignoffMarkers` 在可信名单为空时会丢掉所有签字标记（另外永远排除 PR 作者本人）。**所以三方签字在今天这套配置下无法被任何人满足。**
**后果不是「多一道人工步骤」，是闸门给出的信息有误导性**：#2131 实际由子牙 + 魏征真审过、并按意见改了三处、复签了 SHA，但闸门显示的仍是「缺签字，由 PM 决定是否绕过」——**真审过的 PR 和没人看过的 PR，在 PM 眼前长得一模一样**。PM 每次都只能选「绕过」，久了就会不读而绕过。这跟同期在修的「假红让人学会忽略真红」是同一个病。
**修法两条，哪条都行，但不能不动**：①把 B3 签字自动写入路径建成并上线，再给 GitHub 仓库变量 `ME_SIGNOFF_TRUSTED_LOGINS` 配上值——只配变量、不建写入路径，签字仍然写不进去，这条路照样是死的；②在此之前，让闸门**读一个唯一来源的人工签字记录并展示它 + 显示签字 SHA 与当前 head 是否一致**（光把文案改成「签字机制未建成」不算——闸门今天就在输出这句）。来源二选一、不能两边都写：PR 正文（今天就会触发重跑）或 PR 评论（需给工作流加 `issue_comment` 触发，**并且**从 `github.event.issue` 解析 PR 上下文、用 API 补齐 base/head 等字段——光加触发器会因为载荷里没有 `pull_request` 对象而 fail-closed 成一次失败运行，见验收第②条）。
**优先级（按 ENGINEERING_QUALITY_GATES §11）**：频率 高（每个 A 级 PR 都撞上）/ IMPACT 闭环关键度 低（本卡已明确这只卡治理闸门，不在产品 IMPACT 闭环里）/ 收入关联度 低 → 两个低、一个高 → **P3**（记入 ROADMAP 待认领）。
本卡只钉事实，未改闸门代码（`.github/` 与 `tools/ops-review-loop/` 都是受保护路径，改它们自己又是 A 级，得走同一道门）。
