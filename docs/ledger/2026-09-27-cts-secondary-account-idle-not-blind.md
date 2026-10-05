---
id: 2026-09-27-cts-secondary-account-idle-not-blind
title: CTS 二号广告账户 4 天没花费数据，查明是广告没在投（不是取数断了）
status: done
owner: agent
decided_on: 2026-09-27
source: doc:docs/clients/cts/2026-09-27-secondary-ad-account-idle-investigation.md
done_on: 2026-09-27
done_ref: doc:docs/ledger/2026-09-27-cts-secondary-account-idle-not-blind.md
verify_by: 2026-10-11
verify_how: 到期查两件：①不论那 3 个广告组是否还暂停，都查 `cron_run_logs`（`job_name='google-data-pullback-daily'`）最近 3 天每一行 `summary.ad_daily_secondary_receipts` 里是否都有一条 `ad_account_id` 为 CTS 二号账户（act_2202695063810470）、`client_id` 为 CTS 的记录——**这条回执本身有没有出现，才是判据；有记录且 `ad_daily_success=true` 才算这天真的查过**，`ad_daily_success=false` 或**当天那一行完全没有这个账户的记录**（账户从 `client_meta_ad_accounts` 掉出注册、meta token 缺失、ad strategy 被关等原因，取数循环压根没跑到它）都直接判 failed、owner 转 pm——不能拿"没有花费行"当"取数正常"的证据，零花费和取数真断在数据表现上一样，必须看这条回执有没有落下来，取数失败也要能持续告警而不是只在这次到期检查里抽查一次。若这三天 `cron_run_logs` 里连 `google-data-pullback-daily` 这个 job 本身都没跑过（跟心跳 `12f3c5c4-4524-48b8-92c5-72fd2b775d01` 对一下），同样判 failed。②如果发现那 3 个组已被打开 → 额外确认开组当天起该账户逐日花费确实进库、熔断确实看到新花费。**不要因为这张卡写着「没在投」，就默认这个账户以后都可以不管**
---
CTS 二号广告账户连续 4 天无花费数据，快照仍显示部分系列 ACTIVE，一度怀疑是取数断了（监控盲区）。
逐组核实：那些系列下的广告组全是 PAUSED，是广告本身没在投，不是取数故障；直接问 Meta 拿逐日花费与我们库里记录一致。
调查细节、逐日花费与账户状态见 `source` 指向的证据文档；通用判读经验已写进广告手册 §二十九。
