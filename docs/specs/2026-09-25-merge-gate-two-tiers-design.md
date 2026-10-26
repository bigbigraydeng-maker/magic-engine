# 合并闸两档化设计稿（机器定级 · B/C 自动合 · A 级签字闸）

> **2026-10-25 起，A 级签字人已改。** 现行规则在 `.github/merge-authorization.md`：A 级要 Codex Astra 与 Claude Code 两方签字；子牙 / 魏征 / 狄仁杰 只做 B 级可选抽查，不挡 B/C 合并。下面第 0 节是 2026-09-25 的原文，保留不改。

- 日期：2026-09-25 · 风险级 **A**（改 `.github/workflows/`、`tools/ops-review-loop/`，即 `risk.mjs` 自己判的 control-plane）
- 台账卡：`docs/ledger/2026-09-25-merge-gate-machine-not-human.md` · `docs/ledger/2026-09-25-merge-two-tiers-auto-vs-signed.md`
- 审核：子牙（架构）+ 魏征（挑刺）+ 狄仁杰（攻击验证）设计前一次、实施后一次
- 执行：DeepSeek/aider 写代码文件，构建控制窗口逐轮审 diff；规则文档由构建控制窗口自己改
- §11 资源优先级（PM 已拍板，此处只亮打分）：频率 高（每个 PR 都过这道闸）/ IMPACT 中（内部流水线，不是客户 IMPACT 环）/ 收入 低 → 一个低、一个高 → **P2**；PM 2026-09-25 指定提前做

## 0. 决策原文（不改）

①合并不做"每次 GitHub 点头"的人工闸；②分两档——B/C 级 PR 机器检查全绿自动合、不再在聊天里问 PM go；A 级要审核团队三人签字被机器记录后才合，接线前仍问 PM 一句。

## 1. 核实到的仓库事实（2026-09-25 01:30 NZST，`gh api` 只读）

| 事实 | 值 | 对设计的影响 |
|---|---|---|
| 主干规则集 `Protect main`（id 20550157）必过检查 | `ai-orchestrator-tests` · `Ledger entries valid` · `Code change has ledger entry` · `Ledger refs exist` | `Merge authorization (Ray)` **从来不在必过清单里** |
| `Protect main` 的 `bypass_actors` | **空** | 任何人（含管理员 `--admin`）都绕不过这个规则集里的红检查。**如果把 A 级签字检查加进这个规则集，签字写入路径没建之前所有 A 级 PR 一个都合不进**，含本 PR 之后的所有 A 级 PR |
| `Protect main` 其它规则 | 合并方式只允许 merge · 必须解决所有 review 线程 · 需要审批数 0 | 自动合也受"线程必须解决"约束，Codex 留的线程没解决照样合不了（现状不变） |
| 仓库 `allow_auto_merge` | true | `gh pr merge --auto --merge` 可用 |
| GitHub 环境 `merge-authorization` | 存在，**protection_rules 为空**（没有 required reviewer） | 证实旧检查 5 秒自动过、从未拦过 |
| `tools/ops-review-loop/tests` 在 CI 里跑不跑 | **不跑**（`ai-orchestrator-tests` 只跑 `tools/ai-orchestrator`） | 验收③"删一条规则→测试红"必须先把这套测试接进必过检查 |
| 本地基线 `npx vitest run tools/ops-review-loop` | 362 过 / **1 红**（`merge-authorization.test.ts` 断言 workflow 没有 `uses:` 步骤，PR #1988 加了 checkout 后就红了；base=e01290a9，2026-09-25 01:31） | 旧 workflow 和这条测试一起删，红自然消失 |
| 仓库里 `on: push` 到 main 的 workflow | `db-security-invariants.yml`（只看 migrations 路径）· `parkhomes-deploy.yml`（只看 `docs/clients/parkhomes/web/`） | 见 §7 已知缺口 1 |
| `gh api user` | `bigbigraydeng-maker` | 绝大多数 PR 的作者就是 PM 账号（Claude Code 用 PM 的 gh 推送），所以 **PM 登录名不能当"可信写标记身份"**——它就是 PR 作者 |
| 现有 secrets / vars | `OPS_REVIEW_PAT`（PM 的 PAT，只有 issues + PR 写权限）· var `OPS_AUTO_MERGE_ENABLED=true`（只在 ROADMAP 提到，没有 workflow 读它） | 本设计不用 `OPS_REVIEW_PAT`（它的作者就是 PR 作者）；`OPS_AUTO_MERGE_ENABLED` 不碰 |
| 环境里没有任何 `pull_request_target` workflow | — | 本设计首次引入，理由见 §3.1 |

