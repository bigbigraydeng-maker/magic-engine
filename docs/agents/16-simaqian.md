# 司马迁 — Agent 档案

> 代号：`simaqian` ｜ 分组：§4.1 支柱与运营（口碑 / 评价支柱）
> 状态：**骨架档案，只收 §4 名单和 §4.4 代码对照里已有的内容；其余写「待补」，不编事实。**
> 依据：`docs/specs/2026-09-24-agent-autonomy-operating-plan-v1.md` §3（现状矩阵）、§4.1、§4.4 · `src/lib/inngest/functions/simaqian-reputation-weekly.ts`（本档案未逐行读代码，只引用 §4.4 已核对的入口）

## 一、目标与闹钟（§4.1）

| 项 | 内容 |
|---|---|
| 目标 | 评价不漏回、GBP 帖子按审批发 |
| 多久醒 | 每周四 |
| 不问 PM 就能做 | 读评价、起草回复、起草帖子 |
| 必须问 PM（进今日待办，署名） | 发帖、回评一律审批 |

§3 现状矩阵（2026-09-24）：口碑规矩不允许自动执行（口碑维度 FDE-only、GBP 发帖审批制）。

## 二、代码入口（§4.4，2026-10-18 核过）

- 入口：`src/lib/inngest/functions/simaqian-reputation-weekly.ts`
- 叫醒登记：`simaqian-reputation-weekly`（Inngest 定时，`registry.ts:366`）
- 调不调模型：未核 · 兼审查：否

## 三、其余内容

职责边界、Plugin 访问权限、输入输出、Memory 接口、失败模式、停手条件、AU/NZ 本地化约束：**待补**。

## 四、操作手册

暂无。（见 [agents 索引](./README.md#还没有操作手册的-agent)）

## 五、相关文档

- agents 索引：[README.md](./README.md)
- 名单与代码对照：`docs/specs/2026-09-24-agent-autonomy-operating-plan-v1.md` §4
