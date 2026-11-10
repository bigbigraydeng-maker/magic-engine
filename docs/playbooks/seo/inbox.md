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

## 2026-11-03 · 只修了「被拦」那一层，零上线照旧：9 个候选名额里 8 个在生成前就注定失败
- 层级：客户·CTS（单客户候选）
- 发生了什么：PR 3368（10-28 合并）修好了「新文案丢了 CTS 就拦」这道硬规则。W45（11-02）回执里这个原因确实一次都没再出现，但这已是**连续第 5 周**（W41–W45）`applied=[]`、`seo_meta_log` 新增 0 行（最后一行仍是 2026-09-28）。W45 的 9 个候选里有 8 个在生成新文案之前就失败了，原因都能提前判出来：受保护页 3（china-tours、china-visa-guide-for-new-zealanders、china-visa-free-nz-2026）、数据文件里找不到这一页 2（xian-city-wall-travel-guide 已连续 4 周、visa-requirements）、没有关键词数据 2、搜索结果里排的是自家另一页 1。只有 1 页走到了生成，又被 AI 判官拦下（见下一条）。另外，PR 3368 当场试跑挑的是 3 个以前被拦过的页面，这 3 页 W45 一个都没进候选，所以「试跑通过」没法预测下一轮能不能上线。
- 证据：生产库 `cron_run_logs`，`job_name in ('seo-meta-cycle-step3-prescribed','seo-meta-cycle-step4-applied')`，W40–W45 的 `summary.failures[].reason` 与 `summary.applied`（2026-11-03 09:30 NZDT 取数）；`seo_meta_log` `max(created_at)=2026-09-28 05:32:54+00`、近 7 天新增 0；PR https://github.com/bigbigraydeng-maker/magic-engine/pull/3368；`docs/ledger/2026-10-29-cts-meta-cycle-generator-sees-original.md`（verify_by 2026-11-03，验收条件「至少 1 页上线」本轮未达成）；试跑证据 `docs/ledger/evidence/2026-10-29-cts-meta-cycle-generator-sees-original--trial.md`。
- 建议的规则或检查：①修「零产出」时，试跑要先把**下一轮真实的候选名单**演练一遍（第 2 步选候选 + 第 3 步闸门），把整条链路跑到底；只拿挑出来的历史页做试跑不算数。②能提前判出来的失败（受保护页、数据文件里找不到、连续 ≥2 周没有关键词数据）在选候选那一步就排除，名额补给下一个候选。③验收写「≥1 页上线并读回线上」，回执全绿不算。
- 与现有手册关系：印证 10-29 候选第 2 条的建议②，新数字：W45 有 8/9 名额浪费，xian-city-wall-travel-guide 连续 4 周占位；新增「试跑必须用下一轮真实候选」。

## 2026-11-03 · AI 判官只回一个分数、不说是哪句话有矛盾，被拦了谁都学不到东西
- 层级：通用·候选（所有用这个判官核事实的客户都受影响；目前只有 CTS 一个客户的证据）
- 发生了什么：W45 唯一走到生成的页面 `liziba-station-chongqing-guide`，被判官以 0.89 分拦下（门槛 0.5）。回执里的原因只有一句 `contradiction score 0.89 ≥ 0.5 threshold`，没写是哪个说法冲突。新描述里加了原文没有的「Kiwi travellers」「light rail」「photography tips」，判官提示词会把「原文没有的新事实」也算矛盾，这可能就是被拦的原因，但**没有证实**，因为判官没给理由。所以生成那一步没法拿拒绝原因去重写，人工也没法判断是判官判错了还是文案写错了。
- 证据：`src/lib/seo-meta/cycle/fact-check.ts:58-76`（`reason` 只拼了分数）；生产库 `cron_run_logs` `job_name='seo-meta-cycle-step4-applied'`，W45 `proposals[0].factCheckReason` 与 `newDesc`/`oldDesc`（2026-11-03 取数）。
- 建议的规则或检查：判官调用时多要一个字段，写明「冲突的是哪句、属于哪一类（数字 / 地点 / 范围收窄 / 新编事实）」，存进回执；生成那一步重试时把这句话带进去；人工卡也显示这句话。只有分数、没有理由的拦截，按「判官结果不完整」记录，不算「事实冲突」。
- 与现有手册关系：补充 playbook-seo-general.md 第 80–86 行（判官漏判范围收窄），这条讲判官拦对拦错都说不清；也补充 10-29 候选第 2 条「拒绝原因不回流」：硬规则的原因能回流，判官的原因现在根本拿不到。

