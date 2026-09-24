# 台账（docs/ledger）— 决定了 / 做了 / 验了

**这是什么**：每个开发窗口（Claude Code / Codex / DeepSeek / 人）聊出来的结论，都必须在这里留一条，
窗口关了它还在。每个工作日的今日待办邮件会自动读这个目录，把三样东西摆到 PM 眼前：
**决定了没做 · 做了没验 · 验了不成**。健康的一天这一栏是空的。

**为什么要有它**（2026-09-24 审计）：128 条教训里 73% 只存在于文字，从没被任何程序读过；
7 个反复踩的坑全都"建过防护、建完再踩"。原因不是没记，是"记了"这件事本身没法被机器证伪。
这个目录就是让它能被证伪。

## 格式：一条一个文件

文件名 `YYYY-MM-DD-<slug>.md`，`id` 必须等于文件名去掉 `.md`。

```markdown
---
id: 2026-09-24-nal-messenger-15s-creative-3day-review
title: 一句人话，PM 读得懂
status: decided            # decided | done | verified | failed
owner: pm                  # pm | agent
decided_on: 2026-09-24
source: session:beef24ba   # 从哪来：session:<id> | pr:<n> | issue:<n> | doc:<path>
verify_by: 2026-09-27      # 可选：到这天必须验
verify_how: 一句话怎么验、验到什么算成
done_on: 2026-09-25        # status 为 done/verified/failed 时必填
done_ref: pr:1980          # status 为 done/verified/failed 时必填：pr:<n> | commit:<sha> | doc:<path>
verified_ref: doc:docs/... # status 为 verified/failed 时必填：证据指针
---
正文最多 5 行上下文。只写指针，不写客户业务数字、账户号、客户老板原话。
```

## 四个状态

| status | 意思 | 什么时候会被摆到 PM 眼前 |
|---|---|---|
| `decided` | 决定了，还没动手 | 超过 7 天没动，或过了 `verify_by` |
| `done` | 做完了，还没验 | 到了 `verify_by`，或做完超过 7 天没验 |
| `verified` | 验过了，成 | 不再出现 |
| `failed` | 验过了，不成 | 一直出现，直到有人开新条或改状态 |

## 三条硬规则（机器强制）

1. **改了 `src/` / `supabase/migrations/` / `render.yaml` 的 PR，必须新增或修改这里的一条**，否则合并前检查不过（`.github/workflows/ledger-check.yml`；`claude/*` 自动修复车道和 `dependabot/*` 豁免）。
2. **每条文件头都会被解析校验**（`src/lib/ledger/parse.ts`），字段缺了、状态对不上、正文里出现 10 位以上连续数字（账户号）都算不合规，不合规的条目会以"台账读不出来"的形式出现在待办里，不会静默消失。
3. **窗口关掉前必须写**。这条目前靠 CLAUDE.md §9 和 PR 检查兜底，Claude Code 的关窗钩子后续会加机械提醒。

## 不放这里的东西

- 客户业务事实（写进客户记忆或 `fde_work_logs`）
- 代码怎么改的细节（写进 PR 描述）
- 还没决定的讨论（决定了再写）
