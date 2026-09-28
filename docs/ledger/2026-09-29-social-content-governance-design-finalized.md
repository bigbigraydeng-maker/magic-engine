---
id: 2026-09-29-social-content-governance-design-finalized
title: 社媒内容发布治理设计 v0.2 定稿，实现交接 Codex+DeepSeek
status: done
owner: agent
decided_on: 2026-09-29
source: session:31cdcfa9
done_on: 2026-09-29
done_ref: doc:docs/specs/2026-09-29-social-content-publish-governance-v0.2.md
verify_by: 2026-10-20
verify_how: 到期核：①Codex/DeepSeek 是否已按 §8 交接说明开工或提交实现 PR；②若已提交，PR 是否走了 §8.3 要求的 A 级三方审查流程（子牙+魏征）而不是绕开；③若两周内无任何进展，转告 PM 询问是否还要这个优先级。不核实实现内容对不对——那是届时 PR 审查的事，本卡只查"有没有交接成功、流程有没有被跳过"。
---
苏东坡 + 子牙合作设计，起因 East Inter 事故（PITFALLS D14）。魏征两轮对抗审查：第一轮打回两个 BLOCKER（清单挂错链路、鉴权可被客户自审），v0.2 已补齐并经苏东坡复核确认无失真；第二轮额外查出三条现存发布口子权限过松（不在本设计范围，已转 PM 决策，见台账卡 `2026-09-29-social-publish-gate-risk-accepted.md`）。
PM 2026-09-29 拍板：本设计的实现交给 Codex + DeepSeek 承接，苏东坡（Claude）继续审查角色不写代码，Claude Code 这边不开实施窗口。文档 §8 已补完整交接说明（开工必读、改动文件起点、验收标准、明确排除范围），假设实现方无本次对话上下文。
