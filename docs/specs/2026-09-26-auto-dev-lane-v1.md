# 自动开发车道 v1 —— P2/P3 小活不问 PM，每天自己捡、自己写、自己合

状态：**v0.3 · 设计审放行**（v0 → v0.3 经魏征 + 狄仁杰三轮；两人第三轮均为「修掉最后一条即放行」，子牙已按其修法落地并实测，处置见 §0 / §0b / §0c）· 作者：子牙 · PM 2026-09-26 要求（「出个方案，代码 DeepSeek 负责」）
Repository Fact Gate：`origin/main` = `ca222b00` · fetched 2026-09-26 13:29 NZST
风险级：**A**（实施 PR 碰 `tools/ops-review-loop/`；车道产出会无人值守合进主干并部署）
§11：频率高（P2/P3 积压每天在长）/ IMPACT 中 / 收入低 → 恰好一个低、一个高 → **P2**
Tier：内部工程流程，不是 ME 产品能力；不进 6 支柱，不登记 platform-candidates。

---

## 0. v0 → v0.1 审查处置

| 编号 | 问题 | 裁定 | 落点 |
|---|---|---|---|
| WL-1 | `classifyRisk` 要 `[{filename}]` 对象，传字符串全判 A；R5 自保护测试是空的 | BLOCKER，子牙实测成立 | §4 #5、§9 R5 验收 |
| WL-2 | `claude/*` 分支会被 Codex 自动审、Claude 自动修并推送，绕过本地闸 | BLOCKER，核实 `ops-codex-request-review.yml` / `ops-codex-to-claude-fix.yml` 成立 | 分支前缀改 `auto-dev/` |
| WL-3 + DR-1 | 生成的测试 / 构建在 PM 机器上带 `.env.local` 和 gh 管理员凭证执行；aider 可能把密钥发给 DeepSeek | BLOCKER，协作者 / 凭证权限子牙实测成立 | §3 工作副本无密钥、§5.1 断网沙箱、§4 #1 可信作者 |
| WL-4 | 失败卡 / 刹车卡不在主干，今日待办与夜巡看不见；锁不释放 | BLOCKER | §6 失败卡走台账专属 PR、§3 第 0 步维护 |
| WL-5 + DR-2 | B 级范围太宽（广告预算、CMS、页面改写、无鉴权新接口都判 B） | BLOCKER，middleware matcher 不含 `/api` 子牙实测成立 | §4 #6 目录白名单 + §5.2 内容禁令 |
| DR-3 | PM 身份是管理员，能被诱导 `--admin` / 改仓库变量 | 降为 CONCERN：外部注入源已被 §4 #1 切断；剩余风险用命令拦截钩子挡，B3 独立身份建成后换身份 | §5.4、§11 |
| DR-4 / DR-5 | `next.config.js`、`vitest.config.ts`、`tsconfig.json`、`.npmrc`、根目录 `.env.production` 判 B | CONCERN，是主干判级闸的现存缺口；ME2.0 复现并扩大了清单，派合并闸窗口单独 A 级 PR 修 | 车道 R5 以该 PR 合并为开工前提 |
| WL-6 | 只比改动文件的类型错误查不到调用方；测试由 DeepSeek 自出自判 | CONCERN | §5.3 等 `PR Application Validation`（全项目类型检查 + 构建）+ `vitest related` |
| WL-7 / DR-7 | 验证命令能塞 `-u`、`--watch`；无超时 | CONCERN | §4 #7 收紧 + 每条命令限时 |
| WL-8 | 闸脚本跑在被改过的副本里 | CONCERN | 闸一律从主干只读副本运行 |
| WL-9 | 独立审查者在 bypass 模式下可能仍有 Bash | CONCERN，未实测 | §9 验收加一条实测 |
| WL-10 / DR-6 | 任务单原文进 `verify_how`，被夜巡当指令执行 | CONCERN | §5.5 固定模板 |
| WL-11 | 主干一动，PR 判定作废、自动合并被关 | CONCERN，核实 `check-risk-gate.mjs:222` 成立 | §3 第 0 步维护 |
| DR-8 | `git diff` 看不到被忽略文件的改动 | CONCERN | §5.2 #1 用 `git status --porcelain --ignored` 前后对比 |
| DR-9 / DR-10 / WL-12 | aider 抓网址、标签被反复摘、`verify_by` 算不出、无 `node_modules` | NOTE | 逐条落进 §3/§5 |

