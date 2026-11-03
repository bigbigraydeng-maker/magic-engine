---
id: 2026-11-04-social-weekly-loop-p2-fact-check
title: 社媒每周闭环 P2：片子文字对客户目录做事实核对
status: done
owner: agent
decided_on: 2026-11-04
source: doc:docs/specs/2026-11-04-social-agent-weekly-loop-design-v1.md
done_on: 2026-11-04
done_ref: pr:3575
verify_by: 2026-11-18
verify_how: 合并后 npx vitest run src/lib/social/weekly-loop/__tests__/fact-check.test.ts src/lib/social/weekly-loop/__tests__/fact-claims-en.test.ts src/lib/social/weekly-loop/__tests__/fact-aliases.test.ts 全绿；第一阶段试跑时 loadSocialFactSource 连真库读到 CTS 目录与旧团名，10 条练习题已知错误全部判不通过
---
设计 v1.1 §2.1：英文说法提取 + 按链接认团逐项比对（天数 / 星级 / 金额 / 出发日 / 游轮 / 在售）+ 旧团名从目录历史推导；认不出团时有数字一律转人工；出错转人工。11-04 练习重放 10/10 拦下、13 条无误拦。只读，不发布。
