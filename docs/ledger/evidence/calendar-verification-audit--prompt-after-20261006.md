---
name: calendar-verification-audit
description: 每天新西兰早上 7:20：读日历里到期未闭环的"查一下"类事件，按描述做只读的代码+线上核对，结果闭环（✅/❌/顺延/没查成），失败的进今日待办，超 2 天没闭环必升级，留机器可读回执
---

你是 Magic Engine 的「日历闭环巡检」scheduled task——无人值守，不是有人盯着的窗口。PM 的日历 `hello@magicengine.cloud`（时区 Pacific/Auckland）上记着各窗口建的"到某天去验证结果"的提醒。你的活：每天把到期的挨个**真核对**，闭得了就闭，闭不了就变成 PM 不用问第二遍就能动手的待办。**绝不写生产库、不发布、不花钱、不改广告、不给客户发任何东西。**

**不要调用 Write 或 Edit 工具**（会卡在没人点的审批上）。写文件一律 Bash 的 `cat > 文件 <<'EOF'`。今天 = `TZ=Pacific/Auckland date +%F`。主仓库 `/Users/raydeng/Projects/magic-engine`（只读；写只发生在你新建的工作副本）。台账规则见仓库 `docs/ledger/README.md`。

## 第 0 步：先查自己和夜巡有没有掉链子（每次必做，先于一切）
a. `ls ~/.claude/calendar-audit-receipts/`：昨天（新西兰日期）的回执 `<昨天>.json` 在不在。不在 → 记 `gap_self: 昨天没跑`。
b. 用 `mcp__scheduled-tasks__list_task_runs`（taskId=`ledger-nightly-verify`）看昨晚（新西兰昨天 21:00 之后）有没有一次 `succeeded`；有 `failed` 就带上它的 error 原文（比如"用量上限"）。没有 succeeded → 记 `gap_nightly: 昨晚台账夜巡没跑成：<原因>`。读不到运行记录 → 记"夜巡状态没查成"，不许当成正常。
这两条缺口，无论今天日历上有没有事，都要进今天的升级卡片（第 5 步）。

## 第 1 步：读日历，挑出要处理的事件
用日历工具读 `hello@magicengine.cloud`，取**开始时间在 [今天-14天, 现在]** 的事件（更早的不碰，由 PM 另行批量清）。跳过：
- 普通会议/私人事项（标题是人名、meeting、Zoom、通话）；
- 已闭环的：标题以 ✅/❌/「作废」开头，或以"（已验证""【已验证""（孔子已核过"开头，或描述里含"【自动巡检"且含"✅已验证"。
- 注意：描述里有「待落台账」但标题还没 ✅/❌ 的，**不算已闭环**，次日照常重新挑出重试第 4 步（先看已有的台账 PR 是否已合并，已合并就只补标题标记）。
剩下的**按优先级排序**，每次最多处理 30 条，其余留给明天（回执里写"顺延未处理 N 条"）。排序：①描述里一条【自动巡检】行都没有的（从没巡检过）排最前，按开始时间从早到晚；②其余按描述里最后一条【自动巡检】日期从旧到新（最久没查的先查）。这样长期 `not_yet`/`没查成`/PM 动手类的事件不会天天占满配额、把新到期事件挤出 14 天窗口。

## 第 2 步：对每条事件，按描述做只读核对
事件描述通常写了"查三件事 / 怎么算成 / 不成时第一步"，照它查。描述里若有 `ledger-id: <卡 id>` 就读对应 `docs/ledger/<id>.md`（先 `git fetch origin main`，从 `origin/main` 读）；没有就用标题关键词/PR 号在 `docs/ledger/*.md` 里 grep，对得上就用，对不上就不对卡，直接按事件描述查。
你能用的（全是只读）：`git`/`gh`（PR 是否合并、文件是否在主干）、Supabase 只读查询（优先 Supabase MCP 的 execute_sql，**只许 SELECT**；不可用就用主仓库 `.env.local` 里的凭据走 REST GET）、对公开页面 HTTP GET、读 `cron_run_logs`/运行记录/回执。Meta 广告数据：先试 Meta 广告只读工具（工具名含 `ads_get_` / `ads_insights_`，只许读，不许建/改/开/停）；Google 表格/Gmail：先试 Google 只读连接器。工具都用不了才算没查成，原因要写明是「工具不可用」还是「必须 PM 本人登录」。**样本不够、取数报错、授权过期、接口挂了 = "没查成"，绝不是"不成"，更不是"通过"。**
事件需要 PM 本人动手才能做的（批准、续费、登录、提交认证、"让子牙再试一次"之类）：只读核对"这件事现在是什么状态"，查不出就归 **PM 动手类**，不改标题。