## 2. 最小契约 → 文件落点

| 契约条 | 做什么 | 文件 |
|---|---|---|
| 1 假检查改实话 | 删 `pr-merge-authorization.yml` + `merge-authorization.test.ts`；`merge-authorization.md` 重写成两档规则 | `.github/workflows/pr-merge-authorization.yml`（删）· `tools/ops-review-loop/tests/merge-authorization.test.ts`（删）· `.github/merge-authorization.md`（重写） |
| 子牙 BLOCKER 1：治理文件判 A | `risk.mjs` 新增类别 `governance`：`CLAUDE.md`、`AGENTS.md`、整个 `.github/`（不只 `workflows/`）、`.claude/`（agent 规则与 skill）、`docs/ENGINEERING_QUALITY_GATES.md`、`docs/ledger/README.md`、`scripts/ledger-*`；`quality.mjs` 补对应证据条目（现有测试要求每个类别都有）；`risk.test.ts` 每条加真实探针路径。`docs/agents/*.md` 不升 A（子牙建议：改动频繁、不是执行面） | `tools/ops-review-loop/src/risk.mjs` · `tools/ops-review-loop/src/quality.mjs` · `tools/ops-review-loop/tests/risk.test.ts` |
| 2 定级接线 | 新 workflow `Risk gate` 从 main 检出、调 `check-risk-gate.mjs`，用 `classifyRisk` 算级、`buildGateMarker` 写标记、`selectTrustedGateMarkers` 读标记 | `.github/workflows/pr-risk-gate.yml`（新）· `tools/ops-review-loop/src/check-risk-gate.mjs`（新，I/O 入口）· `tools/ops-review-loop/src/merge-decision.mjs`（新，纯函数） |
| 3 B/C 自动合 | 定级 B/C → workflow 步骤 `gh pr merge --auto --merge`；GitHub 在必过检查全绿时自己合 | 同上 workflow |
| 4 A 级签字闸 | 定级 A → 读签字标记；三方（子牙/魏征/狄仁杰）对当前 base+head 都有可信身份写入的标记才绿；否则**红** | `tools/ops-review-loop/src/signoff-marker.mjs`（新，纯函数） |
| 5 规则文档 | `CLAUDE.md` §2 / §6、`docs/ENGINEERING_QUALITY_GATES.md` §10 状态句、`tools/ops-review-loop/README.md` "NOT yet wired" 段、`docs/ledger/README.md` 门卫段 | 各文件最小修订 |
| 6 台账 | `node scripts/ledger-update.mjs <id> status=done done_on=… done_ref=pr:<n>` 两张卡 | 两张台账卡 |
| 验收③前置 | 新 workflow `ops-review-loop CI`（`pull_request`，PR head 检出）跑 `npx vitest run tools/ops-review-loop`，job 名 `ops-review-loop-tests` | `.github/workflows/ops-review-loop-ci.yml`（新） |
| 结构测试 | 断言两个新 workflow 的触发方式 / 检出 ref / 权限 / 无路径过滤 / 脚本存在 | `tools/ops-review-loop/tests/risk-gate-workflow.test.ts`（新）· `signoff-marker.test.ts`（新）· `merge-decision.test.ts`（新） |

不碰：`src/` 任何文件、`docs/ROADMAP.md`、`quality.mjs` / `sampling.mjs`（仍不接线，文档照实写）、`ops-codex-*` 三个 workflow、`ledger-check.yml`、`ai-orchestrator-ci.yml`。

## 3. `Risk gate` 检查（核心）

### 3.1 触发与检出：`pull_request_target`，定义和代码都来自 main