## 0b. v0.1 → v0.2 复核处置

| 编号 | 问题 | 裁定 | 落点 |
|---|---|---|---|
| DR-11 | 「放行本机 unix socket」让 DNS 经 mDNSResponder 出网 | BLOCKER，子牙实测复现（`dns.lookup` 解析成功）；改成 `(deny network*)` 不放任何 socket 后 DNS 被挡、`fork` IPC / worker / 真实 vitest 11 测全过 | §5.1 |
| DR-12 | 秘密经修复轮 / 任务单评论 / PR 正文等汇报渠道流出 | BLOCKER → 根治：沙箱内读不到任何秘密（整个用户目录拒读，子牙实测 `.env.local` / `.zsh_history` / `~/.config` 全 EPERM，钥匙串 `security` 退出 71，`gh auth token` 失败）；另加出沙箱输出扫描 | §5.1、§5.2 #5 |
| DR-13 | `git status` 对比看不到内容变化 | BLOCKER | §5.2 #1 改为内容哈希；密钥扫描移到所有执行之后、提交之前 |
| N-1 | 沙箱不拦写：可写共享 `.git`（fsmonitor / hooks）或 `~/.claude/settings.json` | BLOCKER | §5.1 整个用户目录拒写；工作副本放 `/private/tmp/auto-dev/`；git 命令强制 `-c core.fsmonitor= -c core.hooksPath=/dev/null`；前后核对主仓库 `.git/config` 与 hooks 哈希 |
| WL-5 / DR-15 | 白名单只看路径不看调用方；`crm/` 被私信机器人拒联判定引用；内容禁令可拼字符串绕过 | BLOCKER | §4 #6 v1 白名单只留 `src/lib/pm-todo/`；新增「被改文件的所有引用方也须在白名单内」 |
| N-2 | 「任意 `__tests__`」含必过台账检查本体；DeepSeek 会改测试让它变绿 | BLOCKER | 只许在白名单源目录下**新增**测试文件，不许改已有测试 |
| DR-16 | `docs/ROADMAP.md` 等被所有会话开工必读 | CONCERN | v1 白名单去掉整个 `docs/` |
| DR-17 / C-2 | 失败卡带原始报错 → 注入夜巡 / 撞 10 位数字禁令让台账 PR 永远红 | CONCERN | §6 失败卡只写固定模板 |
| C-1 | `verify_by: 明天` 要后天才上待办 | CONCERN | 改为当天 |
| C-3 | 钩子「只对车道生效」无证据 | CONCERN | §5.4 按工作目录判定 + 实施验收实测 |
| NOTE | 评论里的 `@claude` 会触发 `claude.yml` | 接受 | 车道写出的一切文字去掉 `@` 提及 |
| DR-3 | 狄仁杰复核接受降为 CONCERN | — | — |

## 0c. v0.2 → v0.3 复核处置

两人确认已消化：DR-1、DR-11、DR-12、DR-13（机制本身）、WL-5、N-2。

| 编号 | 问题 | 裁定 | 落点 |
|---|---|---|---|
| N-1（续） | 沙箱只拒写用户目录；`/opt/homebrew/bin`（`node`/`gh`/`aider` 所在，属 PM 账号可写）与 `/private/tmp` 其他目录仍可写，测试可把 `gh` 换成恶意程序，车道下一步在沙箱外调用 | BLOCKER，子牙实测 `/opt/homebrew/bin` 为 `drwxrwxr-x raydeng` | §5.1 改为**写入默认全拒**，只放工作副本、专用临时 HOME / TMPDIR。子牙实测：写 `/opt/homebrew/bin`、`/private/tmp`、其他会话临时目录均 EPERM；真实 vitest 95 测通过 |
| N-3 | 沙箱命令起的后台子进程在检查全部跑完后再改工作区，改动随提交推送（子进程存活已由狄仁杰实测） | BLOCKER | §5.2 改为**先提交、再对该提交做全部检查、按提交 SHA 推送**；另外按进程组清理残留 |
| N-4 | 沙箱可写 `/private/tmp` 任意处，能改车道提示词 / 日志 / 闸脚本 | CONCERN，已随 N-1 写入全拒消化 | 主干只读副本、提示词、日志一律放用户目录下 `~/.claude/scheduled-tasks/auto-dev-lane/`（沙箱不可读写） |
| 魏征 C | `/private/tmp` 重启清空，车道可能无声停摆 | CONCERN | 定时任务工作目录放 `~/.claude/scheduled-tasks/auto-dev-lane/`；§7 加心跳 |
| 魏征 C | 钩子按工作目录判定，会话 `cd` 后失效 | CONCERN | §5.4 改按会话记录路径判定 |