## 2026-11-03 · 同一个景点有 3 个页面，轮流占名额又互相拦：李子坝 W41–W45 占了 7 次名额，0 次上线
- 层级：客户·CTS（单客户候选）
- 发生了什么：李子坝在官网至少有 3 个 slug：`liziba-station-chongqing`、`liziba-station-chongqing-guide`、`liziba-monorail-chongqing-guide`。W41–W45 它们共进了 7 次候选，原因依次是：关键词 90 天内已被别的页用过（W41）、搜索结果里排的是自家另一页（W42、W44）、没有关键词数据（W43、W44、W45）、判官拦（W45），一次都没上线。重庆还有一组同类情况：`how-many-days-in-chongqing` 想冲的词，搜索结果里排的是 `chongqing-chengdu-itinerary-10-days`（W45）。说明问题不在标题写得好不好，而是**同一个话题有好几个页面在抢同一个词**，改标题解决不了。
- 证据：生产库 `cron_run_logs` `job_name='seo-meta-cycle-step3-prescribed'`，W40–W45 按 `failures[].reason` 分组的 slug 清单，加上 W45 `step4-applied` 的 proposals（2026-11-03 取数）。
- 建议的规则或检查：选候选时按「话题 / 目标词」去重，同一话题一周只出 1 个候选；同一话题 ≥2 个页面、连续 ≥2 周出现「自家另一页在排」或「关键词已被别页用过」，就别再出改标题方案，改出一张「合并页面并永久跳转」的建议卡。按 SOP §2.2c，非保护页、有抢词证据的合并是档 2，要先查旧页有没有重要外部链接。
- 与现有手册关系：补充 playbook-seo-general.md 第 147 行（词级抢词要按词查），这条讲抢词在周循环里会反复浪费名额；新增。

## 2026-11-03 · 修正 10-29 第 3 条：排名采样每天派 0 条是按设计运行，真正的缺口是没有新改动上线
- 层级：客户·CTS（单客户候选）
- 发生了什么：10-29 第 3 条建议「采样器派 0 条就算失败」。同一天的台账卡查实：判定程序只判「上线时记了改前名次」的改动，9-27/28 那 7 条是在这个功能上线前改的，按设计不判；10 月起又一条新改动都没上线，所以每天派 0 条。本周 10-26 到 11-01 采样器仍是 7 天 `rows_dispatched=0`，`seo_meta_log` 那 7 条已上线改动仍然全部没有判定。PR 3374 已经补了今日待办提醒（上线超过 35 天没判定，或上线时没记改前名次）。
- 证据：`docs/ledger/2026-10-29-seo-rank-verdict-gap-alert.md`；PR https://github.com/bigbigraydeng-maker/magic-engine/pull/3374；生产库 `cron_run_logs` `job_name='seo-meta-rank-sampler'` 10-26～11-01 七行，`seo_meta_log` live 7 / 未判定 7 / 近 7 天新判定 0（2026-11-03 取数）。
- 建议的规则或检查：把 10-29 第 3 条的检查改成「新上线的改动没有记改前名次 → 报人工」，「派 0 条」本身不算失败。判不出效果的根因跟本周第 1 条是同一个：没有新改动上线。
- 与现有手册关系：修正本候选区 10-29 第 3 条（升正文时以本条为准）。

