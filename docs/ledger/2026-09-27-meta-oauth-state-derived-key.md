---
id: 2026-09-27-meta-oauth-state-derived-key
title: 广告只读授权的防伪签名改用单独派生的钥匙，不再和 Facebook 删除数据回调共用同一把应用密钥；本窗口在自助开通合并后做，不单独开窗口
status: decided
owner: agent
decided_on: 2026-09-27
source: session:4bb834a6
verify_by: 2026-10-04
verify_how: 查有没有这个 PR 已合并：广告授权跳转里的防伪签名用派生钥匙，旧签名在切换窗口内仍能验过；删除回调仍用应用密钥验签。没有就问本窗口卡在哪。
---
来源：PR 2111 狄仁杰攻击验证（中风险，非阻塞）。原任务卡（task_127cddea）按小秘书 9/27 梳理撤掉，并入本窗口：改动文件与 PR 2112 相同，等它合并后做，避免两边改同一文件。属 A 级（鉴权）。