## 1. 一句话

每天一次，一个无人值守会话挑 ≤2 张**由 PM 账号开、PM 账号贴标签**、写清楚了、只碰白名单目录的 P2/P3 任务单；DeepSeek 在**没有任何密钥**的工作副本里写代码；测试在**断网、读不到钥匙**的沙箱里跑；先开草稿 PR，等 GitHub 上的全项目类型检查和构建变绿、独立审查通过，再转正交给判级闸自动合。任何一步不过：不合，任务单标「要人接手」，失败卡当天进主干台账。

## 2. 复用的零件

| 需要 | 现成的 | 位置 |
|---|---|---|
| 定时醒来 | Claude 本机定时任务（台账夜巡同款） | `ledger-nightly-verify` 为先例 |
| 无人值守不卡权限 | `defaultMode = bypassPermissions` | `~/.claude/settings.json` |
| 写代码 | aider → DeepSeek 一次性配方 | 记忆 `reference-aider-deepseek-oneshot-recipe` |
| 判级 | `classifyRisk({ files: [{ filename }] })` | `tools/ops-review-loop/src/risk.mjs:303` |
| B/C 自动合、A 永不自动合 | `Risk gate` 必过检查 | `pr-risk-gate.yml` · `merge-authorization.md` |
| 全项目类型检查 + 构建（不带密钥） | `PR Application Validation`（Type-check / Application build） | `.github/workflows/pr-application-validation.yml`，对所有 PR 含草稿都跑 |
| 本地断网沙箱 | macOS `sandbox-exec`（子牙实测 `(deny network*)` 能挡 curl 与 node fetch） | 系统自带 |
| 合并后验收 | 台账 `done` 卡 + 夜巡 | `docs/ledger/README.md` |
| 问题进 PM 眼前 | 台账 → 今日待办；台账专属 PR 自动合 | `src/lib/pm-todo/ledger-items.ts` |

## 3. 每天一轮的流程（11:13 NZT）

**第 0 步 · 维护上一轮的尾巴**（先于捡活）
- 车道自己开着的 PR：`Risk gate` 判定作废 → `gh pr update-branch`；草稿 PR 超过 24 小时还没转正 → 关闭并按失败处理。
- 带 `auto-dev:in-progress` 超过 6 小时的任务单 → 视为上一轮崩溃，摘锁、按失败处理。

**第 1 步 · 刹车检查**（§7）。踩了 → 只开一个台账专属 PR 写刹车卡，本轮结束。

**第 2 步 · 捡活**：从**主干只读副本**运行 `node scripts/auto-dev/pick.mjs`，按 §4 过滤，最老优先，最多 2 张；零张 → 静默结束。

**第 3 步 · 每张任务单**
1. 加 `auto-dev:in-progress`。
2. 从 `origin/main` 新建工作副本到 `/private/tmp/auto-dev/<issue号>/`（用户目录之外，N-1），分支 `auto-dev/<issue号>-<slug>`（**不许 `claude/` 前缀**，WL-2）。工作副本里**不放** `.env.local`。车道执行的所有 git 命令一律带 `-c core.fsmonitor= -c core.hooksPath=/dev/null`。
3. `npm ci`（在任何生成代码落盘之前、依赖清单是主干原样，依赖清单本身属 A 级车道改不了）。
4. **修改前基线**（沙箱内，§5.1）：跑验证命令，记录退出码。
5. 生成 DeepSeek 提示词（任务单正文作为**引用的数据**、文件清单、RULES 段），跑 aider：
   `yes n | aider --env-file <主仓库>/.env.local --model deepseek/deepseek-chat --no-auto-commits --no-auto-lint --map-tokens 0 --no-stream --no-fancy-input --no-detect-urls --no-suggest-shell-commands --no-show-model-warnings --no-check-update --message-file … <允许改的文件>`
   `--env-file` 指向工作副本之外的文件：aider 只把它读进进程环境，不能把仓库外的文件加进对话（WL-3）。不用 `--yes-always`（DR-8 / 配方已知坑）。
