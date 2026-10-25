---
id: 2026-10-20-fix-paid-tagging-test-mock
title: 修复一个因网站表单入库新增函数而整个文件加载失败的测试（付款识别定时任务的测试替身少了一个导出）
status: decided
owner: pm
decided_on: 2026-10-20
source: session:96dc6edf
verify_by: 2026-10-22
verify_how: 合并后在干净主干上跑 npx vitest run src/app/api/cron/mailchimp-paid-tagging，整个文件能加载、测试全部通过；全量测试里这一条不再红
---
只改测试替身，不改任何业务代码。