`pull_request` 事件跑的是 **PR 分支上的** workflow 定义。一个 PR 只要改 `pr-risk-gate.yml` 本身，就能让"判它的检查"改成 `echo C && gh pr merge --auto`——判官的判词由被告写。`ops-fix-scope-guard.yml` 用 `checkout ref: main` 保护了脚本，但保护不了 workflow 文件自己。

`pull_request_target` 事件跑的是 **base 分支（main）上的** workflow 定义，再 `checkout ref: main` 拿脚本，于是判官的定义和代码都在 main，PR 只能以"数据"身份进入（改动文件清单、PR 正文、评论）。`pull_request_target` 的经典风险是"检出 PR head 并执行它的代码"——本设计**绝不检出 PR head**，结构测试断言 workflow 里没有 `pull_request.head` 检出。

check run 挂在 PR head SHA 上，可以设为必过检查。

外部事实核对（2026-09-25，网上查证）：GitHub 2025-12-08 起 `pull_request_target` 的 workflow 文件一律从默认分支取、`GITHUB_SHA` 指向默认分支最新 commit（changelog 2025-11-07），正好是本设计要的语义；check run 是否挂在 PR head 上并能满足必过检查，changelog 没写，按多年实践（labeler / dependabot 类 workflow 都这么用）可以，但**只能合入后设必过时线上证实**。若证实不行，退路是改回 `pull_request` + `checkout ref: main`（与 `ops-fix-scope-guard.yml` 同款），接受"PR 能改 workflow 文件自己"这一层暴露，并在文档里写明。

引导问题：本 PR 引入这个 workflow 时 main 上还没有它，所以本 PR 上不会出现 `Risk gate` 检查——它本来就还不是必过项，本 PR 按现状由 PM 合，合入后 PM 再把它设为必过（§6）。没有"引导豁免"分支，不留口子。

### 3.2 权限

```yaml
permissions:
  contents: write        # 开 / 关 auto-merge 需要
  pull-requests: write   # 写定级评论、开 / 关 auto-merge
```

`contents: write` 只在 main 定义的 workflow 里、只跑 main 上的脚本；PR 影响不到它跑什么。

### 3.3 `check-risk-gate.mjs` 逻辑（全部 fail-closed）

输入（env）：`GITHUB_TOKEN` · `PR_NUMBER` · `BASE_SHA` · `HEAD_SHA` · `PR_AUTHOR` · `PR_DRAFT` · `SIGNOFF_TRUSTED_LOGINS`（来自 `vars.ME_SIGNOFF_TRUSTED_LOGINS`，逗号分隔，可为空）· `GATE_MARKER_AUTHOR`（常量 `github-actions[bot]`）。

1. `GET /pulls/{n}`：确认 `head.sha === HEAD_SHA`、`base.sha === BASE_SHA`，不一致 → 红（"这次运行对应的 head 已经不是当前 head"）。读 `body` 给 `parseDeclaredRisk` 作下限。
2. `GET /pulls/{n}/files` 分页（照抄 `check-fix-scope.mjs` 的分页；含 `previous_filename`，rename 两头都算）。API 失败 → 不构造清单，直接传 `files: undefined` 给 `classifyRisk` → A + `unreadable`。
3. `classifyRisk({ files, declaredRisk })` → `{ risk, reasons, categories, readable }`。
4. `GET /issues/{n}/comments`（分页）。用 `selectTrustedGateMarkers({ sources, trustedAuthors: [GATE_MARKER_AUTHOR] })` 找当前 `(base, head)` 已有的定级标记：有且 risk 相同 → 不重复发评论；否则发一条评论 = 人话摘要 + `buildGateMarker({ base, head, risk, reasons })`。**其它作者写的标记一律不读**（验收④）；摘要里写明"忽略了 N 条非可信身份的标记"，让伪造这件事本身可见。
5. 决策（`merge-decision.mjs` 纯函数 `decideMerge({ risk, draft, signoff })`）：

