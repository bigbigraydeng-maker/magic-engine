---
id: 2026-10-10-nal-messenger-brief-cts-pollution-regen
title: NAL 私信客户需求卡里 109 张把自己写成「CTS」的旧卡已重算干净（9-13 提示词事故的遗留）
status: done
owner: agent
decided_on: 2026-10-10
source: session:2ad2cf15
done_on: 2026-10-10
done_ref: doc:docs/ledger/evidence/2026-10-10-nal-messenger-brief-cts-pollution-regen--receipt.md
verify_by: 2026-10-13
verify_how: 对 NAL（client_id 4ae76381…）跑 `select count(*) from conversation_briefs where client_id=… and summary ~* '\mCTS\M'`，等于 0 算成；再抽 3 张 2026-10-10 之后生成的 messenger 卡读一遍，摘要里的商家必须是 New Asian Logistics
---
根因是 src/lib/messenger/brief.ts 文件头记的 2026-09-13 事故（提示词写死 CTS 身份），修复后旧卡没重算；
每小时写卡任务只看最近 500 条对话、且只在有新消息时重写，65 张在它够不到的范围。
本次用 scripts/backfills/regen-polluted-messenger-briefs.ts 点名重算，生成与落库全部复用 brief.ts 原逻辑。
顺带查出 Roman HU 名下 15 张同类旧卡（8 月生成）未重算，等 PM 决定；CTS 自己的卡提到 CTS 是正常的。
