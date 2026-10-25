---
id: 2026-10-25-manual-prescription-import-page
title: 贴入处方前先预览，批准和退回都要再确认
status: done
owner: agent
decided_on: 2026-10-25
source: issue:3127
verify_by: 2026-10-27
verify_how: 合并部署后，在客户处方页贴入一份 JSON，先看到预览再保存；处方页能看见开方人和「人工执行」；点批准或要求修改之前都会再问一次。
done_on: 2026-10-25
done_ref: commit:c1e7a134bcd03e557e04f4fb066b5c5c0e4c1aa8
check_note: 本机相关测试和类型检查已过。页面还没在登录后的浏览器里点过。
---
贴入页只往手工处方接口提交，不带批准。人工动作显示「人工执行」。要求修改会标成已拒绝。