| 情况 | 检查结果 | auto-merge 动作 |
|---|---|---|
| 草稿 PR | **红**（"草稿不做合并判定"；草稿本来也合不了，红只是不留窗口） | `--disable-auto` |
| fork 来的 PR（`head.repo.full_name !== github.repository`） | **红**（"fork PR 不自动合"——`pull_request_target` 给的是写权限 token，判 C 就会自动合外人的代码；仓库只收协作者，影响面小，但立场写死） | `--disable-auto` |
| B 或 C | 绿 | `gh pr merge --auto --merge`（GitHub 等所有必过检查绿再合） |
| A，三方签字齐（对当前 base+head） | 绿 | `--disable-auto`（A 级永不自动合；人合） |
| A，签字不齐 | **红**，摘要列出缺谁 + "现阶段行为"说明 | `--disable-auto` |
| 定级本身读不到 | 按 A 处理（同上两行） | `--disable-auto` |

之所以每次都显式 `--disable-auto`：一个 PR 先是 C（开了 auto-merge），后一次推送碰了 kernel 变 A——红检查本身已经挡住，但把 auto-merge 标志也关掉，不让"以前开过"这个状态活到下一次绿。

6. 写 `$GITHUB_OUTPUT`：`risk=` `decision=enable|disable`；workflow 里一个独立步骤按 decision 跑 `gh pr merge --auto --merge "$PR"` 或 `gh pr merge --disable-auto "$PR"`（`gh` 在 ubuntu-latest 预装，无新依赖）。退出码：绿 0，红 1。
7. 子牙 CONCERN 1（"没跑"和"没事"不许长得一样）：auto-merge 那一步**不许** `continue-on-error`，`gh` 失败即检查红；定级评论和 step summary 写明"自动合并：已开启 / 已关闭 / 开启失败（原因）"。auto-merge 开了却因 review 线程未解决等原因一直挂着，本检查看不见——记为后续事项（§7 缺口 4）。

### 3.4 定级标记的可信身份

定级标记由 `github-actions[bot]` 写（本 workflow 的 `GITHUB_TOKEN`）。读的时候 `trustedAuthors = ['github-actions[bot]']`，**绝不传** `github.event.pull_request.user.login`。

已知边界（写进文档，不装没看见）：PR 分支上的任何 `pull_request` workflow 拿到 `pull-requests: write` 也能以 `github-actions[bot]` 身份留言，所以 `github-actions[bot]` 写的**定级**标记只当"记录"用——本检查每次都从 main 的代码重新算级，从不把旧标记当输入。把它当输入的那天（B3 循环消费它时）必须另想身份。

### 3.5 签字标记（A 级）

新模块 `signoff-marker.mjs`，形状照 `gate-marker.mjs`（同样的 `<` / `>` 转义、同样的 round-trip 自检、同样的"来源作者不在可信清单一律丢弃"）：

```text
<!-- me-review-signoff:{"v":1,"base":"<sha>","head":"<sha>","role":"ziya","verdict":"pass"} -->
```

- `role` 只收 `ziya` / `weizheng` / `direnjie`；`verdict` 只收 `pass`（不收 `fail`——不通过就不写标记，"没有"就是拦）。别的值 builder 报错、parser 丢弃。
- `evaluateSignoffs({ markers, base, head })` → `{ complete, present: [...], missing: [...] }`；三个角色对**当前 base+head** 都有才 `complete`。head 一动全部作废（跟 gate-marker 同一条规矩）。
- 可信身份：`vars.ME_SIGNOFF_TRUSTED_LOGINS`。代码里再**硬排除**两个登录名，就算变量里写了也不信：`github-actions[bot]`（§3.4 的原因）和当前 PR 作者（作者给自己签字 = 没有闸）。变量为空 → 谁都不信 → 所有 A 级红。

**签字标记的自动写入路径本合同不做**（自治计划 B3 后半）。所以合入后的**现阶段行为**：A 级 PR 的 `Risk gate` 永远红，机器挡住自动合；仍由人在聊天里问 PM 一句，PM 用 `gh pr merge --admin` 合（这要求 §6 的规则集配置到位）。文档只能这么写，不许写成"已有签字流程"。

B3 做签字写入时必须解决的事（先记下，不在本合同里解决）：写签字的身份必须既不是 `github-actions[bot]`、也不是 PM 的登录名（它是 PR 作者），需要一个独立机器身份（GitHub App 或独立账号的细粒度 PAT）。

## 4. `ops-review-loop CI` 检查（验收③前置）

