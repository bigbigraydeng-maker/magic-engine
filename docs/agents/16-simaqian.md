# 司马迁 — Agent 手册（骨架）

> 代号：`simaqian` ｜ 分组：§4.1 支柱与运营（口碑 / 评价）
> 状态：**骨架档案，只收录 `docs/specs/2026-09-24-agent-autonomy-operating-plan-v1.md` §4.1、§4.4 已有的内容；其余写「待补」，不编事实。**
> 依据：上述 spec §4.1 / §4.4；代码与台账路径见「代码入口」。最后核实：2026-10-27（仅核对路径存在，未读实现）。

## 目标与闹钟（来自 §4.1，PM 已认）

| 项 | 内容 |
|---|---|
| 目标 | 评价不漏回、GBP 帖子按审批发 |
| 多久醒 | 每周四 |
| 不问 PM 就能做 | 读评价、起草回复、起草帖子 |
| 必须问 PM（进今日待办，署名） | 发帖、回评一律审批 |

## 代码入口（来自 §4.4 与相关路径）

- 主入口：`src/lib/inngest/functions/simaqian-reputation-weekly.ts`
- 叫醒登记：`simaqian-reputation-weekly`（Inngest 定时，`src/lib/cron/registry.ts:366`，见 §4.4）
- 起草：`src/lib/reputation/simaqian-drafts.ts`
- 待办条目：`src/lib/pm-todo/simaqian-review-items.ts`
- 台账：[`2026-09-25-b2-simaqian-reputation-weekly`](../ledger/2026-09-25-b2-simaqian-reputation-weekly.md)
- 调不调模型：§4.4 写「未核」；兼审查：否；代码实际在做 vs 名单：§4.4 写「—」。

## 待补

人设与命名由来、能力与记忆分层、红线细则、验证方式、与卫青 / 苏东坡 / 孟子的交接：待补（需读代码与台账后补，本骨架不写）。

## 操作手册

暂无。（见 [agents 索引](./README.md) 的「还没有操作手册的 agent」。）
