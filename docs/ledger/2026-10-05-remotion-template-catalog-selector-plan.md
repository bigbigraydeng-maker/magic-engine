---
id: 2026-10-05-remotion-template-catalog-selector-plan
title: Remotion 模板目录 + 配套音乐 + 模板选择器的方案写好了（3 个模板、自动节拍、选择器宁可不出片也不乱出片），等 PM 拍 3 个业务题
status: decided
owner: pm
decided_on: 2026-10-05
source: doc:docs/specs/2026-10-06-remotion-template-catalog-and-selector.md
verify_by: 2026-10-12
verify_how: PM 回答方案 §7 的 3 个业务题（蒙太奇理解是否对、是否拍真人短片、第一版只做清单+蒙太奇）；方案经子牙+魏征+板桥各审一次后，才开 WP-A（音乐自动节拍）。方案本身未经任何审查。
---
只写了方案，没有任何实现代码。拆成 5 个小包（A 音乐 → B 蒙太奇 → C 接出片机 → D 选择器 → E 悬念提问，条件做），每包一个窗口。选择器依赖「官网核对底稿」窗口与 R2b 对表，别两边各做一套 props 生成。
