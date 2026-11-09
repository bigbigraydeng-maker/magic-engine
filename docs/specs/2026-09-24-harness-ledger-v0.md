# 台账（docs/ledger）v0 · 设计说明

PM 2026-09-24 拍板。目标一句话：**让"记了"和"记的是不是真的"都能被机器证伪。**
背景审计见记忆 `project-harness-ledger-audit-20260924`（128 条教训 73% 只在文字里；7 簇重复踩坑全部"建了防护后再踩"；变成代码/CI 的防护起效、写成文字的没起效）。
设计审：子牙（架构）+ 魏征（挑刺）各一轮，2026-09-24 夜；必改项全部吸收，见 §3。

## 1. 第一步："有没有写"归机器管

| 零件 | 落点 | 机器管的是 |
|---|---|---|
| 一条一文件的备忘录 | `docs/ledger/*.md`，四态 decided / done / verified / failed | 格式：字段缺了、状态不对、全文混进 ≥10 位数字 → 读不进去，第二天邮件报"这张卡坏了" |
| 待办邮件多一栏 | `src/lib/pm-todo/ledger-items.ts` | 决定了 >7 天没动 / 做了到日子没验 / 验了不成 / 夜巡没来 |
| 门卫 | `.github/workflows/ledger-check.yml` | 改了 `src/`、`supabase/migrations/`、`scripts/`、`.github/workflows/`、`render.yaml` 不写卡 → 合并前拦 |

## 2. 第二步："写的是不是真的"归机器管

### 2.1 指向必须真实、且跟本 PR 绑定（CI · 机械）

`source` / `done_ref` / `verified_ref` 只认五种写法，且按字段限类型（`src/lib/ledger/refs.ts` + `parse.ts`）：

| 字段 | 允许 | 为什么限 |
|---|---|---|
| `source` | session / pr / issue / doc | 来处 |
| `done_ref` | pr / commit / doc | **不许 url/session**——随手贴个链接不算"做了" |
| `verified_ref` | pr / commit / doc / url | 证据可以是外部页面（如 PR 关闭页） |

CI job "Ledger refs exist"（`scripts/ledger-check-refs.sh`）：
- 每个指向真实存在：pr/issue 查 GitHub、commit 查 git、doc 查文件、github.com 链接解析后同样查
- **绑定本 PR**：本 PR 改动的卡里，至少一张是新建的、或写着 `pr:<本 PR 号>`——改一个字不算写台账
- 新建的卡只能是 decided / done——不能一出生就 verified
- 改动的卡 `done_ref` 指向别的 PR 时，那个 PR 必须已合并

### 2.2 夜巡：每晚一个 agent 去核（Claude scheduled task `ledger-nightly-verify`）

规则全文在 `docs/ledger/README.md`「夜巡」节（放仓库里：DeepSeek / Codex / 同事做同样的核查时有规则可依，规则改了有人复审）。要点：
- 只碰 `done` 卡；`decided` 卡由邮件催人
- **每晚给每张到期卡盖 `last_checked`**——两天没章，`walk.ts` 报 `patrol_missing`（"夜巡没来"），跟"没事"分开
- 样本不够 / 取数报错 / 令牌失效 = 判不了，不是"不成"；连续两晚判不了 → `owner: pm` 交人
- verify_how 写了"PM 定"的，只写事实进 `check_note`，不翻状态
- 证据写 `docs/ledger/evidence/<id>--<日期>.md`（含 `fetched_at`、样本量、两边取数状态），`verified_ref` 指过去
- 无人值守任务不能用编辑器工具 → 改卡一律 `node scripts/ledger-update.mjs`（所有人共用同一入口，冻结字段拒改）
- 改动走 `claude/ledger-verify-<日期>` 分支开 PR；零改动不出声

夜巡分支专用 CI（`scripts/ledger-check-verify-branch.sh`）：只准动 `docs/ledger/` 卡和 `evidence/`；只准改 status / owner(agent→pm) / done_on / done_ref / verified_ref / last_checked / check_note；不准新建卡；标题、日期、来源、**判据（verify_how / verify_by）**一律冻结——agent 不能改判据让自己过。

