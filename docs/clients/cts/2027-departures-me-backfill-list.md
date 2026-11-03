# CTS 2027 班期补录清单（交 ME Tour 管理录入；只给录入用，不是对外信息）

- **日期**：2026-10-12 · **窗口**：74 号 · **风险级**：C（只有文档）。**本文没有写任何东西进 ME 后台**；录入由 Tour 管理窗口按本表做。
- **依据**：[2027 全年出团表（客户档案抄录版）](./2027-departures-master-table.md) 对照 ME `tour_catalog_departures`（2026-10-12 只读）。
- **ME 班期字段**（读自 `src/lib/tour-catalog/store.ts` 与库）：`depart_on`、`return_on`、`status`、`price_text_override`、`internal{airline, capacity, outboundRoute, inboundRoute}`。
- **规矩**：①航司、配额、航段都放 `internal`，**对外不显示**（对外不写「限 20 人」，不写航司）；②`status` 先保持默认「open」，**不要**据此改成 sold_out / limited（已订数不在这里）；③**不要点「上架 / 发布」**——团目录对外发布要单独的流程与 PM 同意；④表里没有价格列，`price_text_override` 一律留空，价格以官网为准；⑤录入后用「和官网现在的内容比一下」看差异，5/25 与 11/5 的上海团 **PM 已确认可以开卖**，应随官网读取口接通后上线。

## A. ME 里缺的 14 个班期（新建）

| # | 出发日 | ME 里的团（名称原样） | 返程日 | 航司（internal.airline，内部） | 去程（internal.outboundRoute） | 返程（internal.inboundRoute） | 配额（internal.capacity） | 备注 |
|---|---|---|---|---|---|---|---|---|
| 1 | 2027-05-25 | China Discovery — Shanghai & Surroundings | 2027-06-02 | 东航 | 奥克兰-上海+1 | 上海-奥克兰+0 | 20 | **PM 10/12 已确认可以开始卖**；官网待上线 |
| 2 | 2027-05-28 | China Signature — Natural China | 2027-06-12 | 东航 | 奥克兰-上海 | 上海-奥克兰 | 20 | **PM 10/12 已确认属 Signature 档** |
| 3 | 2027-06-14 | China Signature — Natural China | 2027-06-29 | 东航 | 奥克兰-上海 | 上海-奥克兰 | 20 | 同上 |
| 4 | 2027-08-08 | China Signature — Natural China | 2027-08-23 | 东航 | 奥克兰-上海 | 上海-奥克兰 | 20 | 同上 |
| 5 | 2027-08-21 | China Discovery — A Tale of Two Cities | 2027-08-30 | 国航 | 奥克兰-北京+1 | 北京-奥克兰+0 | 20 |  |
| 6 | 2027-09-02 | China Discovery — A Tale of Two Cities | 2027-09-11 | 国航 | 奥克兰-北京+1 | 北京-奥克兰+0 | 20 |  |
| 7 | 2027-09-03 | China Signature — Legacy of China | （空） | 东航 | 奥克兰-上海+1 | （空） | 20 | 返程日与返程航段原表为空，留空待 CTS 补正 |
| 8 | 2027-09-09 | China Discovery — Best of China | 2027-09-23 | 国航 | 奥克兰-北京+1 | 北京-奥克兰 | 20 |  |
| 9 | 2027-10-08 | China Signature — Natural China | 2027-10-23 | 东航 | 奥克兰-上海 | 上海-奥克兰 | 20 | 同上（已确认 Signature） |
| 10 | 2027-10-21 | China Discovery — A Tale of Two Cities | 2027-10-30 | 国航 | 奥克兰-北京+1 | 北京-奥克兰+0 | 20 |  |
| 11 | 2027-10-28 | China Discovery — Best of China | 2027-11-11 | 国航 | 奥克兰-北京+1 | 北京-奥克兰 | 20 |  |
| 12 | 2027-11-01 | China Signature — Natural China | 2027-11-16 | 东航 | 奥克兰-上海 | 上海-奥克兰 | 20 | 同上（已确认 Signature） |
| 13 | 2027-11-05 | China Discovery — Shanghai & Surroundings | 2027-11-14 | 东航 | 奥克兰-上海+1 | 上海-奥克兰+0 | 20 | **PM 10/12 已确认可以开始卖**；官网待上线 |
| 14 | 2027-11-14 | China Discovery — A Tale of Two Cities | 2027-11-23 | 国航 | 奥克兰-北京+1 | 北京-奥克兰+0 | 20 | 截图最后一行 |

