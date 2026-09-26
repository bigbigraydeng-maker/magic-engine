---
id: 2026-09-26-factory-selfcheck-gate
title: 工作包 B · 视频工厂发布前分镜自检没过不许进 approved 硬闸（轻量路径，改 applyApprove）
status: decided
owner: agent
decided_on: 2026-09-26
source: session:bf0cd6eb
verify_by: 2026-10-10
verify_how: 生产 content_work_orders 表出现"分镜自检没过、状态强制留在 in_review"的行；`src/lib/factory/review-apply.ts::applyApprove` 加入自检结果读取判据，测试覆盖"自检没过尝试通过 → 拒绝"和"自检通过 → 通过"两条；PR 合入主干；ROADMAP 里 CTS 圣诞团那条记录状态从"未过分镜自检、未发布"更新
---
工作包 B：ROADMAP 已记录 CTS 三个圣诞团两轮渲染都没过分镜自检、都还没发布——现在闸是软的靠人肉盯。改成 approve 时读分镜自检结果，没过硬拒。走轻量路径：不依赖 #1705（PM 通过小秘书拍板搁置 #1705），直接改现有 `src/lib/factory/review-apply.ts::applyApprove`（第 41-67 行）装守门函数。风险 A（碰对外发布最后一道闸，不可逆，错误后果给客户看幻灯片）；§11 频率高 + IMPACT 高（Act 段最后一米）+ 收入高（客户可见外发）→ P0。分支 feat/factory-reel-scene-selfcheck-gate；走两审（子牙 + 魏征）+ PM 亲合。工作量半天。PM 2026-09-26 通过小秘书授权全做。