照抄 `ai-orchestrator-ci.yml` 的形状：`pull_request`，**无** `paths:` / `branches:` 过滤（有过滤的必过检查 = 死锁，那个文件头已经写明原因），PR head 检出，`npm ci` → `npx vitest run tools/ops-review-loop --reporter=verbose` → 确认工作树未变。job 名 `ops-review-loop-tests`。只读权限。

它跑的是 PR 分支上的测试和模块——这是对的：它是"这个 PR 的代码自己过不过测"，不是判官。判官（§3）在 main。一个 PR 想删一条 A 规则并同时删掉探针，可以让这条检查绿，但它碰了 `tools/ops-review-loop/` → A → 签字闸红。两道检查各管一段。

## 5. 结构测试 `risk-gate-workflow.test.ts`

对 `pr-risk-gate.yml` 断言：触发只有 `pull_request_target`；`types` 含 `opened synchronize reopened ready_for_review converted_to_draft`；每个 `checkout` 都是 `ref: main`；全文不含 `pull_request.head.sha` 作为检出 ref、不含 `head.ref`；权限恰好 `{contents: write, pull-requests: write}`；`concurrency.cancel-in-progress` 为 true；`node tools/ops-review-loop/src/check-risk-gate.mjs` 出现且文件存在；`gh pr merge --auto --merge` 与 `--disable-auto` 都出现；无 `secrets.` 表达式（只用 `github.token`）；无 `--admin`。

子牙 CONCERN 3 追加：①任何 `run:` 块里不得出现 `${{ github.event.pull_request.title }}` / `.body` / `.head.ref` / `.head.label` 的直接插值（`pull_request_target` 脚本注入的经典口；PR 数据只能经 `env:` 进入）；②全文不含 `git push`；③`contents: write` 只允许出现在 `pr-risk-gate.yml`，`ops-review-loop-ci.yml` 必须只读。

对 `ops-review-loop-ci.yml` 断言：触发只有 `pull_request` 且无 `paths` / `branches`；权限 `{contents: read}`；跑的是 `vitest run tools/ops-review-loop`；无 `secrets.`。

对现有 `workflow-guards.test.ts` 的 `DANGEROUS_SUBSTRINGS`（含 `pr merge` / `auto-merge`）：它只扫 `ops-codex-*` 与 `ops-fix-scope-guard`，新 workflow 不在它的清单里，**不改它**——自动合本来就是新 workflow 的职责，不是那四个的。

## 6. 仓库设置（属仓库配置，PM 合并本 PR 时一并授权；PR 描述里列清）

1. `Protect main` 必过清单**加** `ops-review-loop-tests`。
2. **新建**规则集 `Risk gate`（目标 main）：必过检查只有 `Risk gate`；`bypass_actors` = Repository admin（模式 always）。
   - 为什么单独一个规则集：`gh pr merge --admin` 只绕过"把你列为 bypass 的规则集"；`Protect main` 继续没有 bypass，四道台账 / 测试检查红了管理员照样合不进（PR #1988 的承诺不变），只有 A 级签字闸这一道能被 PM 显式绕过——这就是"接线前仍问 PM 一句"的机器落点。
   - 如果不这样做而是直接加进 `Protect main`：签字写入建成之前，所有 A 级 PR 无人能合，包括 B3 自己。
   - 外部事实核对：GitHub 文档写明 bypass 是**按规则集**配置的（"you can allow certain users to bypass the rules in the ruleset"），多个规则集同时命中时规则聚合、取最严；`gh` 官方仓 issue #13388（2026-05）也确认 API 按规则集回答 `current_user_can_bypass`。**"绕过 A 闸规则集的同时 Protect main 四道检查仍拦得住"这一点本地证不了，合入后用验收②的 PR 顺带证：让它的一道台账检查红，再 `--admin`，应当被拒。**
   - **关闭条件（子牙 CONCERN 2，写死）**：B3 签字自动写入上线、且 `ME_SIGNOFF_TRUSTED_LOGINS` 指向独立机器身份之后，撤掉这个 bypass（或把 `Risk gate` 并入 `Protect main`）。写进 `.github/merge-authorization.md` 和台账卡 `2026-09-25-merge-two-tiers-auto-vs-signed` 的 `check_note`。
   - **如实写现状**：所有 Claude 窗口都用 PM 的 gh 身份，`--admin` 合 A 级 PR 这件事机器分不清是 PM 说了 go 还是 agent 自己决定——今天如此，本 PR 上线后也如此，只有 B3 的独立签字身份能收口。
