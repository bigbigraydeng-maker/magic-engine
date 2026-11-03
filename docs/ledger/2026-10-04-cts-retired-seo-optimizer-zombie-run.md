---
id: 2026-10-04-cts-retired-seo-optimizer-zombie-run
title: 已退役的 cts-seo-optimizer 在 Render 上仍活着，9/28 改错 CTS 三页标题
status: done
owner: pm
decided_on: 2026-10-04
source: doc:docs/clients/cts/2026-10-04-seo-optimizer-zombie-run-incident.md
done_on: 2026-10-04
done_ref: doc:docs/clients/cts/2026-10-04-seo-optimizer-zombie-run-incident.md
verify_by: 2026-10-12
verify_how: "① Render 服务 crn-d9mle96417fc73blovh0（cts-seo-optimizer）仍为 suspended；② cron_run_logs 里 job_name='cts-seo-optimizer' 自 2026-09-28 之后无新行；③ 线上三页标题仍是原文：/blog/liziba-monorail-chongqing-guide 为 'Liziba Monorail Through-the-Building…'、/blog/chongqing-night-city-lights 为 'Chongqing Night City…'、/china-tours-from-new-zealand 的 description 仍列出 4 团与 NZD $3,399–7,999。"
---
已退役的 cts-seo-optimizer 在 Render 上没被真正停掉，9/28 自己跑了一次并改错 CTS 三页标题，已回滚并停掉该服务。
完整经过、处置和副作用见 docs/clients/cts/2026-10-04-seo-optimizer-zombie-run-incident.md。
修复 PR 在 chinatravel 仓库（#219 回滚 #213），台账只认本仓库的 PR，所以指向上面这份说明。
