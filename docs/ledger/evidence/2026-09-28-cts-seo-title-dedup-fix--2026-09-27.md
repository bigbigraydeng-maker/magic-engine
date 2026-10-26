# 证据：CTS SEO 标题去重——网站侧改动已合并上线（L = 2026-09-27）

跨仓库指针放这里，不写进卡片 frontmatter 的 `done_ref`（本仓库的 `pr:` 解析按
`GITHUB_REPOSITORY` 解析号码，跟 chinatravel 仓库自己的 PR 号会撞车判重）。

- 代码改动：[chinatravel#212](https://github.com/bigbigraydeng-maker/chinatravel/pull/212)
- 合并信息：`mergedAt=2026-09-27T15:43:30Z`、`mergeCommit=ed46c7e6e9d3044c23cfb3466299c4d77706da90`、
  `mergedBy=bigbigraydeng-maker`（PM 本人，2026-09-28 对话内确认）
- 部署：chinatravel 的 `CLAUDE.md` 载明 main 分支合并即触发 Render 自动部署，未另外人工发布
- 改动内容：6 个页面标题改动（3 处纯标题收紧、2 组"独立页+博客互抢同一话题"各改博客标题+加一条
  内链）；无删除内容、无改动价格/日期/政策事实
- 当场验证：chinatravel 仓库内 `npx tsc --noEmit`（退出码 0）、`npm run build`（退出码 0，56 页全部
  编译）；6 个改动页面构建产物里的 `<title>` 标签（含站内自动加的 ` | CTS Tours` 后缀）逐一核实为
  54–60 字符
- 数据库重置（本文件写成当天执行）：`seo_meta_log` 对应这 6 行的 `optimised_at` 已从占位值
  （写卡当天 2026-09-28）改写为 L 当天真实合并时间 `2026-09-27T15:43:30Z`；`baseline_ctr` /
  `baseline_position` / `baseline_impressions` 已用 GSC 12 周真实数据（2026-07-01~09-25，L 之前
  最后一个干净数据点）重新查询并重写；`checked_at` / `outcome` / `observed_ctr` /
  `observed_impressions` 确认为 NULL（cron 尚未扫描过这批行）

## 线上标题实读（2026-10-10 05:05 UTC，只读，样本 6 页）

- 5 页线上 title 与 seo_meta_log 记录的新标题一致（站内自动加 ` | CTS Tours` 后缀）。
- 签证指南页线上现为「China Visa-Free for NZ: 30 Days to 31 Dec 2026」，与记录的「…30 Days, No Application」不同——上线后又被别的改动动过标题，回看这一页时要先弄清这一点，不能直接当作本次改动的效果。
- 没验的：6 页在 09-27 当天的线上标题（当时没做实读，只有构建产物核对）。