3. 可选：删除环境 `merge-authorization`（已无 workflow 引用）。
4. 暂不设 `ME_SIGNOFF_TRUSTED_LOGINS`（B3 时设）。设它 = 扩大信任面，须 PM 授权。

## 7. 已知缺口（写进文档，PM 决定要不要补）

1. **用 `GITHUB_TOKEN` 开 auto-merge，合并后不会触发 `on: push` 的 workflow**（GitHub 规则：`GITHUB_TOKEN` 引起的事件不再起新 workflow；2026-09-25 网上查证，多个开源仓因此改用 PAT 合并）。今天受影响的只有 `parkhomes-deploy.yml`（`docs/clients/parkhomes/web/` 是 C 级，会走自动合）——Park Homes 网站改动自动合进主干后**不会自动部署**，要人手动 `workflow_dispatch`。`db-security-invariants.yml` 不受影响（migrations 是 A 级，人合）。补法：给本 workflow 一个独立的细粒度 PAT（contents + pull-requests 写）去开 auto-merge，合并会记在那个身份下、push workflow 照常触发。本合同不建新凭证，先记缺口。
2. `Risk gate` 每次运行都会读 PR 全部评论（分页 100/页），评论上千条的 PR 会慢，不影响正确性。
3. 只改 `docs/ledger/` 的夜巡 PR：它自己已经跑 `gh pr merge --auto`（PM 的 gh），本检查判它 C 再开一次 auto-merge 是幂等的，行为与 PR #1988 一致。`Detect ledger-only change` 删掉后，台账卡 `2026-09-25-ledger-only-pr-auto-merge` 描述的机制已被 C 判定取代——本 PR 用 `ledger-update.mjs` 给它补 `check_note`（子牙 QUESTION 2）。
4. auto-merge 已开启但一直合不进（Protect main 要求所有 review 线程解决，Codex 留一条线程就挂住）无人感知。后续事项：pm-daily-todo 加"auto-merge 已开超过 N 天没合的 PR"一栏，另开台账卡 `decided`，不在本合同。

## 8. 验收（写进 PR，每条附证据）

| # | 验收 | 怎么证 |
|---|---|---|
| ① | 只改 UI 文案的测试 PR 全绿后无人点击自动合进主干 | 本 PR 合入、§6 设置完成后，开一个只改 `docs/` 一行的测试 PR，记录 `Risk gate` 摘要（C）+ auto-merge 由 `github-actions[bot]` 开启 + 合并时间戳 |
| ② | 改 `src/lib/kernel` 的测试 PR 没有签字标记时合并按钮按不动 | 开一个在 `src/lib/kernel/` 某文件加注释的测试 PR，记录 `Risk gate` 红 + GitHub 合并按钮 disabled 截图；随后关闭不合 |
| ③ | 删 `risk.mjs` 受保护路径一条 → 对应测试红 | 本地：删 `src/lib/kernel/` 那条 → `npx vitest run tools/ops-review-loop/tests/risk.test.ts` 红（**已证 2026-09-25 01:37：102 条中 4 红，恢复后干净**）；再删治理文件那条（`CLAUDE.md`）→ 同样红；CI：`ops-review-loop-tests` 成为必过后同样红 |
| ④ | 伪造一个由 PR 作者写的 gate marker → 被忽略 | 在验收②的 PR 上以 PM 账号（= 作者）留言 `<!-- me-dev-gate:{...,"risk":"C"} -->` 和三条 `me-review-signoff` → 重跑 `Risk gate` → 仍 A、仍红、摘要写"忽略了 4 条非可信身份的标记" |

本地可先做的：③ 全部；①②④ 的纯函数部分（`decideMerge` / `evaluateSignoffs` / `selectTrustedGateMarkers` 的单测）。①②④ 的线上部分只能在合入 + §6 设置后做，PR 描述里分开写"本地已证"和"合入后待证"，不混。

