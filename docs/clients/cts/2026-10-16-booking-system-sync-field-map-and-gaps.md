# 订单系统 ↔ 团目录同步：字段对照与缺口（109 号，2026-10-16，只读，C 级文档）

范围：官网全部中国线路 25 个（Signature 4 + Discovery 7 + Stopover 14）；日韩越先不进。模板：`2026-10-16-booking-system-sync-template.xlsx`（两张表：团、班期，仅表头+一行示例，未填数据）。
**说明**：订单系统线路编辑页的字段我没登录看过（按 18 号只读指示），下表「订单系统字段」取自 18 号转述的清单，**未对页面核实**。

## ① 覆盖情况（只读查 tour_catalog_tours，2026-10-16）
- 官网 25 个中国线路 **25/25 都在目录里且为启用**：Signature 4（丝路、传奇之旅、中国全景、Natural China）；Discovery 7（Tale、Best of China、Shanghai、Colorful Yunnan、Christmas、Christmas Christchurch、Golden China）；Stopover 14（Beijing、Beijing Express、Shanghai、Shanghai Express、Chengdu、Guilin、Xi'an、Guangzhou、Shanghai & Suzhou、Shanghai & Wuzhen、Guilin & Surrounds、Zhangjiajie、Guangzhou & Shenzhen、Huangshan）。
- 目录里另有 2 个中国团已停用、不在 25 个内：Fire & Fuzz（官网已下线）、Discovery 版 Natural China（价格待定，PM 说应删）。
- Stopover 14 个官网在 `/tours/china/stopover/<slug>` 列出；目录里都是「无固定班期」（manages_departures=false，0 个班期）。

## ② 字段对照
| 同步表 | 订单系统字段（转述） | 目录字段 | 现状 |
|---|---|---|---|
| 团 | 名称 | `name`（形如「China Signature — Silk Road」带系列前缀） | 有，但带前缀，需决定订单系统显示名 |
| 团 | 英文名 | `name` 去前缀（无独立英文名字段） | 可由 name 派生 |
| 团 | 系列 | `tier`（signature/discovery/stopover） | 有 25/25 |
| 团 | 游玩天数 | `duration_text`（"18 Days"）+ 行程条数 | 有 25/25，需解析成数字 |
| 团 | 目的地城市 | `tour_cities`（数组） | **只有 8/25 有值，17/25 为空**（丝路、传奇、中国全景、Best of China、Stopover 13 个）；PM 要求按官网城市 |
| 团 | 简介 | `short_description` | 有 25/25 |
| 团 | 含 / 不含 | `inclusions` / `exclusions` | 有 25/25 |
| 团 | 退改 | **无字段** | 缺：目录没有退改字段，FAQ 里也查无 cancel/refund 字样（0/25） |
| 班期 | 团编号 | 目录用 uuid / slug+destination | **订单系统自己的线路编号目录里没存**（需要对照表） |
| 班期 | 出发日 / 返程日 | `depart_on` / `return_on` | 有；返程=落地奥克兰当地日，3 个草稿值待核（见步骤 2 一页纸） |
| 班期 | 价格 | 班期 `price_text_override`，否则团 `display_price_text`（文字） | 文字非数字；班期单独价目前只有 2 行；需解析成数字 NZD |
| 班期 | 状态 | `status` | 有（open/limited/sold_out/closed/cancelled） |
| — | 折扣组 | — | PM 结论：不适用 |

## ③ 缺口清单
**缺的团：0 个**（25/25 已在目录）。
**缺的字段/数据：**
1. 目的地城市：**17 个团为空**（需按官网各页城市补）。
2. 退改：**25 个团全无**，目录无此字段（要 CTS 提供原文；要加字段属结构变更，A 级）。
3. 订单系统线路编号对照：**25 个团都没有**（班期表「团编号」要靠它）。
4. 班期价格数字化：25 个团的价格是文字，需统一解析规则（含 From 的写法仍搁置，不在本稿处理）。
5. Stopover 14 个无班期：订单系统是否需要班期行，待 CTS/PM 说明。
6. 英文名/显示名：带系列前缀，需定规则。
**数字合计**：缺团 0；缺字段类 6 项；其中数据逐团缺口 = 城市 17 + 退改 25 + 编号 25。

不改库、未对外发送、未登录订单系统。
