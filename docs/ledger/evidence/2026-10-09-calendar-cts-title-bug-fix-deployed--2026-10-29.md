# 证据 · 2026-10-09-calendar-cts-title-bug-fix-deployed · 2026-10-29
fetched_at: 2026-10-29T21:36:35+1300
查了什么：PR 1948 合并提交是否在主干上；最新部署是否成功且包含该修复；9/28 起新周循环有没有错改。
数字（带样本量、两边取数状态）：PR 1948 合并提交 b80d2954，合并于 2026-09-26T14:12Z；git merge-base --is-ancestor b80d2954 origin/main 退出码 0。GitHub 部署记录最新一条（sha dbbe67e4，main - magic-engine，2026-10-24）状态序列 in_progress→success(09:44Z)→inactive(09:48Z，被后续部署替换)；dbbe67e4 包含 b80d2954（is-ancestor 退出码 0）。线上首页 curl 返回 200。新周循环单子只有 chinatravel#214，无错改（见同日 2026-10-09-calendar-cts-monday-title-pr-no-vendor-name 证据）。
来源/命令：gh pr view 1948；git merge-base；gh api repos/.../deployments 与 /statuses；curl magicengine.com.au
结论：成。修复在主干且已成功部署，之后无新错改。
