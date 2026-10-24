---
id: 2026-10-20-ads-crm-gate-ad-landing-form
title: 开投前检查的「官网线索进 CRM」只认广告落地页上提交的表单，联系页的线索不能替它作证
status: decided
owner: agent
decided_on: 2026-10-20
source: session:1f83deb6
verify_how: 合并部署后对 CTS 重跑一次开投前检查：库里只有联系页的表单线索时，这道门应为灰「只验证了联系页等其它表单」（硬门灰，挡前置条件并出今日待办）；统筹在广告落地页上用非本公司邮箱提交一条内部测试、下一轮每小时同步后再重跑，这道门应变绿，证据里 ad_landing_form_touchpoints_7d 至少 1
---
设计稿 docs/specs/2026-10-19-ads-tracking-preflight-workflow.md 第 8 节；代码在 src/lib/ads-tracking-preflight/（crm-reader.ts 按来源页分类，judge.ts 判灯），统筹 18 号 10-20 提出的限制。
库里线索没有存「表单种类」，只存了来源页（metadata.source_url），所以按来源页是不是落地页配置里的页面来判，不依赖任何一家的表单叫什么。
「广告落地页上 0 条」判成硬门灰（没证据）：挡前置条件、总灯是灰、出今日待办（统筹 18 号 10-20 定，因为没证据时显示「前置条件满足」会误导开投决定）；有证据但过期 / 读不出时间才是黄。
