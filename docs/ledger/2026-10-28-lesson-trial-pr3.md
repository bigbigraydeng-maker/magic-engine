---
id: 2026-10-28-lesson-trial-pr3
title: 经验开/关对照试验（PR-3）：固定虚构样例并排看建议，每天模型花费硬上限 1 美元且写库持久化
status: decided
owner: pm
decided_on: 2026-10-28
source: issue:3088
verify_by: 2026-11-02
verify_how: Ray 合并并部署后，在广告引擎页对一条未启用的 Jon Loomer / Glenn Gabe 候选点「试一下」，看到左右两栏建议、页面显示今天已花金额；确认「采用」不会让经验变成启用
---
A 级（带一个新表迁移 `20261027200000_agent_learning_trial_spend.sql`）。迁移只在 Ray 合并并部署时执行，agent 不执行。
「采用」只在页面当次记录决定，不启用任何经验；「不要」保持不启用。启用仍由 Ray 手动点开关。
只有 `evidence.kind = expert_rss_candidate` 且 key 以 `expert-jon-loomer-` / `expert-glenn-gabe-` 开头的候选有「试一下」；Common Thread Collective 暂不试。
花费：先在库里原子预留（两次调用的最坏花费），调用后按实际结算，今天预留+已花达到 1 美元即拒绝；日界线为 UTC 自然日。
已知缺口：模型调用失败时预留保留不释放（fail-closed，每次最坏约 0.0035 美元）；结算不做幂等保护，同一次对照只会结算一次。