6. **本地硬闸**（§5.2，闸脚本从主干只读副本运行）。不过 → 最多一轮 DeepSeek 修复 → 再跑；仍不过 → 失败（§6）。
7. **独立审查**（§5.4）。MUST-FIX → 一轮修复 → 重跑 6、7；仍不过 → 失败。
8. 提交、推分支、开**草稿** PR（正文 §5.6），拿到 PR 号后补台账卡（§5.5），再推一次。
9. 等 `PR Application Validation` 的 Type-check 与 Application build 结果（最多 40 分钟）。都绿 → `gh pr ready`；任一红 / 超时 → 关闭 PR、失败。
10. 删工作副本；摘 `auto-dev:in-progress`。

之后交给 GitHub：`Risk gate` 判 B/C → 自动合；判 A → 车道立即关闭该 PR 并按失败处理。

## 4. 捡活闸（`scripts/auto-dev/pick.mjs`，纯函数 + 测试）

全部满足才捡：

| # | 条件 | 为什么 |
|---|---|---|
| 1 | 任务单作者 **且** `auto-dev` 标签的贴标人（issue timeline 的 `labeled` 事件 actor）都在 `TRUSTED_AUTHORS`（v1 = PM 账号一个） | 切断外部写协作者的注入（DR-1）。所有 agent 窗口也用 PM 账号，信任级与车道相同 |
| 2 | 开着、带 `auto-dev`、不带 `auto-dev:in-progress` / `auto-dev:needs-human` | 上锁与退出 |
| 3 | 正文 6 段齐全非空：目标 / 验收 / 允许改的文件 / 不做 / 验证命令 / 优先级 | 写不清楚的活机器做不对 |
| 4 | 优先级 P2 或 P3，且写出 §11 三维打分 | 只接 PM 授权的档 |
| 5 | 允许改的文件 1–6 个；`classifyRisk({ files: 允许改的文件.map(f => ({ filename: f, status: 'modified' })) }).risk` ∈ {B, C} | 事先会判 A 的不捡（WL-1 调用方式） |
| 6 | 每个文件都命中**车道白名单**（`scripts/auto-dev/allowlist.mjs`）。v1 只有一块：`src/lib/pm-todo/**` 的源文件（不含 `ledger-items.ts`），外加该目录下**新建**的测试文件；已有测试文件不许改（N-2）。另外，每个被改源文件在主干上的**全部引用方**（按 import 反查）也必须落在白名单内或 `src/app/api/cron/pm-*`（WL-5） | 白名单而非黑名单：今日待办只给 PM 自己看，不外发、不花钱、客户看不见。CRM、`docs/`、测试以外的一切 v1 都不接（WL-5 / DR-15 / DR-16）；跑满两周、有证据后扩，扩白名单 = 改 `scripts/auto-dev/` = A 级复审 |
| 7 | 验证命令每行完全匹配：`npm test -- <路径>`，路径必须是「允许改的文件」里的某个测试文件或主干上已存在的测试文件，不以 `-` 开头、不含 `..`、只含 `[A-Za-z0-9._/@-]`。v1 只许这一种命令 | 任务单正文是不可信输入（DR-7 / WL-7） |
| 8 | 没有其他开着的 PR 改到同一个文件 | 唯一写入者 |
| 9 | 「验收」不含生产库 / 外部接口 / 线上页面类措辞（关键词表在 allowlist.mjs） | 车道只有本地证据 |

不捡的单子：原因写回评论，同一原因只评一次。

## 5. 出车道前的闸