## 2026-11-10 · 硬规则把「同一组天数换了写法」当成丢事实 + 编事实，拦下了一条其实没改事实的文案
- 层级：客户·CTS（单客户候选；这段规则代码是所有客户共用的）
- 发生了什么：W46（11-09）`how-many-days-in-chongqing` 走到了生成，被硬规则拦下，原因原文是「drops fact(s) from the original — NZ, 2 days, 5 days; also introduces fact(s) not in the original — 2, 7」。原文：标题「3, 5 or 7 Days」，描述「2 days, 5 days, or longer … by CTS Tours NZ」；新文：标题「2, 3, 5 or 7」，描述「covering 2, 3, 5 and 7-day itineraries」。2、3、5、7 这几个天数新旧都有，只是写法从「2 days」变成「2, 3, 5 and 7-day」；「7」原标题里就有，却被判成「新编的」。另外「NZ」来自原文署名「CTS Tours NZ」，就算把「CTS Tours NZ」整个加进品牌忽略词，「NZ」照样被当成地名事实拦（本地复现，见证据）。
- 证据：生产库 `cron_run_logs` `job_name='seo-meta-cycle-step4-applied'`，W46 `summary.proposals[1]` 的 `factCheckReason` / `oldTitle` / `oldDesc` / `newTitle` / `newDesc`（2026-11-10 取数）；`src/lib/seo-meta/cycle/hard-fact-check.ts:283-322`（`checkHardFactsPreserved`，把「数量」和「裸数字」分两套抽取、分别比对）；本地复现：用这四段原文直接调 `checkHardFactsPreserved`，`ignoreTerms` 为 `[]`、`['CTS Tours','CTS']`、`['CTS Tours NZ','CTS Tours','CTS']` 三种情况都返回同一条拦截原因（2026-11-10，`npx tsx` 一次性脚本，未进仓库）。
- 建议的规则或检查：①比对数字前先把「2 days」「2-day」「2, 3, 5 and 7-day」里的数字统一抽出来再比，只在「某个数字新旧两边都找不到」时才算丢 / 新编；②品牌署名（含「CTS Tours NZ」这种带地区后缀的写法）整体从事实抽取里剔除，别再单独抽出「NZ」；③给这条用例加一个回归测试（上面四段原文应判通过）。硬规则仍按「宁可多拦」设计，但被拦的原因要是真事实。
- 与现有手册关系：补充 playbook-seo-general.md 第十三节（事实核对）；与本候选区 10-29 第 2 条（丢 CTS 被拦，PR 3368 已修）同一类问题的新变体：修了「CTS」，没修「NZ」和数字写法。

## 2026-11-10 · 新标题被硬截在第 60 个字符，截在单词中间（「…Famous Train Stat」）
- 层级：通用·候选（共用代码，任何客户都会遇到；目前只有 CTS 一个客户的实例）
- 发生了什么：W46 `liziba-station-chongqing-guide` 的新标题是「Liziba Station Chongqing: Guide to China's Famous Train Stat」，正好 60 个字符，最后一个词「Station」被切成「Stat」。这次它被判官拦下所以没上线；如果判官放行，这个半截标题会直接改到客户网站上。代码里生成后一律 `.slice(0, 60)`，不看是不是切在单词中间，后面的事实核对和判官也不检查标题完不完整。
- 证据：生产库 `cron_run_logs` `job_name='seo-meta-cycle-step4-applied'`，W46 `summary.proposals[0].newTitle`（2026-11-10 取数）；`src/lib/seo-meta/cycle/runner.ts:385`、`:397`、`:458`（`title.slice(0, AI_META_MAX_TITLE)`，`AI_META_MAX_TITLE = 60`）；同样写法在 `src/lib/seo-meta/cycle/ai-meta.ts:95` 和 `src/lib/seo-meta/cts-meta-pr.ts:351`。
- 建议的规则或检查：超长时退回到最后一个完整单词（必要时去掉末尾标点），或者超长就让模型重写一次；加一条机器检查「新标题最后一个词不在原文 / 关键词 / 词典里 → 判截断，不上线」。
- 与现有手册关系：新增（手册讲了标题长度上限，没讲超长怎么处理）。

