# CTS China Stopover 行程卡片 —— 真实 Google 评价替换记录（2026-09-29）

关联台账卡：`docs/ledger/2026-09-29-cts-stopover-real-reviews-and-alignment.md`

## 背景

CTS 网站仓 chinatravel（不是 magic-engine）。PM 报 `https://www.ctstours.co.nz/tours/china/stopover` 列表页卡片留白不均，
查出根因是列表页网格的对齐设置，已修。

排查中发现其中 2 个团（Beijing、Beijing Express）原有的星级/评论数/摘录是硬编码假数字，系统从无按团拆分评价的能力。
PM 确认后删掉假数字，14 个团统一改用真实的公司整体 Google 评分（每周自动更新）+ 真实客户原话摘录（可溯源到具体哪条评价），
不再有编造内容。旧的编造摘录文案为 "Efficient Beijing transit experience" 与 "Perfect Beijing stopover"，合入后不应再出现。

## 验收清单（供夜巡 / 复核按此逐项核对）

1. 对列表页每行卡片取实际渲染后的 DOM 尺寸（`getBoundingClientRect()` 的高度），同行各卡片高度差在可忽略范围内、无参差留白——
   不能只抓静态 HTML 判断，必须是渲染后量出来的真实尺寸。
2. 14 个团逐个核对，每个团卡片上都出现 "Google review" 来源标注（不是部分团），且不再出现旧的编造摘录文案
   "Efficient Beijing transit experience" 或 "Perfect Beijing stopover"。
3. 星级、评论数、摘录文本可溯源到真实 Google 评价（公司整体评分 + 具体某条评价原话），不是新的占位编造数字。
4. 正文声称评分"每周自动更新"，需提供至少一次该更新任务的实际运行回执（触发方式/时间/退出码或运行状态/输出摘要），
   或跨两个更新周期评分数值发生同步变化的前后对比证据，证明自动更新确实在跑而不是只写在文案里。

任一项不满足＝没生效或没合并。

## 状态

PR 现为 chinatravel 仓的草稿 chinatravel#215，已发复核请求给子牙（架构+挑刺+客户视角三方过一遍才合并），未合并前真站不会变。