## 9. DeepSeek 分轮（每轮 ≤3 文件，带 `--read` 模板）

| 轮 | 产出 | 模板 |
|---|---|---|
| 0 | `risk.mjs` 治理类别 + `quality.mjs` 证据条目 + `risk.test.ts` 探针 | 三个文件自身 |
| 1 | `signoff-marker.mjs` + `signoff-marker.test.ts` | `gate-marker.mjs` · `gate-marker.test.ts` |
| 2 | `merge-decision.mjs` + `merge-decision.test.ts` | `risk.mjs`（只为形状） |
| 3 | `check-risk-gate.mjs` | `check-fix-scope.mjs` · `github.mjs` |
| 4 | `pr-risk-gate.yml` + `ops-review-loop-ci.yml` | `ops-fix-scope-guard.yml` · `ai-orchestrator-ci.yml` |
| 5 | `risk-gate-workflow.test.ts` | `merge-authorization.test.ts`（删前当模板） |

每轮后：`git diff --stat`、读全 diff、`npx vitest run tools/ops-review-loop`。文档（§2 第 5 条）与台账由构建控制窗口自己改。

## 10. Reuse Statement（预填，交付时对账）

- 复用：`risk.mjs`（定级）、`gate-marker.mjs`（标记 + 可信身份筛选）、`check-fix-scope.mjs` 的分页读文件、`ai-orchestrator-ci.yml` / `ops-fix-scope-guard.yml` 的 workflow 形状、`scripts/ledger-update.mjs`。
- 新增且 platform-shared：签字标记模块、合并决策纯函数、两个 workflow。全是仓库治理层，无行业 / 客户语义。
- industry-specific / client-specific：无。
- shared runtime 里有没有客户名 / 客户 ID：无（`parkhomes-deploy` 只在文档缺口里提到，代码不特判它）。
- 学习升级：无 memory 变更。

## 11. 审核记录

- 2026-09-25 子牙第一轮（设计）：BLOCKER 1 治理文件判 A（已纳入 §2 / 第 0 轮）；CONCERN 1 auto-merge 失败必须可见（§3.3 第 7 条、§7 缺口 4）；CONCERN 2 bypass 关闭条件写死 + 身份现状如实（§6）；CONCERN 3 结构测试三条（§5）；QUESTION fork 立场（§3.3 表）、旧台账卡补 check_note（§7 第 3 条）。结论：BLOCKER 1 补进后可进实施，两轮上限。魏征、狄仁杰意见待汇总。

## 12. 实施状态（2026-09-26 更新）

**已落地（本 PR）**：
- 第 0 轮（治理类别）：`risk.mjs` 新增 `RISK_CATEGORY.GOVERNANCE` 与 7 条规则；`quality.mjs` 补 `governance-evidence`；`risk.test.ts` 加 7 条真实探针 + 「治理文件是 A 但 markdown 里其它 .md 是 C」小节。
- 第 1 轮（签字标记）：`signoff-marker.mjs` 与其测试（builder 转义 + round-trip 自检；`selectTrustedSignoffMarkers` 硬排除 `github-actions[bot]` 与 PR 作者；`evaluateSignoffs` 绑 base+head，head 一动全废）。
- 第 2 轮（合并决策）：`merge-decision.mjs` 与其测试（`decideMerge` 纯函数：草稿 / fork / B/C→auto / A+签字齐→signed/人合 / 其余→blocked）。
- 第 3 轮（接线脚本）：`check-risk-gate.mjs`——`pull_request_target` 下的 fail-closed 入口；`decision=enable` 只在 `pass && tier==='auto'` 时写。
- 第 4 轮（两个 workflow）：`.github/workflows/pr-risk-gate.yml`（`pull_request_target` + `checkout ref: main` + PR 数据只走 env + `gh pr merge --auto/--disable-auto`；`continue-on-error` 禁；`--admin` 禁）· `.github/workflows/ops-review-loop-ci.yml`（把 `ops-review-loop-tests` 变成必过检查）。
- 第 5 轮（结构测试）：`risk-gate-workflow.test.ts`（10 条对 pr-risk-gate.yml + 6 条对 ops-review-loop-ci.yml + 1 条 cross-file）。
- 删：`.github/workflows/pr-merge-authorization.yml` · `tools/ops-review-loop/tests/merge-authorization.test.ts`。
- 规则文档：`.github/merge-authorization.md` 重写；`CLAUDE.md`、`docs/ENGINEERING_QUALITY_GATES.md` §10、`tools/ops-review-loop/README.md` 待接线 PR 说明处理（下面 §13）。

