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
verify_how: 这是判读结论、不需要重验数字。到期只查一件：CTS 二号账户那 3 个暂停的广告组有没有被人打开。打开了 → 确认我们的每日取数和熔断照得到它（查最近 3 天该账户有没有逐日花费进库）；还是暂停 → 什么都不用做。**不要因为这张卡写着「没在投」，就默认这个账户以后都可以不管**
---
CTS 二号广告账户连续 4 天无花费数据，快照仍显示部分系列 ACTIVE，一度怀疑是取数断了（监控盲区）。
逐组核实：那些系列下的广告组全是 PAUSED，是广告本身没在投，不是取数故障；直接问 Meta 拿逐日花费与我们库里记录一致。
调查细节、逐日花费与账户状态见 `source` 指向的证据文档；通用判读经验已写进广告手册 §二十九。
