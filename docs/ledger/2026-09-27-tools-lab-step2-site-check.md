---
id: 2026-09-27-tools-lab-step2-site-check
title: 工具实验室第二步——网站免费诊断上架：不再给访客看假结果（AI 失败或打不开网站就如实说），加防刷和每月花费上限，中文页出中文结果和中文邮件，报告邮件一条线索只发一次并全部转义
status: done
owner: agent
decided_on: 2026-09-27
source: session:4bb834a6
done_on: 2026-09-27
done_ref: doc:docs/specs/2026-09-27-tools-lab-step2-site-diagnosis-design.md
verify_by: 2026-10-06
verify_how: 上线后在 magicengine.com.au/cn/discover 用一个真实公开网站（非客户站）走一遍：① 结果是中文、每条写了「在哪里看到」；② 留自己邮箱，几分钟内收到中文邮件，标题「你的网站诊断结果：…」；③ 同一网址再提交一次，提示「24 小时内已经诊断过」；④ 填一个打不开的网址（如 nonexistent-xyz-123.com），提示打不开、不出结果。不成：先看 Cloudflare Pages 这次部署是否成功。
---
设计 v2：docs/specs/2026-09-27-tools-lab-step2-site-diagnosis-design.md（设计审 子牙 4 BLOCKER、魏征 4 BLOCKER、板桥文案，全部并入）。每月上限 1500 次（约 US$25–30），每访问者每天 3 次诊断、5 封邮件；计数用数据库现有的原子计数函数，调 AI 之前先扣，计数读不到就拒绝。留作后续：Cloudflare 人机验证、月度名额 80% 的今日待办提醒、报告邮件走 Resend 与「发信只走 Gmail」规矩不一致。
