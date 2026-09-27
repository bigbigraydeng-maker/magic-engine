---
id: 2026-09-25-platform-oauth-connection-health
title: 外部平台授权断了要自动进今日待办，别再像 CTS 邮箱那样断 9 天没人知道
status: done
owner: agent
decided_on: 2026-09-25
source: session:b5b83efc
verify_by: 2026-09-27
verify_how: 合并后隔天打开今日待办邮件，「🙋 需要你动手」里应出现 Roman HU / NZCPE 的 Facebook 断线和 CTS 的 bdm@ 邮箱断线，「🛠 系统欠账」里应出现 NAL 谷歌搜索数据「不在取数名单里」；再点一下 Roman HU 那条链接，确认打开的是客户页「平台连接」抽屉、看得到 Facebook 主页那一块。两栏各至少一条 + 链接点得进去 = 成。一条都没有先查 pushPlatformConnectionItems 是不是被链接闸丢了或被 catch 吞了。
done_on: 2026-09-25
done_ref: pr:2012
last_checked: 2026-09-27
check_note: 判不了：9-25 02:31 UTC 合并后今日待办邮件一次都没发过（最近一次 9-24 19:01 UTC 在合并前），邮件里有没有这几条断线看不到
---
判据在 `src/lib/platform-oauth/connection-health.ts`（纯函数，每个平台的心跳节奏逐个表态），
下发在 `src/lib/pm-todo/platform-connection-items.ts`。
改 `*_SCOPES` 的闸门在 `src/lib/platform-oauth/__tests__/scope-change-gate.test.ts`，
另一道钉「谷歌刷新不带 scope、微软刷新必须带」的在 `token-manager.test.ts`。
事故与判据全文见 `docs/PITFALLS.md` F11 / F12。