### 5.1 沙箱（DR-1 / WL-3 / DR-11~14 / N-1）
所有执行生成代码的步骤（基线、验证命令、`vitest related`）一律：
`env -i PATH=… HOME=/private/tmp/auto-dev/<n>/home TMPDIR=/private/tmp/auto-dev/<n>/home/tmp NEXT_TELEMETRY_DISABLED=1 sandbox-exec -f <主干只读副本>/scripts/auto-dev/sandbox.sb <命令>`，每条放进独立进程组，限时 10 分钟（Mac 无 `timeout`，用 `perl -e 'setpgrp; alarm 600; exec @ARGV'`），结束后杀整组，并清理命令行含该任务目录的残留进程。
`sandbox.sb` 规则，**全部已由子牙在本机实测**：
- `(deny network*)`，**不放行任何 socket**（放行本机 socket 会让 DNS 出网；狄仁杰实测此写法也挡住本机 unix socket 连接）；
- 拒绝执行 `/usr/bin/security`，拒绝连钥匙串服务（`com.apple.SecurityServer` / `com.apple.securityd.xpc` / `com.apple.security.agent`）；
- 整个用户目录**拒读**；
- **写入默认全拒** `(deny file-write*)`，只放行本任务工作副本 `/private/tmp/auto-dev/<n>/repo/`（不含其 `.git` 指针文件）、`/private/tmp/auto-dev/<n>/home/` 与 `/dev/null`、`/dev/tty`（N-1）。TMPDIR 必须指向专用目录：系统临时目录的真实路径带 `/private` 前缀，按字面写会被拒。
实测结果：`fetch` 与 `dns.lookup` 均被拒；`security find-generic-password` 退出 71；`gh auth token` 失败；`.env.local` / `~/.zsh_history` / `~/.config` 读取均 EPERM；写 `/opt/homebrew/bin`、`/private/tmp`、其他会话临时目录均 EPERM；子进程 IPC、worker 线程与真实 vitest（95 测）正常通过。
车道的主干只读副本、提示词、aider 日志、运行记录一律放 `~/.claude/scheduled-tasks/auto-dev-lane/`，沙箱不可读写（N-4）。
跑完核对（沙箱外，git 命令带上面的防护参数）：工作副本内所有文件内容哈希与跑之前一致（DR-13）；主仓库 `.git/config`、`.git/hooks/`、`.git/worktrees/<n>/` 的哈希不变（N-1）。
构建与全项目类型检查不在本机跑，交给 GitHub 上不带密钥的 `PR Application Validation`。
自检：每轮开工先在沙箱里试一次出网和读 `.env.local`，**任一成功即刹车**（沙箱失效时车道必须停，不许退化成无沙箱运行）。

### 5.2 本地硬闸（`scripts/auto-dev/gates.mjs`，从主干只读副本运行，WL-8）
**顺序（N-3）**：沙箱步骤全部结束并清理进程组 → 在工作副本**先提交**得到 SHA → 用 `git archive <SHA>` 把这个提交解到一个沙箱不可写的新目录 → 下列 1–4、7 条与独立审查都针对**这个提交**做 → 通过后 `git push origin <SHA>:refs/heads/auto-dev/<…>`，按 SHA 推，不推工作区。第 5 条的测试结果以同一 SHA 的内容为准（跑测试前后内容哈希一致，且与该 SHA 一致）。
任一不过 = 不开 PR：
1. 按**文件内容哈希**（含被忽略文件）前后对比得出的改动集合 ⊆ 允许改的文件 + 车道自己的台账卡（DR-8 / DR-13）；不许改已有测试文件（N-2）。
2. 改动文件判级 ∈ {B, C}，且每个都命中 §4 #6 白名单。
3. 改动行数 ≤ 400；不新建 `route.ts` / `page.tsx` / `layout.tsx`。
4. 新增行内容禁令（DR-2）：`process.env`、`fetch(`、`axios`、`http.`/`https.` 请求、`child_process`、`execSync`、`fs.write`、`.insert(`、`.update(`、`.upsert(`、`.delete(`、`.rpc(`、`any`、`@ts-ignore`、`@ts-nocheck`、`as unknown as`。
5. 验证命令 + `npx vitest related <改动的源文件> --run`（沙箱内）全部退出码 0（WL-6：跑受影响的既有测试，不只 DeepSeek 自己写的）。
6. 本任务 DeepSeek 花费 ≤ $0.50（读不到按超额）。
7. **最后一道，在所有执行步骤之后、提交之前**（DR-13）：密钥扫描覆盖最终改动内容 **以及**任何将离开车道的文字（发给 DeepSeek 修复轮的报错、任务单评论、PR 正文）——不含长随机串 / 已知密钥前缀（`sk-`、`ghp_`、`github_pat_`、`eyJ` JWT 等）；命中即整张任务单失败且不外发原文（DR-12）。所有外发文字去掉 `@` 提及。