按团统计：Natural China 5、A Tale of Two Cities 4、Best of China 2、Shanghai & Surroundings 2、Legacy of China 1。

**Natural China 为什么全放 Signature 那条**：ME 里有「China Signature — Natural China」（16 天、$7,349）与「China Discovery — Natural China」（14 天、价格 TBC、不管班期）两条。表里这 6 个 Natural China 班期出发到返程都是 16 天（含首尾），与 Signature 吻合，所以按 Signature 录；**PM 2026-10-12 已确认 Natural China 属 Signature**，这 5 个班期可直接录。另：PM 指示 Discovery 版 Natural China（ME 里「China Discovery — Natural China」与官网 `/discovery/natural-china` 页）**删除**——删之前先看官网该页有没有外链 / 收录，应让该网址 301 跳到 Signature 页（`/tours/china/signature/landscapes`），不要留 404。

## B. ME 里已有 11 个班期（补字段，不新建）

这 11 个目前返回日全空、`internal` 全空、状态是 10/10 初次导入的默认值。请**补返程日和 internal**：

| # | 出发日 | ME 里的团（名称原样） | 返程日 | 航司（internal.airline，内部） | 去程（internal.outboundRoute） | 返程（internal.inboundRoute） | 配额（internal.capacity） | 备注 |
|---|---|---|---|---|---|---|---|---|
| 1 | 2027-03-11 | China Discovery — Best of China | 2027-03-25 | 国航 | 奥克兰-北京+1 | 北京-奥克兰 | 20 |  |
| 2 | 2027-03-18 | China Discovery — A Tale of Two Cities | 2027-03-27 | 国航 | 奥克兰-北京+1 | 北京-奥克兰+0 | 20 |  |
| 3 | 2027-03-25 | China Discovery — Shanghai & Surroundings | 2027-04-03 | 东航 | 奥克兰-上海+1 | 上海-奥克兰+0 | 20 |  |
| 4 | 2027-03-26 | China Signature — Natural China | 2027-04-10 | 东航 | 奥克兰-上海 | 上海-奥克兰 | 20 |  |
| 5 | 2027-05-08 | China Signature — China Panorama | 2027-06-03 | 东航 | 奥克兰-上海+1 | 上海-奥克兰+0 | 20 |  |
| 6 | 2027-05-13 | China Signature — Silk Road | 2027-05-29 | 东航 | 奥克兰-上海+1 | 乌鲁木齐-上海 | 20 | 官网写 5/13–5/30，差一天，待核 |
| 7 | 2027-05-13 | China Discovery — Best of China | 2027-05-27 | 国航 | 奥克兰-北京+1 | 北京-奥克兰 | 20 |  |
| 8 | 2027-05-28 | China Signature — Legacy of China | （空） | 东航 | 奥克兰-上海+1 | （空） | 20 | 返程日与返程航段原表缺（返程航段栏写「540+T」疑残缺），留空待 CTS 补正 |
| 9 | 2027-06-10 | China Discovery — A Tale of Two Cities | 2027-06-19 | 国航 | 奥克兰-北京+1 | 北京-奥克兰+0 | 20 |  |
| 10 | 2027-10-16 | China Signature — China Panorama | 2027-11-11 | 东航 | 奥克兰-上海+1 | 上海-奥克兰+0 | 20 |  |
| 11 | 2027-10-21 | China Signature — Silk Road | 2027-11-06 | 东航 | 奥克兰-上海+1 | 乌鲁木齐-上海 | 20 | 官网写 10/21–11/7，差一天，待核 |

## C. 不在本次范围

- ME 里表上没有的班期：日本樱花团 2027-03-27、越南团 2027-05-12 与 2027-10-15（应来自另一张表，不动）。
- ME 里已过期的班期（2026-08-13、2026-09-10、2026-10-15 等）仍标「open」：是另一类问题（该自动收口），本稿不处理。
- **11/14 以后的班期**：原图到 11/14 为止，之后未知；有更晚原表再追加。

## D. 录入后怎么验（总控验收）

1. ME 里 2027 年中国团班期应为 **25** 个（11 + 14），日本 / 越南不算在内。
2. 每个班期 `return_on` 非空（除 2 个 Legacy 班期，等 CTS 补正）；`internal.capacity = 20`。
3. 「和官网现在的内容比一下」：差异里应只剩「ME 有、官网没有」的 11 个班期（官网读取口未接通前属正常）。
4. 团目录**仍未对外发布**。
