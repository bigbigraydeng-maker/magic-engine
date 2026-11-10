---
id: 2026-11-10-me-send-gate-tests-not-in-required-checks
title: 发信底座的测试不在合并前必过的检查里：改到这些文件的单子测试变红也没人知道（第 2 单的回执测试就在主干上红过 3 条）；要把这几个目录加进必过检查
status: decided
owner: agent
decided_on: 2026-11-10
source: session:33ebcd0b
verify_by: 2026-11-24
verify_how: 看是否已：①另开一张单，把 src/lib/messaging、src/app/api/clients/[id]/triggered-send、src/app/api/webhooks/resend、src/app/api/u、CRM 的 welcome-letter 页面这几处的测试加进合并前必过的检查（.github/workflows/pr-light-checks.yml）；②那张单是 A 级（改 .github），PM 本人回「合 <单号>」后合并；③合并后随便开一张碰到这些目录的单，检查里能看到这些测试在跑。缺哪件写哪件
---
子牙在第 3 单之一第一轮审查里提出（P2-10）：pr-light-checks 只跑指定的几组测试，不含发信底座。第 2 单 #3736 的回执接口测试因此在主干上红了 3 条，合并前没被拦（第 3 单之一已补上那 3 条）。别处的小改动（比如 crm/email-templates/placeholders.ts，自动信模板检查靠它）会被机器自动合并，发信底座的安全测试变红也没人知道。
做法：只加测试目录，不改别的检查；改 .github 机器判 A，按规矩由 PM 亲手合。不在第 3 单之一里做（那张单不动 .github）。
