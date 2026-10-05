---
id: 2026-09-25-platform-oauth-connection-health
title: 外部平台授权断了要自动进今日待办，别再像 CTS 邮箱那样断 9 天没人知道
status: verified
owner: agent
decided_on: 2026-09-25
source: session:b5b83efc
verify_by: 2026-09-27
verify_how: 合并后隔天打开今日待办邮件，「🙋 需要你动手」里应出现 Roman HU / NZCPE 的 Facebook 断线和 CTS 的 bdm@ 邮箱断线，「🛠 系统欠账」里应出现 NAL 谷歌搜索数据「不在取数名单里」；再点一下 Roman HU 那条链接，确认打开的是客户页「平台连接」抽屉、看得到 Facebook 主页那一块。两栏各至少一条 + 链接点得进去 = 成。一条都没有先查 pushPlatformConnectionItems 是不是被链接闸丢了或被 catch 吞了。
done_on: 2026-09-25
done_ref: pr:2012
last_checked: 2026-09-28
check_note: 9-27真实邮件确认Roman HU/NZCPE FB断线+CTS邮箱断线三条都出现；NAL系统欠账条目因9-26pm-todo-five-kinds决定挪出邮件，非功能故障
verified_ref: doc:docs/ledger/evidence/2026-09-25-platform-oauth-connection-health--2026-09-28.md
---
判据在 `src/lib/platform-oauth/connection-health.ts`（纯函数，每个平台的心跳节奏逐个表态），
下发在 `src/lib/pm-todo/platform-connection-items.ts`。
改 `*_SCOPES` 的闸门在 `src/lib/platform-oauth/__tests__/scope-change-gate.test.ts`，
另一道钉「谷歌刷新不带 scope、微软刷新必须带」的在 `token-manager.test.ts`。
事故与判据全文见 `docs/PITFALLS.md` F11 / F12。