## 2026-11-10 · 判官连续第 2 周只给分数就拦李子坝，这周的新描述几乎是原文改写
- 层级：客户·CTS（单客户候选）
- 发生了什么：`liziba-station-chongqing-guide` W45 被判官以 0.89 拦，W46 又以 0.70 拦，两次原因都只有「contradiction score ≥ 0.5 threshold」。W46 的新描述是「China's most photographed railway station … how to visit, and capture the best shots」，原文是「the most photographed railway station in China — and possibly the world … how to visit, and how to get the best shot」，看不出事实冲突；可能的嫌疑是标题被截成「Train Stat」（见上一条）或「Famous」，但判官没给理由，**没法证实**。李子坝这组页面至此 W41–W46 共进候选 9 次、上线 0 次。
- 证据：生产库 `cron_run_logs` `job_name='seo-meta-cycle-step4-applied'`，W45、W46 的 `proposals[]` 里该 slug 的 `factCheckReason` / `oldDesc` / `newDesc` / `newTitle`（2026-11-10 取数）；W46 `step3-prescribed` 里 `liziba-monorail-chongqing-guide` 仍是 `keyword_data_unavailable`。
- 建议的规则或检查：同本候选区 11-03 第 5 条（判官必须写明冲突的是哪句）；加一条：同页连续 2 周只因「判官分数」被拦、且没有理由 → 直接转人工看一眼，不要第 3 周再自动提同一页。
- 与现有手册关系：印证本候选区 11-03 第 5 条（新数字：第 2 周、0.70、改写度很高），并印证 11-03 第 6 条（李子坝占名额从 7 次到 9 次）。

## 2026-11-10 · 修复的验收日已过 7 天，「一页没上线」的台账卡还停在 decided，周循环已连续 6 周零上线
- 层级：客户·CTS（单客户候选）
- 发生了什么：W46（11-09）`applied=[]`、`logged_rows=0`，这是 W41–W46 连续第 6 周零上线；`seo_meta_log` 仍是 65 行，最后一行 2026-09-28，近 7 天新增 0。W46 9 个候选里 7 个在生成前就失败（受保护页 3、数据文件里找不到 2 —— `xian-city-wall-travel-guide` 已连续 5 周、`visa-requirements` 连续 2 周、没有关键词数据 1、没有本页专属关键词 1），走到生成的 2 个分别被判官和硬规则拦下（见前两条）。台账卡 `2026-10-29-cts-meta-cycle-generator-sees-original` 的验收是「至少 1 页上线」、`verify_by: 2026-11-03`，W45、W46 两轮都没达成，卡片状态却仍是 `decided`，没有改成 `failed`，今日待办读台账时看不出这件事失败了。排名采样器本周 7 天仍是每天派 0 条，7 条已上线改动仍全部没有判定（原因同 11-03 第 7 条）。
- 证据：生产库 `cron_run_logs` `job_name like 'seo-meta-cycle-step%'`，W45、W46 共 12 行；`seo_meta_log` 总数 / `max(created_at)` / 近 7 天新增；`cron_run_logs` `job_name='seo-meta-rank-sampler'` 近 7 天 7 行、`rows_dispatched` 全为 0（2026-11-10 取数）；`docs/ledger/2026-10-29-cts-meta-cycle-generator-sees-original.md`（`status: decided`，`verify_by: 2026-11-03`）。
- 建议的规则或检查：①台账卡过了 `verify_by` 还没达成验收，巡检要自动把它标成「到期未验证」并进今日待办，不能一直停在 decided；②印证 10-29 第 1 条的「产出体检」：连续 ≥2 周 `proposals>0 且 applied=0` 就开人工卡——这条到今天还没有任何机制在做。
- 与现有手册关系：印证本候选区 10-29 第 1 条、11-03 第 1 条（新数字：第 6 周、W46 7/9 名额生成前失败、xian-city-wall 第 5 周）；新增「过期台账卡不会自己变 failed」。
