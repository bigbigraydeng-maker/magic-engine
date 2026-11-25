---
id: 2026-11-26-client-contracts-skill-master-v1
title: 客户服务合同统一用 client-contracts skill 出件：母版 v1.0（从 TradePlus-SA-2026-003 拆出）+ Dropbox「Magic Engine/合同/INDEX.md」编号登记 + 机器自检 + hello@ 谷歌云端硬盘电签草稿、PM 回「发」才发
status: done
owner: claude
decided_on: 2026-11-26
source: session:ff3723c0
verify_by: 2026-12-31
verify_how: 下一份新客户合同（编号应为 SA-2026-004）是用 skill 出的算成——INDEX.md 有 004 那一行、drafts/<编号>/schedule.toml 存在、build.py 跑出「自动检查全部通过」。如果 004 是从旧合同复制改写出来的，就算没闭环
---
做了什么：skill 在 ~/.claude/skills/client-contracts/；工具、母版、编号表在 Dropbox「Magic Engine/合同/」。用母版 v1.0 重出 TradePlus 合同，PDF 文字与 11-26 发给客户的版本逐字一致（10 页）。另测了 7 种出错情况（报价对不上、澳洲加 GST、新西兰无 GST 号、留 [●]、全称和登记表不一致、漏填、缺私密账号文件），全部被拦住。

还没定、等 PM：
1. （已定）PM 11-26 回「印」：澳元收款合同直接印 Wise 澳元账号，账号只存 Dropbox「合同/_private/payment-accounts.toml」。
2. （已定）PM 11-26 给了公司 GST 号 109-888-036 和纽币收款账号；母版 v1.1 能出新西兰客户合同（加 15% GST、印纽币账号），已用假客户试跑通过。
3. 电签那一步（谷歌云端硬盘「请求电子签名」）是照功能写的，没真点过；第一次真用时核对并更新 references/esign-google-drive.md。


11-26 晚 PM 回「改」：发票工具改成按合同选开票方。公司客户（client.billingEntity=company）用 MAGIC ENGINE AI TECHNOLOGY LIMITED，公司信息和收款账号跟合同共用 Dropbox「合同/」那两份文件；澳洲客户发票标题 INVOICE、AUD、不收 GST（工具会拦）。CTS/NAL 仍用 Ray 个人，发票文字对照验证一字未变。新建 data/clients/tradeplus.json。TradePlus 第一个月服务费发票（按合同 11-26 开、7 天内付）还没开。