### 5.3 GitHub 上的闸
草稿 PR 上的 `PR Application Validation`：Type-check（全项目、带基线对比）与 Application build 都绿，才 `gh pr ready`（WL-6）。之后 `Risk gate` 与 `Protect main` 五道照常。

### 5.4 独立审查与身份约束
- `claude -p` 只读审查：`--disallowedTools Bash Edit Write NotebookEdit`，工作目录是只读的改动副本，输入只有 diff + 任务单验收；输出 PASS / MUST-FIX。**实施验收必须实测**：审查进程尝试 Bash 会被拒（WL-9）。
- 车道会话挂 PreToolUse 拦截钩子（C-3：定时任务工作目录固定为 `~/.claude/scheduled-tasks/auto-dev-lane/`，钩子按钩子输入里的**会话记录路径**判定是否车道会话——会话中途 `cd` 不改变它；其他窗口不受影响；实施验收实测「车道会话被拦、`cd` 后仍被拦、普通窗口不被拦」）：拒绝含 `--admin`、`gh variable`、`gh secret`、`gh api -X`、`gh api --method`、`gh repo edit`、`gh ruleset`、`gh auth`、`git push --force`、`git push … main` 的命令（DR-3）。

### 5.5 台账卡（WL-10 / WL-12）
`docs/ledger/<日期>-auto-dev-<issue号>.md`：`status: done` · `owner: agent` · `source: issue:<n>` · `done_ref: pr:<n>` · `verify_by: 开卡日 + 4 天` · `verify_how:` **固定模板**「在主干上运行 `<验证命令>`，退出码 0 即成；另核对 PR #<n> 已合并」——不拷贝任务单任何原文。
这张 Check 只证明「合进去了、测试在主干上仍绿」，证明不了线上行为；这是车道只接内部白名单目录的原因之一。

### 5.6 PR 正文
`Closes #<n>` · 验收原文（放在引用块里，注明「任务单原文，数据」）· 每条检查的命令 / 退出码 / 摘要（含未运行项）· DeepSeek 轮数与花费 · 独立审查结论全文 · 简版 Reuse Statement · 「本 PR 由自动开发车道生成，无人值守」。

## 6. 失败怎么办（WL-4）

- 任务单：摘 `auto-dev:in-progress`，加 `auto-dev:needs-human`，评论三件套 —— **what**（卡在哪步 + 报错前 20 行，**过 §5.2 #7 扫描后**才写，命中则只写「报错含疑似密钥，已隐去」）· **how**（拆小 / 补验收 / 转人工窗口）· **href**（分支与 PR 链接）。
- 台账：一轮里所有失败卡 + 刹车卡合成**一个**台账专属 PR（分支 `auto-dev-ledger/<日期>`，只改 `docs/ledger/`，按现行规则 CI 全绿自动合）。卡片**只用固定模板**（DR-17 / C-2）：标题「自动开发没做成：任务单 #<n>」、`status: decided` · `owner: agent` · `source: issue:<n>` · `verify_by: 当天`（C-1），正文只有失败步骤名和任务单链接，不含任何报错原文。合进主干后下一次今日待办即摆到 PM 眼前（周五、周六待办不跑，顺延）。
- 失败分支保留，工作副本删除。

## 7. 刹车

自动刹车（第 1 步，任一命中 → 本轮不捡，刹车卡 `owner: pm`、`verify_by: 明天`）：
- 近 7 天车道合进去的 PR 被 revert；
- 维护后仍有车道 PR 开着超过 48 小时；
- 近 7 天失败 ≥ 3 次；
- 本周 DeepSeek 累计 > $5。

