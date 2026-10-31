孔子学习候选区——未经子牙签字 + PM 合并的内容都只是候选，不是规则。

## 2026-10-29 · 标题周循环连续 4 周回执全绿，却一页都没上线，没有任何东西会为此喊人
- 层级：客户·CTS（单客户候选）
- 发生了什么：CTS 的 seo-meta-cycle 第 4 步回执 W41–W44 共 4 周全部 `completed`，但 `applied` 都是空的（共 8 条提案全被事实核对拦下）；最近一次真正上线是 W40（2026-09-28，1 页：beijing-to-xian-high-speed-train）。`seo_meta_log` 9-28 之后新增 0 行（共 65 行）。现有健康检查只管「有没有跑」，不管「跑了有没有产出」。
- 证据：生产库 `cron_run_logs`，`job_name='seo-meta-cycle-step4-applied'`，W40–W44 的 `summary.applied` / `summary.proposals[].skipReason`（2026-10-29 取数）；`seo_meta_log` `max(created_at)=2026-09-28 05:32:54+00`；`docs/ledger/2026-10-04-seo-cron-registry-health-watch.md`（只登记「是否按时跑」）。
- 建议的规则或检查：给周循环加「产出体检」：同一客户连续 ≥2 周 `proposals>0 且 applied=0`，开一张人工任务卡（说明被拦原因分布 + 直达链接），不要只留在回执里。
- 与现有手册关系：补充 playbook-seo-general.md 第 51 行「验收看最终文字不看回执全绿」——那条讲改动内容，本条讲「根本没改」；新增。

## 2026-10-29 · 同一页被同一条硬规则连拦 5 周，生成端从不吸取拒绝原因
- 层级：客户·CTS（单客户候选）
- 发生了什么：`best-time-to-visit-china` 在 W40–W44 连续 5 周被提案、5 周被拦（W40 判官分 0.51≥0.5；W41 起为硬规则：新文案「丢了 CTS」或「多出 CTS Tours」）。新标题每次都把品牌名从标题里去掉（如 "Best Time to Visit China: Season Guide"）。`tianmen-mountain-travel-guide`、`liziba-station-chongqing` 同样被「丢了 CTS / New Zealand」拦 2 周。同时每周 9 个候选名额里，`china-tours`（受保护页）W41–W44 共 4 周、`china-tours-from-new-zealand` W42–W44 共 3 周、`xian-city-wall-travel-guide`（不在任何可编辑数据文件）W42–W44 共 3 周原样回来占位，`keyword_data_unavailable` 的 3 个页面几乎每周重复。
- 证据：同上 `step4-applied` 的 `proposals[]` 与 `step3-prescribed` 的 `summary.failures[]`（W40–W44，2026-10-29 取数）；回执里 factCheckReason 原文「hard rule (no AI involved): new text drops fact(s) from the original — CTS」。
- 建议的规则或检查：①生成提示里把「品牌名/地区词必须保留在标题中」写成硬约束，并把上周同页的 factCheckReason 作为反例喂回；②确定性失败（受保护页、slug 不在数据文件）在选候选阶段就排除，别占名额；③同页同原因被拦 ≥3 周 → 冷却 4 周或转人工。
- 与现有手册关系：补充 playbook-seo-general.md 第十三节（事实核对只测矛盾）；新增「拒绝原因不回流」。

## 2026-10-29 · 已上线的标题改动 7 条全部超期未出效果判定，每日排名采样每天派 0 条
- 层级：客户·CTS（单客户候选）
- 发生了什么：`seo_meta_log` 里 pr_url 非空且未撤回的 7 行，`checked_at` 全为空且上线已超 14 天，`rank_samples` 均为空、`rank_verdict` 均为空。`seo-meta-rank-sampler` 10-23 至 10-27 连续 5 天每天 `completed`，但 `rows_dispatched=0`（`counts_are=dispatched_not_sampled`）。W44 第 1 步 `checked=0`，`legacy_ctr_check=off_rank_shadow_period`。结果：已上线改动没有任何一条得到「单页单词」判定，学不到东西。
- 证据：生产库 `seo_meta_log`（条件：`pr_url is not null and reverted_at is null`，2026-10-29 取数：live 7 / overdue 7 / with_samples 0 / with_verdict 0）；`cron_run_logs` `job_name='seo-meta-rank-sampler'` 10-23～10-27 五行；样例行 id `695c098c-5320-492c-8691-dbd88fc41a88`（9-28 上线，31 天仍无 outcome）。
- 建议的规则或检查：采样器 `rows_dispatched=0` 而库里存在「已上线且无样本」的行 → 视为失败而不是完成；加一条机器检查「上线满 14 天仍无 rank_verdict」报人工卡。
- 与现有手册关系：新增（手册第 9 篇讲怎么判，未讲判不出来时怎么喊）。
