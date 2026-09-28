---
id: 2026-09-28-cts-seo-title-dedup-fix
title: CTS 网站6个页面标题改动+2组"两页打一件事"去重，等14天自动回看效果
status: done
owner: agent
decided_on: 2026-09-28
source: session:065e0f34
verify_by: 2026-10-12
verify_how: seo_meta_log 里这6行(pr_url含pull/212)到2026-10-12后会被每周一自动跑的SEO复查(cloud-seo-meta-cycle-fanout)自动读取真实GSC曝光/点击、写回outcome字段——到期查这6行的outcome是不是都不为空，不为空即为验过；不看cron有没有跑，看这6行有没有真被写了结果
done_on: 2026-09-28
done_ref: pr:212
last_checked: 2026-09-28
check_note: chinatravel仓库PR #212已由PM本人合并(commit ed46c7e，2026-09-27 15:43)，main分支合并即触发Render自动部署，已上线；seo_meta_log已插入6条基线记录(baseline_ctr/position/impressions取自GSC 12周真实数据2026-07-01~09-24)；npx tsc --noEmit与npm run build均退出码0；6个改动页面渲染出的<title>含站内自动加的" | CTS Tours"后缀后核实为54-60字符，符合站内自己的规范
---
诊断+方案见本会话记录（孔子/SEO agent，PM 2026-09-28 当场"做"授权）。
不用新建 Inngest：ME 已有 `cloud-seo-meta-cycle-fanout`（每周一自动跑，读 `seo_meta_log` 里
`optimised_at`超14天且`checked_at`为空的行，自动对比GSC真实数据、写回`outcome`），本次只是把
新的基线行喂给这套现成机制，没有新增代码/新增定时任务。