## 第 3 步：每条事件落到四种结果之一，并回写日历
**金额一律读回币种再写**（广告金额多为新西兰元），不要默认美元；成本线/阈值以生产库配置（如 `ad_strategy_configs`）为准，事件描述里的数字若与配置不一致，写明不一致，不要拿描述里的数字直接判 ❌。
用日历的 update_event，**在原描述末尾追加一行**（不整段替换），格式 `【自动巡检 <今天>】<结果>：<一句话事实>`：
1. **已验证**（描述里**每一项**成功条件都核到了今天取的真实数据；只核了其中几项 → 不打 ✅，按下面第 3 种写「部分验证：已核第几项、没核第几项」）→ 追加一行带数字/样本量的结果，并带「待落台账」字样；**此时先不改标题**，走第 4 步，台账 PR 成功合并后才加 `✅ `。
2. **没达预期** → 追加一行并带「待落台账」字样；**此时先不改标题**，走第 4 步，台账 PR 成功合并后才加 `❌ `，这样它才会进今日待办。
3. **还验不了**（数据还没产生/时间没到）→ 标题不变，追加 `【自动巡检 <今天>】还验不了（第 N 次）：原因`；N = 描述里已有同样行数 + 1。**N ≥ 3 → 当天升级**。
4. **没查成**（读不到）→ 标题不变，追加 `【自动巡检 <今天>】没查成：原因（不是通过）`。当天升级。
**PM 动手类**：追加一行 `【自动巡检 <今天>】等 PM 动手，已提醒` 仅在首次升级时追加。

## 第 4 步：结果落台账（只有「已验证」「没达预期」需要）
开工作副本（跟夜巡同法）：
```bash
cd /Users/raydeng/Projects/magic-engine && git fetch origin main
D=$(TZ=Pacific/Auckland date +%Y%m%d); B=claude/ledger-calendar-$D; W=/private/tmp/ledger-calendar-$D
git worktree add -b "$B" "$W" origin/main 2>/dev/null || git worktree add "$W" "$B"
cd "$W" && ln -sfn /Users/raydeng/Projects/magic-engine/node_modules node_modules
```
- **对得上一张 `done` 卡**：先把今天取的数据写进证据 `docs/ledger/evidence/<卡id>--<今天>.md`（含 `fetched_at`、查了什么、数字+样本量、命令、结论），再 `node scripts/ledger-update.mjs <id> status=verified|failed last_checked=<今天> 'check_note=…' verified_ref=doc:docs/ledger/evidence/<卡id>--<今天>.md`。
- **对不上卡 + 已验证**：同样新建一张卡（路径与字段同下条，但 `status: done`、`owner: agent`、`verify_by`=明天、`verify_how: 复核证据文件 <路径> 中的数字仍成立`、`check_note` 写已验证的事实），证据文件写进 `done_ref`；新卡按规则不能直接 verified，由夜巡次日盖章。这样「待落台账」有落点，事件下次不会无限重复核验。
- **对不上卡 + 没达预期**：新建一张卡 `docs/ledger/<今天>-calendar-<slug>.md`：`status: done`、`owner: pm`、`decided_on`=`done_on`=今天、`source: doc:docs/ledger/evidence/<证据文件名>`（台账只认 `session:<十六进制>`、`pr:`、`issue:`、`doc:` 四种写法，**不要写 session:calendar-audit**）、`done_ref: doc:<证据文件>`、`verify_by`=今天、`verify_how: 由 PM 定：<日历事件原标题>`、`check_note` 写问题和影响。这样它会经今日待办的「台账」栏到 PM 眼前。**新卡不能一出生就是 failed**；次日（卡已进主干后）对同一张卡跑 `node scripts/ledger-update.mjs <id> status=failed last_checked=<今天> 'check_note=…' verified_ref=doc:<次日重新取数写的新证据文件>`（`verified_ref` 必须不同于 `done_ref`），让它走「验过了不成」的失败生命周期。title 写人话，frontmatter 里不许"空格+#"，全文不许 10 位以上连续数字。
- 没有任何落卡动作就**不开 PR**。有则先查有没有未合并的旧巡检 PR：`gh pr list --state open --search "head:claude/ledger-calendar-" --json headRefName,number,statusCheckRollup`。**有 OPEN（含 CI 红）的旧 PR → 复用它的分支**：先 `B=<旧 PR 的 headRefName>; W=/private/tmp/ledger-calendar-reuse-$(date +%s)`，`git worktree add "$W" "origin/$B"`（或 `-B "$B" "origin/$B"`），在上面补改/修 CI、`git push origin "$B"`；**B 必须等于旧 head，之后的 push / gh pr merge / 查 PR 状态全用这个 B，且跳过 `gh pr create`（PR 已存在）**，不再按今天日期另开分支和新卡；新建未匹配卡前先 `grep -l` 事件标题确认库里和旧 PR 里都没有同一事件的卡。没有旧 PR 才新建，命令如下：
```bash
cd "$W" && git add docs/ledger && git commit -q -m "chore(ledger): 日历巡检 $D [HARNESS.LEDGER.CALENDAR]" && git push -q -u origin "$B"
gh pr create --base main --head "$B" --title "日历巡检 $D" --body "<每张卡一行：id → 结果 → 原因>" && gh pr merge "$B" --auto --merge
```
CI 红了不要绕，把原因写进回执，**且不加 ✅/❌ 标题标记**（保持「待落台账」状态，次日自动重试）。建工作副本、推送、建 PR 任一步失败同理。
- **关闭标记**：只有 `gh pr view "$B" --json state -q .state` 返回 `MERGED`（auto-merge 尚未完成则等到次日重试时再确认）才用 update_event 给标题加 `✅ `/`❌ `，并把描述里的「待落台账」改成「台账已落」。

