---
id: 2026-09-28-ledger-rules-not-enforced-by-parse
title: 台账自己的两条硬规则没有程序在查：正文不许超 5 行、冻结字段不许改，于是 60 项检查全绿也照样违反
status: decided
owner: agent
decided_on: 2026-09-28
source: pr:2137
verify_by: 2026-10-19
verify_how: 造两张故意违规的卡跑一次 `npx vitest run src/lib/ledger`，必须各自红一条：①正文 8 行（超过 README 的 5 行上限）；②改动一张已在主干的卡的 `verify_how` 或 `decided_on`（冻结字段）。两张都还能通过 = 没做；只做了①没做② = 只算一半，②才是会让夜巡判错的那条。注意②的判据是「跟主干上那版比有没有变」，不是「这张卡长什么样」，所以校验得取 base 版本对比，别实现成只看单文件
---
2026-09-28 卫青实测暴露：Codex 在两张卡上挑出两条**只写在 `docs/ledger/README.md`、没有任何程序在读**的规则——正文最多 5 行（README:31）、`verify_how` 等字段冻结、改判据应新建卡（README:68）。我两条都违反了（一张卡写到 40 多行；追溯改写了已合卡的 `verify_how`），而 `npx vitest run src/lib/ledger` **60 项全绿**。
**为什么②比①严重**：追溯改写判据之后，夜巡再也分不清那张卡是「未完成」「失败」还是「被后续结论取代」——台账存在的意义就是让这三件事可分辨。①只是让卡变得不好消费。
**修法分两层，别都塞进 parse.ts**（Codex 复审指出，成立）：①正文行数留在 `parse.ts`——它只拿到当前这一份文件，够用；②冻结字段**不能**在 `parse.ts` 做，`parseLedgerFile(file, text)` 只收当前版本、`Ledger entries valid` 也只检 head，拿不到主干那版，写在这里等于永远判不出「相对主干改了没」。它得放到能取 `BASE_SHA` / `HEAD_SHA` 的工作流或 diff 脚本层。子牙 2026-09-28 认同，排在台账相关在飞 PR 清掉之后派；本卡先占位，免得它只活在某个窗口的记忆里。
**优先级（§11）**：频率 低（只有写卡时撞上）/ IMPACT 低（不在产品闭环里）/ 收入 低 → 三个低 → **P3**，待认领。
