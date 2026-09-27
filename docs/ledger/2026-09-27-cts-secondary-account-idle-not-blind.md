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
verify_how: 到期查两件：①不论那 3 个广告组是否还暂停，都先查 `google-data-pullback-daily`（每天 3am 跑，healthchecks.io 心跳 `12f3c5c4-4524-48b8-92c5-72fd2b775d01`）最近 3 天对 CTS 二号账户的回执/`cron_run_logs` 记录是不是成功——**不能拿"没有花费行"当"取数正常"的证据**，零花费和取数真断在数据表现上一样，必须看回执本身；回执缺失或失败 → 直接判 failed、owner 转 pm，不用等广告组重新打开才发现，取数失败也要能持续告警而不是只在这次到期检查里抽查一次。②如果发现那 3 个组已被打开 → 额外确认开组当天起该账户逐日花费确实进库、熔断确实看到新花费。**不要因为这张卡写着「没在投」，就默认这个账户以后都可以不管**
---
CTS 二号广告账户连续 4 天无花费数据，快照仍显示部分系列 ACTIVE，一度怀疑是取数断了（监控盲区）。
逐组核实：那些系列下的广告组全是 PAUSED，是广告本身没在投，不是取数故障；直接问 Meta 拿逐日花费与我们库里记录一致。
调查细节、逐日花费与账户状态见 `source` 指向的证据文档；通用判读经验已写进广告手册 §二十九。
