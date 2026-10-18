# Agent 立项卡 · 模板

> **怎么用**：复制本文件为 `docs/agents/intake/<YYYY-MM-DD>-<名字>.md`，逐节填。**每一格要么填证据，要么写「不适用：原因」，不许空着。**
> 规则出处：`docs/specs/2026-10-18-me-agent-standard-process-v1.0.md`（第 1 关、第 2 关、§6）。
> 填完同时开一张台账卡（`docs/ledger/`），`source` 只准 `session:` / `pr:` / `issue:` / `doc:`，正文不许出现 10 位以上连续数字。

---

## 0. 基本

| 项 | 填 |
|---|---|
| 名字（与 9-24 名单一致；新人写「新增，待 PM 定名」） | |
| 它负责的**一个**决定或动作（一句话） | |
| IMPACT 哪一段（I / M / P / A / C / T） | |
| 哪根支柱 | |
| 在闭环骨架哪条线、哪个环节（`docs/specs/2026-10-18-me-closed-loop-skeleton-min-cost.md`；骨架没有对应线就写「无，需补线」） | |
| 类：运行时 Agent / 审查团 | |

## 1. 贴四份现成产出（不重新回答，直接贴结论 + 出处）

| 产出 | 贴结论 |
|---|---|
| 层级门结论（L1–L4，做还是接还是买）——`.claude/skills/me-platform-tier-gate/SKILL.md` | |
| Build vs Connect 六问答案——`docs/strategy/ME_PRODUCT_DEFINITION.md:364-383` | |
| §11 三维打分（频率 X / IMPACT Y / 收入 Z → P几，过程写出来）——`docs/ENGINEERING_QUALITY_GATES.md` §11 | |
| 子牙九问自答——`docs/agents/10-ziya.md` §四b | |

## 2. 开工前三处搜重复

| 搜哪 | 用的命令 / 关键词 | 撞到什么 |
|---|---|---|
| 主干代码 | `git grep ... origin/main` | |
| 在飞 PR + 最近合并 | `gh pr list --state open --search ...`；`--state merged` | |
| 台账与 ROADMAP | `git grep -il ... origin/main -- docs/ledger docs/ROADMAP.md` | |

## 3. 新问 A · 它要用的数据，正式系统里最近有几条能用的？

**五条全满足才算答了；答案是 0 → 本关不过，先去解决上游。**

| # | 要求 | 填 |
|---|---|---|
| 1 | 读这份数据的那段代码（`文件:行`），它读哪张表、按什么条件筛 | |
| 2 | 你的查询（**照抄**上面的筛选条件，贴出原文） | |
| 3 | 最近 N 天的条数，N = 跑一次的间隔 × 3（写出 N 和间隔） | |
| 4 | 查的是哪个库（正式 / 测试）+ 查询时间（新西兰时间） | |
| 5 | 只数它真能用上的行（写出你排除了哪些：空字段、状态不满足……） | |

## 4. 新问 B · 怎么一键停掉它？

| 项 | 填 |
|---|---|
| 开关在哪（广告：`ad_strategy_configs.autopilot_enabled` / `autopilot_dry_run`；SEO：`clients.seo_config.meta_cycle_enabled` + `dry_run`；社媒：`DAILY_PLAN_AUTO_PUBLISH_LIVE` + 客户白名单；新的写出来） | |
| 谁能关 | |
| 开关**读失败**时怎么处理（必须由调用方显式按「关」处理；写出判断的那行） | |
| 关了以后，已经在路上的动作会不会继续 | |
| 这个开关有没有「前置闸」（例：接通谷歌商家授权、关广告演练开关，前面各有一张必须先 verified 的台账卡） | |

## 5. 对外动作与授权档（只读 Agent 写「无对外动作，档 1」即可）

| 动作 | 会不会花钱 / 对外发布 / 改客户账户 | 档（1–4） | 判档原则出处（各支柱手册） | 已在内核里？（ActionKey 名 / 「不在，按 9-28 §4.3 迁移规则」） |
|---|---|---|---|---|
| | | | | |

> 档 3 / 档 4 由 **PM 定档**，这里先填建议档并注明「待 PM 定」。

## 6. 回执（每跑一次留什么）

| 项 | 填 |
|---|---|
| 落点（默认 `cron_run_logs`；会动手的另有内核 `action_runs`；需要新表 → 写理由，**先问 PM**） | |
| 处理几条 → `processed`；失败几条 → `failed_count`（**经 `finish({ failed })` 传入**） | 确认：是 / 否 |
| `summary` 统一五键：`agent`、`produced`、`undeterminable`、`reasons`、`cost_usd` | 确认：是 / 否 |
| 重跑：首次为准，不覆盖（写出怎么做到的） | |
| 需要超过 180 天的证据吗（`cron_run_logs` 180 天硬删） | |

## 7. 核实日（怎么知道它做对了）

| 项 | 填 |
|---|---|
| 核实什么（可观察的结果，不是「接口返回成功」） | |
| 窗口（T + 几天）和理由 | |
| 结论词用哪套（只能选一套，不许自造）：单次核对 pass / pending / not_measured；动作效果 confirmed / inconclusive / reversed；决策记忆 success / failure / inconclusive | |
| 「量不出来」时怎么记（不是零、不是失败） | |
| 谁核、核完写回哪里 | |

## 8. 交给 PM 的只有一件事

**做不做、排第几**（附第 1 节的 §11 打分）。档 3 / 档 4 的定档在第 2 关规则表里另问。
