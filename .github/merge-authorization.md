# 合并规则：机器判级，两档放行

PM 2026-09-25 拍板（台账卡 `docs/ledger/2026-09-25-merge-gate-machine-not-human.md`、
`docs/ledger/2026-09-25-merge-two-tiers-auto-vs-signed.md`）：

> 合并不做"每次 GitHub 点头"的人工闸；分两档。2026-10-25 当晚补了一条：B/C 级
> 不是检查一绿就自动合，要等 Codex 审过**当前这次提交**、且没有未解决的 P0/P1，
> 才打开自动合并。新提交让旧审查作废，并关掉已经打开的自动合并。A 级改为
> Codex Astra 审查 + Claude Code 独立复核，两签齐了才由人合。子牙 / 魏征 / 狄仁杰
> 只抽查 B 级，缺了不挡合并。

以前这里描述的「Merge authorization (Ray)」检查已删除：它依赖一个从未配置 required
reviewer 的 GitHub 环境，5 秒自动通过，也从未进过主干必过清单，所以从未真正拦过任何
一次合并。本文件现在只描述真实存在、真实执行的机制。

## 谁来判级

`.github/workflows/pr-risk-gate.yml` 的检查 **`Risk gate`**。它用 `pull_request_target`
触发，workflow 定义和脚本 `tools/ops-review-loop/src/check-risk-gate.mjs` 都从 `main`
取——一个 PR 改不了判它的那把尺子。它**不检出、不执行 PR 的代码**，PR 只以数据身份进入
（改动文件清单、正文里自报的级别、评论）。

Codex 审完是一条 PR 评论，不是一次推送。那次重判在 `pr-risk-gate-refresh.yml` 里跑，
脚本仍从 `main` 取。评论触发的运行记在主干那次提交上，所以它**不**把任务名叫成
`Risk gate`；判完后用检查接口把同名结果写到 **PR 当前 head**。审过且没有未解决的
P0/P1 就变绿，没审过就保持红。无关评论用单独的分组，取消不了正在跑的判级。

级别由 `tools/ops-review-loop/src/risk.mjs` 按 PR **实际改动的文件**算出
（规则见 `docs/ENGINEERING_QUALITY_GATES.md` §10.1）：

- 命中受保护路径任一条 → **A**（数据库结构、CI 与本闸门、鉴权与隔离、Kernel、钱、
  生产调度、对外发布、凭证、依赖清单，以及 **治理文件**：`CLAUDE.md`、`AGENTS.md`、
  整个 `.github/`、`.claude/`、`docs/ENGINEERING_QUALITY_GATES.md`、`docs/ledger/README.md`、
  `scripts/ledger-*`、`docs/playbooks/` 正文（`inbox.md` 除外））。
- 每一个文件都命中严格低风险清单（文档、样式、图片、纯测试）→ **C**。
- 其余 → **B**。
- 改动清单读不到、为空、rename 说不出原路径 → **A**。PR 正文自报的级别只作下限。

每次判级会在 PR 下留一条评论，末尾带隐藏标记
`<!-- me-dev-gate:{...} -->`，同时绑定 base 与 head 两个 SHA；head 一动即作废。
读标记只认 `github-actions[bot]` 写的（`selectTrustedGateMarkers`），任何人手打的一律忽略，
并在摘要里写明忽略了几条。标记只是记录，检查每次都重新算级，不拿旧标记当输入。

## 两档

| 级别 | `Risk gate` 结果 | 合并方式 |
|---|---|---|
| **B / C** | 级别仍按改动文件算出，写在摘要里。自动合并只在 Codex（变量里 `codex-astra` 那个登录名）审过**当前 head**、且没有未解决的 P0/P1 时才打开；否则这道检查是红的，并执行 `--disable-auto`。抽查缺席不改变这一格。P2 不挡 | 满足上一格才执行 `gh pr merge --auto --merge`。GitHub 仍要等所有必过检查全绿、review 线程全部解决才真正合并。新推送若 Codex 还没审新提交，关掉自动合并，不重新打开 |
| **A** | 只有当 **Codex Astra**（`codex-astra`）和 **Claude Code**（`claude-code`）对**当前 base+head** 各有一条可信签字标记 `<!-- me-review-signoff:{...} -->`，而且两条来自**两个不同登录名**时才绿；否则**红**。旧的子牙 / 魏征 / 狄仁杰 标记不算数 | A 级永不自动合。绿了也要人合 |

