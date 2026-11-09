# 台账（docs/ledger）— 决定了 / 做了 / 验了

**这是什么**：每个开发窗口（Claude Code / Codex / DeepSeek / 人）聊出来的结论，都必须在这里留一张卡，
窗口关了它还在。每个工作日的今日待办邮件会自动读这个目录，把四样东西摆到 PM 眼前：
**决定了没做 · 做了没验 · 验了不成 · 夜巡没来**。健康的一天这一栏是空的。

**为什么要有它**（2026-09-24 审计）：128 条教训里 73% 只存在于文字，从没被任何程序读过；
7 个反复踩的坑全都"建过防护、建完再踩"。变成代码/CI 的防护起效了，写成文字的没起效。
原因不是没记，是"记了"和"记的是不是真的"都没法被机器证伪。这个目录就是让它能被证伪。

## 格式：一张卡一个文件

文件名 `YYYY-MM-DD-<slug>.md`，`id` 必须等于文件名去掉 `.md`。

```markdown
---
id: 2026-09-24-nal-messenger-15s-creative-3day-review
title: 一句人话，PM 读得懂
status: decided            # decided | done | verified | failed
owner: pm                  # pm | agent
decided_on: 2026-09-24
source: session:beef24ba   # 从哪来：session:<id 前 8 位> | pr:<n> | issue:<n> | doc:<path>
verify_by: 2026-09-27      # 可选：到这天必须验
verify_how: 一句话怎么验、验到什么算成、样本要多少才算能判
done_on: 2026-09-25        # done/verified/failed 必填，且 ≥ decided_on
done_ref: pr:1980          # done/verified/failed 必填：pr:<n> | commit:<sha> | doc:<path>（不许 url/session）
verified_ref: doc:docs/ledger/evidence/<id>--2026-09-27.md   # verified/failed 必填，且 ≠ done_ref
last_checked: 2026-09-27   # 夜巡盖章日期；verified/failed 必填，且 ≥ done_on
check_note: 一句话         # 夜巡结论或"为什么判不了"
---
正文最多 5 行上下文。只写指针，不写客户业务数字、账户号、客户老板原话。
```

## 四个状态

| status | 意思 | 什么时候会被摆到 PM 眼前 |
|---|---|---|
| `decided` | 决定了，还没动手 | 超过 7 天没动，或过了 `verify_by` |
| `done` | 做完了，还没验 | 到了 `verify_by`，或做完超过 7 天没验；到期后 2 天没有 `last_checked` = "夜巡没来" |
| `verified` | 验过了，成 | 不再出现 |
| `failed` | 验过了，不成 | 一直出现，直到有人开新卡或改状态 |

## 机器强制的规则（不是提醒，是拦）

**格式（`src/lib/ledger/parse.ts`，CI "Ledger entries valid"，任何分支都跑、不豁免）**
- 字段缺了、状态对不上、日期不是 YYYY-MM-DD → 不合规
- 三个指向字段只认上面列的写法；`done_ref` 不许 `url:`/`session:`
- 全文（含标题）出现 10 位以上连续数字（账户号） → 不合规
- `decided` 卡不能带 done_on/done_ref/verified_ref；`done_on ≥ decided_on`
- `verified`/`failed` 必填 `verified_ref`（≠ `done_ref`）和 `last_checked`（≥ `done_on`）
- 不合规的卡不会静默消失，会以"台账读不出来"出现在待办邮件里

**门卫（`.github/workflows/pr-light-checks.yml` 里的台账三步）**
- 改了 `src/`、`supabase/migrations/`、`scripts/`、`.github/workflows/`、`render.yaml` 的 PR，改动里必须有一张**新建的卡**，或一张写着 `pr:<本 PR 号>` 的卡——改一个字不算
- 新建的卡只能是 `decided` 或 `done`，不能一出生就 `verified`
- 每个指向都要真实存在：`pr:`/`issue:` 查 GitHub，`commit:` 查 git，`doc:` 查文件；`done_ref` 指向别的 PR 时那个 PR 必须已合并
- 只有 `dependabot/*` 免门卫；**没有任何分支免格式检查**
- 夜巡分支 `claude/ledger-verify-*` 另有专用检查：只准动本目录，只准改状态类字段（status / owner agent→pm / done_on / done_ref / verified_ref / last_checked / check_note），不准改标题、日期、来源、判据，不准新建卡
- 三道检查（格式 / 改代码必写卡 / 指向真实）在主干规则集里是**必过**，红了管理员也合不进
- **只改本目录的 PR 免 PM 合并审批，CI 全绿自动合**（PM 2026-09-25 拍板；`.github/merge-authorization.md`）。代价：非夜巡分支的台账专属 PR 能改卡的标题/判据而没人看——只靠格式和指向检查兜底

## 怎么改一张卡（所有人同一个入口）

```bash
node scripts/ledger-update.mjs <id> status=done done_on=2026-09-25 done_ref=pr:1984
node scripts/ledger-update.mjs <id> last_checked=2026-09-27 'check_note=PR 还没合并'
```
冻结字段（id / title / decided_on / source / verify_by / verify_how）默认拒改；改了判据等于换了一张卡，请新建。

## 夜巡（每晚 · Claude scheduled task `ledger-nightly-verify`）

只读主干。对每张 `done` 卡：
- `done_ref` 指向的 PR 已关闭未合并 → 翻 `failed`
- 到了 `verify_by` → 按 `verify_how` 去查；查得出成/不成 → 翻状态并把证据写进 `docs/ledger/evidence/<id>--<日期>.md`（带取数时间、样本量、两边取数状态）；查不动 → 只盖 `last_checked` + 写 `check_note`
- 连续两晚判不了 → `owner` 改成 `pm`，交人
- **每晚给每张到期卡盖 `last_checked`**，哪怕什么都没查出来——两天没章邮件会报"夜巡没来"
- 改动走 `claude/ledger-verify-<日期>` 分支开 PR；一晚零改动不开 PR、不出声

`decided` 卡夜巡不碰——"决定了没做"由邮件催人，不由机器改。

## 证据的硬约束（机器管一半，人管一半）

机器管得住：证据文件存在、日期不早于完成日、不是"做的那个 PR"本身。
机器管不住：证据是不是当晚新取的、内容是不是真的——**这是 Ray 审夜巡 PR 时唯一要看的事**。

## 不放这里的东西

- 客户业务事实（写进客户记忆或 `fde_work_logs`）
- 代码怎么改的细节（写进 PR 描述）
- 还没决定的讨论（决定了再写）
- 需要排期、跨多窗口的大项目（那是 `docs/ROADMAP.md` 的事；台账只记结论和验收）
