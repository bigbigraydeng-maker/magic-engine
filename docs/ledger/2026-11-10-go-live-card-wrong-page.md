---
id: 2026-11-10-go-live-card-wrong-page
title: 开投确认卡不能在普通确认页点成已授权
status: decided
owner: agent
decided_on: 2026-11-10
source: doc:src/lib/ads-go-live/decide.ts
verify_by: 2026-11-17
verify_how: 在确认卡页点开投卡不得把广告改成在投；只有等你点头的广告页点确认才走原来的开投检查。
---
开投卡仍会出现在确认卡页，但这里不能把它点成已授权。
确认要去等你点头的广告页，沿用原来的开投检查。
普通确认入口遇到开投卡直接拒绝，广告保持暂停。
没有新的广告写入，也没有改预算。