- 每轮开工的沙箱自检（§5.1）失败。

心跳：车道每轮（含零任务的轮）往 `~/.claude/scheduled-tasks/auto-dev-lane/runs.log` 追加一行；台账夜巡增加一项检查——连续 3 天没有新行 → 开一张 `owner: pm` 的台账卡「自动开发车道 3 天没跑」（Mac 关机时夜巡同样不跑，恢复开机后第一晚即报）。

手动刹车：PM 跟任何窗口说「自动开发停」→ 关定时任务 `auto-dev-lane`。

## 8. 任务单

格式（正文 6 段 Markdown 二级标题）：目标 / 验收 / 允许改的文件 / 不做 / 验证命令 / 优先级（带 §11 打分）。
- 开单与贴标签：必须用 PM 账号（即任何本机窗口）；外部协作者开的单车道不捡。
- 首批：子牙从 ROADMAP 现有 P2/P3 挑 3–5 条改写试跑（如「`settledLookupFailures` 没有消费者」→ `src/lib/pm-todo/manual-monitoring-items.ts`）。进不进车道以捡活闸为准。

## 9. 实施合同（写入者：构建控制派出的实施窗口，分支 `feat/auto-dev-lane`，DeepSeek 执行，一个 A 级 PR；统筹窗口不写代码）

| 轮 | 文件 | 谁写 |
|---|---|---|
| R1 | `scripts/auto-dev/pick.mjs` + `allowlist.mjs` + 测试：§4 九条 | DeepSeek |
| R2 | `scripts/auto-dev/gates.mjs` + 测试：§5.2 第 1–5、7 条纯函数、验证命令解析、aider 花费解析 | DeepSeek |
| R3 | `scripts/auto-dev/brake.mjs` + 测试：§3 第 0 步判定 + §7 四条（输入为 `gh` JSON） | DeepSeek |
| R4 | `scripts/auto-dev/sandbox.sb` + `lane-prompt.md`（定时会话操作手册，§3 逐步命令与失败分支）+ 拦截钩子脚本 | Claude Code 自写（CLAUDE.md §5 例外②：合并闸 / 不可逆副作用） |
| R5 | `tools/ops-review-loop/src/risk.mjs`：只加一条 `scripts/auto-dev/` → A（CONTROL_PLANE）+ 测试。**开工前提**：合并闸窗口的判级缺口 PR（DR-4/5 及其扩展清单：根 `.env*`、`.gitignore`、`middleware.ts`、`instrumentation.ts`、`Dockerfile`、各类 config、`.husky/**` 等）已合进主干，本分支先 merge 主干再写，不重复带那些规则 | Claude Code 自写（例外②） |
| R6 | 合并后：本机定时任务 `auto-dev-lane`（工作目录 `~/.claude/scheduled-tasks/auto-dev-lane/`；SKILL.md 一句话：刷新该目录下的主干只读副本、读其中 `scripts/auto-dev/lane-prompt.md` 照做）；挂 R4 钩子；建三个标签；夜巡 SKILL 加心跳检查一项 | 实施窗口 |

验收（每条带真实证据）：
1. `npm test -- scripts/auto-dev tools/ops-review-loop` 全过；测试断言 `scripts/auto-dev/pick.mjs` 在加 R5 规则前判 B、加后判 A（WL-1）。
2. 沙箱实测（用 `scripts/auto-dev/sandbox.sb` 原文件，工作副本在 `/private/tmp/auto-dev/`）：`fetch` 与 `dns.lookup` 被拒；`security` 与 `gh auth token` 拿不到值；读 `.env.local`、写 `~/.claude/settings.json`、写主仓库 `.git/config`、写 `/opt/homebrew/bin`、写 `/private/tmp` 其他目录全被拒；真实 vitest 在该工作副本通过。
2b. 后台进程实测（N-3）：测试里起一个延迟 60 秒再改允许改文件的脱离子进程 → 推送的提交里不含该改动（按 SHA 推送），且该进程在清理步骤后不存在。
3. 审查进程实测：让它执行 Bash 被拒（WL-9）。
4. 钩子实测：车道会话里 `gh pr merge --admin 1` 被拦；普通窗口不受影响（C-3）。
5. 试跑五张任务单：①外部协作者开的单 → 不捡；②允许改的文件含 `src/app/api/x/route.ts` → 不捡（白名单）；③验证命令 `npm test -- -u` → 不捡；④要改已有测试文件 → 不捡；⑤合格的一张（`src/lib/pm-todo` 下新增一个测试文件）→ 草稿 → Validation 绿 → 转正 → 自动合 → 台账卡 `done`。
6. 失败路径试跑：故意让一张任务单测试失败 → 任务单评论三件套 + 台账专属 PR 自动合 → 当天卡片可被 `ledger-items.ts` 读到。

