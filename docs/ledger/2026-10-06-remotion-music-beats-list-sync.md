---
id: 2026-10-06-remotion-music-beats-list-sync
title: 清单视频模板改成画面切换对准音乐鼓点，并建好 29 首可用音乐的节拍目录
status: decided
owner: agent
decided_on: 2026-10-06
source: doc:docs/specs/2026-10-06-remotion-template-catalog-and-selector.md
verify_by: 2026-10-13
verify_how: PR 合并后，用目录里一首带鼓点的歌再渲一条清单片，量画面切点与鼓点偏差在 ±50 毫秒内才算成；目录里标 SUSPECT 的几首节拍要有人听过、量过，再把 beats_unverified 改成 false（与版权无关）
---
这是「模板目录+选择器」方案的第一个小包（WP-A）：音乐自动节拍分析、音乐目录、按节拍生成切换时刻、清单模板 logo 只留最后 2 拍。
下一包是蒙太奇模板；选择器、出片机接线不在本包。成片和 9 宫格在本机临时目录，PR 正文有路径。
