# 回执：NAL 私信需求卡「冒充 CTS」旧卡重算（2026-10-10）

- 台账卡：`2026-10-10-nal-messenger-brief-cts-pollution-regen`
- 生产库：CrazyContent（project `glbdnayojixmexgofbsd`），表 `conversation_briefs`
- 客户：New Asian Logistics，client_id `4ae76381-cd45-43bd-85cd-98cfd7604007`
- 工具：`scripts/backfills/regen-polluted-messenger-briefs.ts`（生成与落库复用 `src/lib/messenger/brief.ts` 的 `generateBrief` / `storeBrief`，模型 `gpt-4o-mini`）

## 改前（2026-10-10 查库）

| 渠道 | 卡数 | 摘要含 CTS |
|---|---|---|
| messenger | 187 | 109 |
| whatsapp | 31 | 0 |

109 张全部生成于 2026-09-13 04:37–07:12 UTC（事故当天、修复落地前）；其中 65 张对话排在每小时写卡任务 500 条候选池之外。

## 实跑

| 时间 (UTC) | 触发 | 范围 | 结果 |
|---|---|---|---|
| 01:2x | dry-run `--limit=1` | 1 张 | 新摘要不含 CTS，未落库 |
| 01:26–01:31 | `--live` | 摘要含 CTS 的 109 张 | 已重写 109，失败 0，退出码 0 |
| 之后 | `--live --conversation-id=…` ×3 | 摘要干净但回复草稿里留着 CTS 电话/邮箱的 3 张 | 已重写 3，失败 0 |

## 改后复核（2026-10-10 查库）

| 渠道 | 卡数 | 摘要含 CTS | 回复草稿含 CTS 或其电话/邮箱 | 今日重写 | 退化成占位卡(model=fallback) |
|---|---|---|---|---|---|
| messenger | 187 | 0 | 0 | 112 | 0 |
| whatsapp | 31 | 0 | 0 | 0 | 0 |

抽 5 张人工读：摘要商家均为 New Asian Logistics（其中 1 张判为垃圾/钓鱼消息的占位卡，属正常短路），trip 字段全空。
112 张里 5 张重算后判为「疑似垃圾/推广/钓鱼」，是 brief.ts 的 noiseBrief 短路，不是失败。

## 费用

全部 112 次调用的对话正文合计约 8.3 万字符，按 gpt-4o-mini 单价估算合计 < US$0.2。

## 顺带查出、未动

- Roman HU：messenger 37 张卡里 10 张摘要整词含「CTS」（8 月生成、修复前的旧卡），**未重算**，等 PM 决定。
- CTS Tours NZ 自己的卡提到 CTS 是正常的，不算污染。
- NAL 还有 59 张同样生成于 2026-09-13 的卡，摘要与草稿里都没有 CTS / 旅游字眼，未动。