### 2.3 聊定但不改代码的结论（Claude Code 私有钩子 · 机械）

`~/.claude/window-discipline/wrap-up.sh`：关窗时，契约卡风险级 A/B 且仓库（含所有工作副本）里没有 `source: session:<本窗口 id 前 8 位>` 的卡 → 拦一次。**并进原有"未提交文件"那条消息**（wrap-up 每窗口只拦一次、先落锁，第二道拦截永远触发不到）。
Codex / DeepSeek 窗口没有这个钩子——它们只产出 PR，2.1 已覆盖。

### 2.4 待办邮件

- `done` 卡带 `last_checked/check_note` → "做了没验"那条追加"上次自动核查 <日期>：<note>"
- 所有 how 文案改成真话：邮件没人在听，"回一句 X"要改成"找任何一个 Claude Code 窗口说 X，它会开 PR 改卡"

## 3. 复审必改项 → 落点

| 来源 | 必改 | 落点 |
|---|---|---|
| 子牙 1 / 魏征 1 | 指向存在≠相关；改一个字也算写了 | 2.1 绑定本 PR + 新卡只准 decided/done |
| 子牙 2 / 魏征 3 | `claude/*` 豁免是口子；夜巡不需要豁免 | 删豁免；格式检查永不豁免；夜巡分支专用检查 |
| 子牙 3 | verified 靠文字约束 | parse：verified/failed 必填 last_checked ≥ done_on、verified_ref ≠ done_ref |
| 魏征 1 | `url:` 万能逃生口 | `done_ref` 禁 url；github.com 链接解析后照查 |
| 魏征 1 | 门卫不覆盖 scripts/ 和 workflows/ | 路径补上 |
| 魏征 3 | "没跑"和"没事"分不清 | 每晚盖章 + `patrol_missing` |
| 魏征 3 | 判不了是最省事出口 | 两晚判不了 → owner: pm |
| 魏征 3 | agent 改判据让自己过 | verify_how / verify_by 冻结 |
| 魏征 4 | 账户号只扫正文；CRLF | 扫全文；`\r\n` 归一 |
| 魏征 2 | "回一句"没人听；建台账卡的验收自己达不成 | 文案改真话；卡的 verify_how 改成可达成 |
| 魏征 5 | 同一结论写五处、wrap-up 只认 ROADMAP | CLAUDE.md §9 第 1 条改二选一；wrap-up 三选一"写了"改指台账 |
| 魏征 1 | 主干必过清单没有台账检查 | **合并后**把 "Ledger entries valid" / "Code change has ledger entry" / "Ledger refs exist" 加进 main 的 required checks（仓库设置，PM 合并时一并授权） |

**PM 待定**（魏征 2）：只改 `docs/ledger/` 的 PR 是否免 Ray 合并审批、自动合。不免 = 每翻一张卡都要 PM 点一次，这是 ROADMAP 死法的复刻；免 = 夜巡 PR 只靠 CI 形状检查兜底。默认按"不免"实现。

## 4. 机器管一半、人管一半（明说）

机器管得住：格式、指向存在、指向跟 PR 绑定、证据文件存在、日期先后、夜巡有没有来。
机器管不住：证据是不是当晚新取的、内容是不是真的、决定本身对不对。**前者是 Ray 审夜巡 PR 时唯一要看的事，后者是 PM 的活。**

## 5. 不做（v1 再说）

- 自动开 GitHub issue / 自动派窗口去做"决定了没做"的事
- 跨仓库台账；把 ROADMAP / DECISIONS 迁进台账（先并行一个月看用量）
- 按作者（bot）而非分支名判豁免（当前没有需要豁免的 bot 写卡场景）

## 6. 验收（合并后）

- 合并后第一个工作日待办邮件出现台账栏（日历 2026-09-30 已建）
- 故意写 `done_ref: pr:999999` 的测试 PR 被 "Ledger refs exist" 拦下
- 9/27 夜巡对 NAL Messenger 那张卡产出 `claude/ledger-verify-20260927` PR（或 `check_note` 说明为什么判不了）
- 9/29 若夜巡没跑，9/30 邮件出现"夜巡没来"
