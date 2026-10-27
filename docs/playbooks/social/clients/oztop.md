# 社媒经验 · 客户层：Oztop（卫浴客户）

> **负责人**：苏东坡（`sudongpo`）· [苏东坡档案](../../../agents/14-sudongpo.md)
> **范围**：客户层：Oztop（卫浴客户），仅该客户适用
> **状态**：迁移稿，待 PM 审批（不新增规则、不改含义）
> **日期**：2026-10-28
> **最后核实**：2026-10-28（对照迁移源逐条核对；见 MIGRATION-MAP）
> **风险**：A 级（合并闸按「经验手册正文——所有窗口的必读规则书」定级；本文件只改文档、不改代码）；迁入内容不等于获批的新规则
> **代码依据**：无（纯文档，不涉及代码；规则来源为开发侧记忆原文，编号见 MIGRATION-MAP）

> **仅该客户适用，不得写进平台层默认值。** 迁移稿，不新增规则、不改含义（见 [MIGRATION-MAP](../MIGRATION-MAP.md)）。不含账号、令牌、联系方式。

## 一、字幕过长事故（对应平台层第三节）

- 〔C1.3〕**Why**：2026-07-15 PM 看 Oztop 草稿 Reel 反馈「中间字幕太小」。根因 = 中段 caption 用了 Oztop 整句 core_proposition（"...bathware solutions for Australian homeowners and builders, combining extensive prod..."），太长 → 被压成小字。这是 C 端客户能一眼看出的低质感。

## 二、素材真实性误判事故（对应平台层第五节）

- 〔R4.1〕2026-07-13 隔壁 Oztop 窗口对齐时发现的红线：内容工厂判「素材是否客户真实产品」**必须按 provenance（来源事实）**，不能按 scene_tag / 文件名启发式。
- 〔R4.2〕**踩坑现场**：PR #576 当时用 `isRealFootage = scene_tag 无 _px/_pb 后缀` 当「真实产品片」判据。隔壁窗口抓到：Oztop 全部 26 条「a_real」素材（13 场景）的 `source_meta.origin` 全是 `Oztop/library/i2v_out/*` = **AI 图生视频（muapi I2V）输出**，零店里真拍。文件名启发式把 AI 生成片当成了真实产品片 → 会把 AI 内容当「Oztop 真实产品/展厅」发给客户 = **货不对板红线**。
- （共享契约与 How to apply 已放平台层第五节〔R4.3〕〔R4.4〕〔R4.5〕〔R4.6〕。）