**本地测试证据（2026-09-26 00:19）**：`npx vitest run tools/ops-review-loop` → **435 全绿**，含新增的 signoff/decision/risk-gate-workflow 三套。

**BLOCKER 2 沙盒结果（狄仁杰第一轮）**：验证工作在私有一次性仓库 `bigbigraydeng-maker/me-merge-gate-sandbox` 里进行，零客户数据。规则集 `Risk gate` 单独建成，main 上 `pull_request_target` 判官报红。夹带 PR 因 `gh` GraphQL 内部错误没能开出（`EFC9:2182DC:...`），实测最终结果**未拿到**。选择的处理：
1. 本合同 A 级签字身份 `ME_SIGNOFF_TRUSTED_LOGINS` 变量今天不设 = 谁都不信 = A 级全红。这是"接线前仍问 PM 一句"的机器落点，独立于 job-name spoof 是否成立。
2. `Protect main` 的四道台账/测试检查 + 新加的 `ops-review-loop-tests` 保持 bypass_actors 为空——就算 spoof 成立，那五道也没人能绕。
3. 专属 GitHub App 身份方案（子牙 CONCERN 3 的最终形态）挂到 §13 后续事项，B3 阶段做，不阻塞本 PR。沙盒仓库先留着；PM 说删我再删。

## 13. 后续事项（本合同不做）

- **B3 后半：签字自动写入**。写签字标记必须用一个既不是 `github-actions[bot]`、也不是 PM 登录名的独立机器身份（GitHub App 或独立账号）。届时把 `ME_SIGNOFF_TRUSTED_LOGINS` 指向该身份，才能真让"A 级三方签齐→绿"这条通路走通。
- **job-name spoof 实测**：沙盒仓库里再试一次开 PR（`gh` 那次是 GraphQL 内部错），或走另一条路径（专属 GitHub App 身份，从 `integration_id` 层面区分真判官）。若实测确认能 spoof，接下来的接线 PR（B3 或另开）就得走 App 路线，不留同名 job 抢绿的口子。
- **auto-merge 挂死监控**：pm-daily-todo 加"auto-merge 已开超过 N 天没合的 PR"一栏。
- **CLAUDE.md §2 / §6 与 `docs/ENGINEERING_QUALITY_GATES.md` §10 状态句、`tools/ops-review-loop/README.md` 的 NOT-YET-WIRED 段**：接线 PR 合入后一次性改。本 PR 不动 CLAUDE.md（PM 规则："当用户明确要求项目流程变更时可直接最小修订现有指引"——PM 已授权这次修订，但为避免与在飞的其它 PR 冲突，规则同步单独另开台账卡 `decided`，在本 PR 合入后追随处理）。

## 11. 审核记录

- 2026-09-25 子牙第一轮（设计）：BLOCKER 1 治理文件判 A（已纳入 §2 / 第 0 轮）；CONCERN 1 auto-merge 失败必须可见（§3.3 第 7 条、§7 缺口 4）；CONCERN 2 bypass 关闭条件写死 + 身份现状如实（§6）；CONCERN 3 结构测试三条（§5）；QUESTION fork 立场（§3.3 表）、旧台账卡补 check_note（§7 第 3 条）。结论：BLOCKER 1 补进后可进实施，两轮上限。
- 2026-09-25 狄仁杰第一轮（设计）：BLOCKER 2 job-name spoof（同名 job + GitHub Actions 内置 integration_id），要求沙盒实测；边界 4 条站得住（`pull_request_target`、评论区伪造、规则集互不连带 bypass、auto-merge race）。沙盒验证结果见 §12，处理策略见 §12 第 2 条。
- 2026-09-26 实施完成，进第二轮审核：本 PR 送子牙 + 魏征 + 狄仁杰 二审 diff。