另有三种一律红且关闭 auto-merge：草稿 PR、fork 来的 PR、判级过程任何一步读不到。

auto-merge 那一步不允许 `continue-on-error`：`gh` 失败即检查红，摘要写明
"自动合并：已开启 / 已关闭 / 开启失败（原因）"。

## 现阶段行为（如实）

**签字标记的自动写入路径尚未建成**（自治计划 B3 的后半）。可信签字身份来自仓库变量
`ME_SIGNOFF_TRUSTED_LOGINS`。2026-10-25 起它必须写成「角色=登录名」，两个角色还要是
两个不同的人。今天这个变量仍是空的——所以**所有 A 级 PR 的 `Risk gate` 都是红的**。
本次改规则**不改这个变量**。Ray 若要让两签能被认出来，自己把变量设成：

```text
codex-astra=chatgpt-codex-connector[bot],claude-code=claude[bot]
```

这两个登录名是仓库里已经出现过的：Codex 审查来自 `chatgpt-codex-connector[bot]`，
Claude 留言来自 `claude[bot]`。如果实际发签字的账号不是这两个，换成那两个真实登录名，
仍是 `codex-astra=` 和 `claude-code=` 各一个，且不能相同。不要写成旧的逗号名单
（没有等号的登录名一律不认）。不要把任一格写成 `bigbigraydeng-maker`：那个账号通常就是
PR 作者，作者给自己签会被丢掉。`github-actions[bot]` 写了也不信。

设了变量也不会自己变绿：还要这两个身份各自留下绑当前 base+head 的签字标记。自动写入
这条路仍未建成。在那之前，A 级仍由构建控制窗口在聊天里问 PM 一句，PM 决定后用
`gh pr merge --admin` 合。agent 不得自行对 A 级 PR 执行 `--admin`。

B 级可选抽查（子牙 / 魏征 / 狄仁杰，大约五分之一，按 PR 号和提交固定）只出现在摘要里。
他们的标记可以记，缺了不挡 B 级或 C 级。挡自动合并的是另一件事：Codex 还没审当前
head，或审完还留着没解决的 P0/P1。若要让抽查记录被认成可信留言，可在同一
变量末尾另加 `ziya=登录名,weizheng=登录名,direnjie=登录名`，这三项不是必填。

Codex 实际怎么留言（2026-10-24 对 #3086、#3091、#3080 看过）：干净审查不产生
GitHub「审查」对象，而是两条 PR 评论。能绑定提交的是评论里的
`codex-review-state:v1`，里面的 `commit_sha` 是完整 40 位。收据那句
「Didn't find any major issues」只带短提交号，不能单独当审查。有意见时才会
另开一条审查，行内评论用色块标 P0/P1/P2。只有没解决的 P0/P1 挡住自动合并。

## 主干规则集（仓库设置，PM 合并接线 PR 时一并授权）

- `Protect main`：必过检查 `ai-orchestrator-tests` · `Ledger entries valid` ·
  `Code change has ledger entry` · `Ledger refs exist` · **`ops-review-loop-tests`** ·
  **`Kernel architecture test`** · **`Tour catalog boundary test`**。
  这些名字现在由 `.github/workflows/pr-light-checks.yml` 在检查真正跑完之后上报
  （任务名不是这些字符串：跳过的任务会被记成通过，草稿不能因此变绿）。
  没有 bypass actor：这些红了，管理员也合不进——**前提是检查产生的状态本身没被同一个 PR
  伪造**，见下面「已知缺口」。