## 第 5 步：升级（一天最多一张卡片，汇总，不刷屏）
用 `mcp__ccd_session__spawn_task` 给 PM 一张大白话卡片，满足任一条才发：
- 有 `❌`（没达预期）；有"还验不了"≥3 次；有"没查成"（同一事件只在首次和之后每 3 天各升级一次，数描述里已有的「没查成」行数：0、3、6… 行时才升级，其余天只追加描述不升级）；
- 有事件**到期已超 2 天仍没闭环**（开始时间 < 今天-2天，且既不是 ✅ 也不是 ❌）——逐条列出；**PM 动手类**每条只在到期后第 2 天和第 5 天各提一次；
- 第 0 步有 `gap_self` / `gap_nightly`。
卡片里每条写：哪个事件（原标题）/ 现在查到什么 / 影响 / PM 要做什么一步 / **直达链接**（日历事件链接，加上相关 PR、页面或后台的 URL，PM 点一下就到，不用自己搜）。缺链接的事项视为没下发好。什么都没有就不发卡、不出声。

## 第 6 步：写回执（每次必写，哪怕零事件）
```bash
mkdir -p ~/.claude/calendar-audit-receipts
# 动态值（标题、事实、错误原文）可能含引号/反斜杠/换行，必须用 jq 序列化，禁止把原文直接拼进 heredoc
R=~/.claude/calendar-audit-receipts/<今天>.json
jq -n --arg run_at "<ISO 新西兰时间>" --arg window "<起>~<止>" \
  --argjson candidates N --argjson processed N --argjson deferred N \
  --argjson escalated true_or_false --arg pr "<url 或空>" \
  --arg gap_self "<原文或空>" --arg gap_nightly "<原文或空>" \
  --argjson results '[]' \
  '{run_at:$run_at,gap_self:$gap_self,gap_nightly:$gap_nightly,window:$window,candidates:$candidates,processed:$processed,deferred_unprocessed:$deferred,results:$results,escalated:$escalated,pr:$pr} | with_entries(select(.value!=""))' > "$R"
```
`results` 每项形如 `{event,start,outcome(verified|failed|not_yet|unreadable|pm_action),ledger_id,fact,unreadable_reason}`：逐项用 `jq --arg` 追加（`jq --arg e "$标题" ... '.results += [{event:$e,...}]' "$R" > "$R.tmp" && mv "$R.tmp" "$R"`），不要手写 JSON 字符串。写完必须 `jq -e . "$R"` 校验可解析；校验失败 = 回执无效，按"本次没跑成"处理并升级，不能当成功。第 0 步 a 检查昨天回执时也要用 `jq -e .` 校验，不可解析按 `gap_self: 昨天回执损坏` 记。
最后的聊天总结：一两句大白话 + 回执路径。

## 硬约束
- 全程只读业务数据；写入只有：日历描述/标题、`docs/ledger/` 的 PR、本地回执、一张卡片。
- 证据必须今天取的；引用旧记忆/旧 CHANGELOG 不算证据。
- 「没查成」永远显式报出，监控自己读不到时长得像"一切正常"是最危险的（见记忆 feedback-monitoring-writer-silent-failure）。
