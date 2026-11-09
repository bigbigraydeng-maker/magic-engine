---
id: 2026-10-18-promo-plan-business-case-schema
title: 推广计划加了经营判断卡、实验设计卡、销售承接三块字段（只加结构，还不拦批准）
status: done
owner: agent
decided_on: 2026-10-18
done_on: 2026-10-18
done_ref: pr:2790
source: session:579d2d02
verify_by: 2026-10-25
verify_how: 在真实推广计划页填一张经营判断卡并保存成功，再读库确认 plan_data.promo.phases[].business_case 有值；且已批准的旧计划的「批准记录」仍显示「批准的就是现在这一版内容」（没有因为加字段被判成内容变过）
---
设计稿：docs/specs/2026-10-18-promo-plan-business-case-and-gates-design-v0.1.md（PR 2779）。这是其中的 PR①-a：只加 schema 和测试，不碰批准闸、不碰表单。
一个坑记下来：`is_experiment` 一开始写的是 `z.boolean().default(false)`，结果 default 会被写进解析结果，让每一份旧计划的内容指纹都变一次——已批准的计划会被判成「内容变过了」，挂在旧指纹上的人工核实记录也会跟着作废（当场被 approval-record 测试照出来）。改成 `.optional()`，按 `=== true` 读。
**后续事项（不是本刀引入、也不在我范围，归因未确认，统筹另找主人）**：①`src/app/api/clients/[id]/messenger/conversations/[conversationId]/drafts/__tests__/route.test.ts` 1 条红（断言闸数 7、现在 8，像是中文内容闸那一刀加了第 8 道）；②`scripts/auto-dev/__tests__/pick.test.ts` 与 `src/lib/messenger/__tests__/send.test.ts` 的既有 tsc 报错。
**审查要点（往后每次往 PromoSpec 加字段都要看）**：不许用 `.default()`——它会写进解析结果，让旧计划的内容指纹全变、已批准计划被误判成改过、挂在旧指纹上的人工核实作废；用 `.optional()`，消费方按 `=== true` / `!== undefined` 读。另：这一层的注释里不许点名团目录的表名，会被团目录边界测试拦下。
