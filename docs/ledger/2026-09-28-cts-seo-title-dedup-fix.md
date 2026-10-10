---
id: 2026-09-28-cts-seo-title-dedup-fix
title: CTS 网站6个页面标题改动+2组"两页打一件事"去重，网站已上线，等L+28天真实回看
status: done
owner: agent
decided_on: 2026-09-28
source: session:065e0f34
verify_by: 2026-10-25
verify_how: 网站侧改动已于 L=2026-09-27T15:43:30Z 合并上线（chinatravel#212，见 done_ref 证据文档），
  `seo_meta_log` 对应6行已在当天（2026-09-28）重置：`optimised_at`=L真实时间、`baseline_ctr`/
  `baseline_position`/`baseline_impressions`=L之前最后一个干净数据点(2026-07-01~09-25)的真实GSC值、
  `checked_at`/`outcome`/`observed_ctr`/`observed_impressions`确认为NULL。但`readPageMetrics`
  （src/lib/seo/post-publish-monitor-store.ts）读的是`gsc_performance_snapshots`里最近一条按
  `fetchGscSnapshot(...,28)`滚动28天生成的快照，`cloud-seo-meta-cycle-fanout`会在`optimised_at`
  超14天（L+14是10-11周日，实际是2026-10-12那个周一）第一次自动选中这6行判——那天的28天窗口还有约一半落在L之前，会把
  improved/regressed判稀甚至判反，**这次自动判定必须当假结果丢弃**：把这6行的`checked_at`/
  `outcome`/`observed_ctr`/`observed_impressions`清回NULL，让下个周一重新被选中，如此往复，直到
  某次`checked_at`落在2026-10-25(L+28)或之后——这时滚动28天窗口才完整落在L之后——才把那次的
  `outcome`当真采信；每次丢弃都要在这张卡的`check_note`里记一句"L+14天判定被丢弃，快照仍含上线前
  数据"，不能悄悄清空不留痕迹。采信那次看`outcome`：`improved`→转`verified`；`regressed`→转
  `failed`并判断是否revert；`insufficient_data`→不算验过也不算失败，人工清`checked_at`让它下个
  周一重新判一次，不能只把卡状态留在`done`当作已安排重试；`flat`(±1个百分点噪声带内，
  `classifyMetaChangeOutcome`的`FLAT_BAND`)→转`verified`(不是继续挂`done`，`done`在
  `src/lib/ledger/walk.ts`不是终态，到期不转会被`classifyDone`判`done_unverified`反复追问)，
  `check_note`写"flat：改动安全无回归但无显著提升"。若发现L+14自动判定已误触发`regressed`人工待办
  （`buildManualAction`），要在待办里注明"基于污染快照、待L+28重新回看"，不能放着不管。
done_on: 2026-09-28
done_ref: doc:docs/ledger/evidence/2026-09-28-cts-seo-title-dedup-fix--2026-09-27.md
last_checked: 2026-09-28
check_note: 网站侧PR(chinatravel#212)已由PM本人合并上线(commit ed46c7e，2026-09-27T15:43:30Z)。
  当天(2026-09-28)已完成复审指出的四件事：①`seo_meta_log`6行`optimised_at`改成L真实时间(之前是
  写卡当天2026-09-28的占位值)；②`checked_at`/`outcome`/`observed_ctr`/`observed_impressions`确认
  清为NULL；③`baseline_ctr`/`baseline_position`/`baseline_impressions`用GSC 2026-07-01~09-25(L前
  最后干净数据点)真实值重写，不再用占位当天的旧快照；④`verify_by`改成L+28=2026-10-25(不是常规
  L+14)，原因见`verify_how`的28天滚动窗口污染问题。2026-10-12那次自动判定预期会被污染，届时需要
  人工清空重试，不要误当作已经验过。
---
诊断+方案见本会话记录（孔子/SEO agent，PM 2026-09-28 当场"做"授权；PM 随后指示"往下做+定期回看+
Inngest需要就设置好"）。改标题+去重内链的代码改动是 chinatravel 仓库
（github.com/bigbigraydeng-maker/chinatravel）里的一条独立 PR，写卡时那条 PR 还没合并，本卡先记
成`decided`；PM 已于当天在对话内确认合并，本卡随即翻成`done`并按下方"L 当天必做四件事"逐条补齐，
过程中另一窗口(复审)已核实过这套判据的技术细节（`runStep1CheckDue`/`readPageMetrics`/
`classifyMetaChangeOutcome`/`ledger/walk.ts`），本卡采信并执行完毕。

不用新建 Inngest：ME 已有 `cloud-seo-meta-cycle-fanout`（每周一自动跑，读 `seo_meta_log` 里
`optimised_at` 超14天且 `checked_at` 为空的行，自动对比 GSC 真实数据、写回 `outcome`），
[docs/ledger/2026-09-26-cts-title-cycle-stays-on.md](./2026-09-26-cts-title-cycle-stays-on.md)
已确认 CTS 的 `seo_config.meta_cycle_enabled=true`，这条 cron 本来就会照常扫描这6行——本次只是
喂给它正确的基线数据，没有新增代码或新增定时任务。

关闭路径（备用，本次未触发）：如果 chinatravel 那条 PR 后续被 revert 或该批改动被确认放弃，需要
直接从 `seo_meta_log` 删除这6行、把本卡 `status` 改成 `failed`，不能让它继续挂着旧状态。
