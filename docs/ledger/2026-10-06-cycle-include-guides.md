---
id: 2026-10-06-cycle-include-guides
title: 周循环把「目的地指南」（guides.ts，24 页）纳入可自动改标题的范围——用单独的 metaTitle / metaDescription 写法，绝不碰章节标题
status: decided
owner: agent
decided_on: 2026-10-06
source: session:cdd5dbf9
verify_by: 2026-10-13
verify_how: 合并部署并同步后看 10/12（周一）那轮的 seo-meta-cycle-step3 回执：①candidates 里的指南页不再因 slug_not_in_any_data_file 被挡（重庆总览页、故宫页这类）；②若有指南页被自动改并合并，在客户网站仓库的那条 PR 里 guides.ts 只有 metaTitle 与 metaDescription 两行变化，章节里的 title 一行不动；③新标题没有把品牌尾巴「| CTS Tours NZ」弄丢到不合理（丢了就在 PR 点 Revert，并回来补"保留品牌尾巴"的规则）
---
PM 2026-10-06 回复"纳入"。背景：10/5 那轮 9 个候选里 2 个（chongqing-travel-guide、forbidden-city-travel-guide）因为在 guides.ts 里、周循环只读 seo-pages* 与 blogs* 开头的文件，被挡成 slug_not_in_any_data_file。
危险点：指南里"章节"对象也有 title 字段，按旧写法会把第一个章节标题当页面标题改掉。所以新增 'guide' 字段写法：只认顶层 `slug`、只改 metaTitle / metaDescription，缺一个就拒绝，且文件名必须恰好是 guides.ts。已拿 CTS 真实的 guides.ts 逐个试改全部 24 个指南：每个都只变 2 行。
潜力不大（约 100 次点击/28 天，粗估），已知未验证：生成的新标题可能不带指南原有的「| CTS Tours NZ」品牌尾巴。
复审（子牙 + 魏征，2026-10-06）均为 PASS-WITH-FIXES：魏征指出写入层老隐患（新文案含 $&、$' 或换行会写坏源码，对所有页都有效），已改成函数式替换并把换行压成空格，补 3 条测试。已知安全失败：同一轮同一文件只能改成一个指南（提交用旧文件指纹，第二个会被 GitHub 拒绝）；品牌尾巴与 60 字符截断是后续事项。