- **`Application build` 不再是自动检查**（2026-10-24）。它以前必过，是因为 2026-09-25
  PR #2016 开着 auto-merge，编译还在跑时就被合进主干，之后约 7 小时每次上线都失败。
  现在每次上线仍由 Render 再编一次；GitHub 上不再为每个 PR 编一整遍。
  **Protect main 里必须删掉 `Application build`**，否则每个 PR 都会一直等一个不会再出现的检查。
  全仓类型检查同样不在每个 PR 上跑（`next.config.js` 编译时本来就忽略类型错误）。
  要对手动一个 PR 跑类型检查和编译：Actions 里手动运行 `PR Application Validation`。
  数字和 Ray 要点的设置见 `docs/ops/2026-10-24-actions-minutes.md`。
- `Kernel architecture test` 测的是「主干 + 本 PR」合并后的代码，只在推送时按当时的主干算一次，
  主干后来变了不会自己重跑（规则集不要求分支先跟上主干）。所以 A 级 PR 手动 `--admin` 合并前，
  先 `gh pr update-branch`，等这道检查在最新主干上重新变绿再合。
- **`Risk gate`**（新建的独立规则集）：只含必过检查 `Risk gate`；bypass actor =
  Repository admin。之所以单列：`--admin` 只绕过把你列为 bypass 的那个规则集，
  `Protect main` 的这几道照样拦。
- **关闭条件（写死）**：两方签字的自动写入上线、`ME_SIGNOFF_TRUSTED_LOGINS` 按角色指向
  Codex Astra 与 Claude Code 两个不同登录名之后，撤掉 `Risk gate` 规则集的 bypass
  （或把它并入 `Protect main`）。不撤，这个口子永久存在。
- 环境 `merge-authorization` 已无 workflow 引用，可删。

## 已知缺口

- 用 `GITHUB_TOKEN` 开的 auto-merge，合并后**不会触发** `on: push` 的 workflow
  （GitHub 防递归规则）。今天只影响 `parkhomes-deploy.yml`：Park Homes 网页改动
  （`docs/clients/parkhomes/web/`，C 级）自动合进主干后不会自动部署，要手动
  `workflow_dispatch`。补法是给 `Risk gate` 一个独立的细粒度 PAT；那是新凭证，由 PM 决定。
- auto-merge 已开启却因 review 线程未解决等原因一直合不进，本检查看不见。后续事项：
  今日待办加一栏"auto-merge 开了超过 N 天没合的 PR"。
- 上面列出的轻检查都用 `on: pull_request` 触发，执行的是
  **PR 分支自己那份** workflow 定义。一个 PR 只要同时把检查步骤换成必然成功的空壳、保留检查名
  不变，产出的绿勾仍来自同一个 GitHub Actions `integration_id`，`Protect main` 分不出真假。
  上报这些名字的脚本优先从 `main` 取出，所以**不改 workflow 文件**的 PR 不能自己给自己发绿勾；
  改了 `.github/workflows/pr-light-checks.yml` 的 PR 仍然可以改上报方式。
  这类改动碰了 `.github/`，会被判 A 级、要 PM 在聊天里点头才合；所以今天「这几道检查绿了 =
  真的编译/测试通过了」是流程上的信任，不是机制上的保证。修法另开任务设计并两审，这里不预设方案；
  注意**不能**简单改成 `pull_request_target` 检出 PR head 来构建（见 `pr-risk-gate.yml` 顶部注释），
  也不能只把现有可伪造的结果原样转发成另一个检查。台账：`docs/ledger/2026-09-27-application-build-check-not-tamper-proof.md`。

## 这道闸不做的事

不直接合并、不推送、不部署、不发布、不碰任何付费服务。`gh pr merge --auto` 只是
给 GitHub 一个"检查全绿后合"的许可，合并动作由 GitHub 按规则集执行。
