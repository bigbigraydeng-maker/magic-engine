---
id: 2026-10-05-remotion-template-catalog-selector-plan
title: Remotion 模板目录 + 配套音乐 + 模板选择器的方案写好了（3 个模板、自动节拍、选择器宁可不出片也不乱出片），等 PM 拍剩下 3 个业务题（第 4 题选择器先规则后大模型，PM 已同意）
status: decided
owner: pm
decided_on: 2026-10-05
source: doc:docs/specs/2026-10-06-remotion-template-catalog-and-selector.md
verify_by: 2026-10-12
verify_how: PM 回答方案 §7 的 4 个业务题（蒙太奇理解是否对、是否拍真人短片、第一版只做清单+蒙太奇、选择器先规则后大模型）；子牙+魏征已审一次（需改，已并入 v0.2），板桥未审；之后才开 WP-A（音乐自动节拍）。
---
只写了方案，没有任何实现代码。拆成 6 个小包（A 音乐 → B 蒙太奇 → C 接出片机 → D1 选择器规则版 → D2 加大模型 → E 悬念提问，后两项条件做），每包一个窗口。D1 依赖 PR #2270（官网产品事实）合并；镜头文件下发暂编号 R2c，尚无人认领（#2261 已占用 R2b）。