复审：本设计 v0.1 → 魏征 + 狄仁杰复核 BLOCKER 是否消化；实施后 子牙 + 魏征 + 狄仁杰。合并按 A 级：构建控制问 PM 一句，PM 同意后 `--admin`。**这是车道唯一一次需要 PM 点头。**

## 10. 子牙七问自答（`docs/agents/10-ziya.md` §四b）

1. **与现有架构矛盾吗？** 不矛盾。串起两档合并闸、台账、DeepSeek 默认写代码三条现行规则。分支不用 `claude/`，所以不进入 Codex 自动修车道，唯一写入者是车道会话本身（§5）。§4「≥2 审」：B/C 由本地独立审 + GitHub 全项目检查 + 判级闸把关，符合两档制对 B/C 的既定口径；白名单外的活不进车道。
2. **Memory Layer 写权限？** 不写。
3. **输入为空 / 格式错 / 超大量？** 无任务静默；格式错评论原因；每轮最多 2 张；`gh` 读失败整轮不做。任务单正文一律当数据，安全边界在结果检查（改动集合、判级、白名单、内容禁令、沙箱），不在提示词。
4. **依赖哪些假设？** Mac 11:13 开着联网（否则当天不跑、不补）；`bypassPermissions` 保持；`sandbox-exec` 可用（macOS 已标记弃用但 26.6 仍可用，**若将来移除，车道必须停而不是退化成无沙箱运行**——pick 前先自检沙箱能挡网，挡不住即刹车）；DeepSeek / Anthropic 可用。与 AU/NZ 市场无关。
5. **6 个月后瓶颈？** 瓶颈是写得清楚的任务单与白名单宽度，不是算力。白名单扩容走 A 级复审；离开 Mac 需把车道搬到 GitHub Actions，DeepSeek 钥匙进仓库密钥是新凭证，由 PM 决定。
6. **权限矩阵影响？** 新增一个无人值守写入者，权限 ≤ 构建控制窗口：不能合 A、不碰生产库、命令钩子拦 `--admin` 等管理动作。仍与所有窗口共用 PM 的 gh 身份（§11）。
7. **失败谁先感知？回滚？** 本地或 GitHub 闸不过 → 次日今日待办；合进去后出问题 → 夜巡按模板核验翻 `failed` → 次日待办；回滚 = revert PR（B/C 自动合）并触发自动刹车。白名单只含内部可见目录，客户不应是第一个发现者。

## 11. 已知缺口（如实）

- **同一个 gh 身份**：钩子是字符串匹配，挡得住误执行和浅层注入，挡不住刻意混淆；外部注入源已被 §4 #1 切断。根治 = B3 建成的独立机器身份（细粒度、非管理员），届时车道换用。
- **判级闸现存缺口**（DR-4/5）影响的是所有 PR，不只车道；由合并闸窗口单独修，车道 R5 等它先合。
- **Mac 睡着不跑**：接受。
- **Check 只证明测试在主干上仍绿**，不证明线上行为：接受，靠白名单把车道限制在内部可见目录。
- **花费刹车只算 DeepSeek**：审查模型走订阅额度，不计。

## 12. Reuse Statement

- 复用：两档合并闸 + `classifyRisk`、`PR Application Validation`、台账 + 夜巡 + 今日待办台账栏 + 台账专属 PR 自动合、aider→DeepSeek 配方、本机定时任务、macOS 自带沙箱。
- 新增 platform-shared：无（内部工程工具）。industry / client-specific：无；白名单显式排除客户交付物与外发路径。
- 无客户名、客户 ID、行业判断进入新代码。落点与 tier 判定一致。
