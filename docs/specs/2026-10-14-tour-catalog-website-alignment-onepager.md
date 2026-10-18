# 团目录 ↔ CTS 官网：三处冲突核对与对齐方案（一页纸）

窗口 109 · 2026-10-14 · 风险级：本文 C（只读核对 + 方案）；方案里的"写生产库 / 加字段"部分为 A，须 PM 点头
状态：**方案稿，未写任何代码、未写生产库、未发布团目录。**

## 0. 前提核实

- ME 团目录（CTS）：草稿版本 84，已发布版本 0（只读查 `tour_catalog_state`，库 = CrazyContent/ME 主库）。从没对外发布，今天与官网零冲突。
- 官网仓 `chinatravel`：PR 245（Natural China 去掉「max 16」和「Limited Availability」）**还没合并**（OPEN）。线上 landscapes 页今天仍写「Small group · max 16 travellers」+「Limited Availability」。
- 官网线上 Shanghai & Surroundings 页：只有 3/25 一个班期；ME 里有 3/25、5/25、11/5 三个。（11/5 由 98 号处理，不在本稿范围。）

## 1. 三处冲突：全部属实，并有两处补充

| # | 冲突 | 核对结果 |
|---|---|---|
| ① | 人数上限显示 | **属实。** 官网用 `HIDE_SCARCITY_CLAIMS_SLUGS = ['landscapes']` 写死（`tours/[destination]/[tier]/[tour]/page.tsx:55`）；ME 的 Signature 团 `max_group_size` 全是空，团目录里没有"不显示"的位置。官网 `TourHero.tsx:84` 在值为空时回退到 Signature 16 / Discovery 20。**补充：这两个默认值（16/20）本身就和 PM 10-14 定的容量（Discovery 18 / Signature 12）对不上。** |
| ② | 班期容量 | **部分属实，细节有出入。** 班期 `internal.capacity`：Discovery 15 行全是 20，Signature 10 行全是 20，另有 11 行没填（Discovery 7、Signature 4）。Shanghai 的 18 填在**团级** `max_group_size`，班期容量仍是 20；Golden China 团级 12（它是 Discovery 层但容量 12，说明"按层统一"不能一刀切）。`capacity` 只进内部销售进度，不会对外输出。 |
| ③ | 5/25 上海拦截 | **属实。** ME 里 5/25 班期 `status=open`、`return_on=2027-06-02`（9 天，而产品是 10 天行程，真实返程日未知）。对外输出只按状态过滤（open/limited 可见），**没有"待确认暂不放出"这一档**，一发布就会放出 5/25，绕过官网 `HELD_BACK` 测试。 |

## 2. 对齐方案（我的建议：目录做权威，官网不再各自写死）

原则：官网将来以团目录为唯一来源，"哪些话不能说、哪些日期不能放"必须在目录里有位置，不能靠官网代码里的一份私有名单。

**① 人数上限（PM 10-14 定：对外所有团都不显示人数上限，只在内部留 Discovery 18 / Signature 12）**
- 团目录的对外输出**默认不带**人数上限和「名额紧张」类提示，做成全站默认行为，不是逐团开关。内部容量照常保存，不对外。
- 官网侧（107 号）同步去掉所有页的默认显示（含 `TourHero` 的 16/20 回退）。
- 加字段属数据库结构变更（A 级）：本稿只写设计，**不开迁移 PR**；日后真开迁移时，只写不应用、可空列、不改现有数据，子牙+魏征审，PM 回「合 N」。

**② 班期容量**
- 只补内部容量，不动对外。清单见第 3 节，PM 点头后一次性写入并留导入前快照，可回退。

**③ 5/25 上海**
- 目录给班期加「待 CTS 确认，暂不放出」标记；带标记的班期不进对外输出，并且**发布时若还有带标记的班期，发布页明确列出**。CTS 回复返程日后，改好日期、去掉标记，再放出。
- 官网侧的 `HELD_BACK` 测试在官网切换到读目录之前继续保留，不拆。

**官网侧**（107 号配合）：本稿不动官网。待目录有了上面两个位置并写好数据后，官网再改为读目录，切换闸仍是设计稿 §7 的"官网与目录全量差异为零"。

## 3. 需要写生产库的清单（PM 已定：团目录发布前再写，现在不动）

只改 ME 团目录的班期内部容量（`internal.capacity`），共 25 行改 + 11 行补：
- Discovery：beijing-xian 7 行、essentials 5 行、shanghai-surroundings 3 行（现 20 → 18）；空值补 18：china-icons-collection 2 行、highlights 2 行、yunnan-explorer 1 行、chongqing-chengdu 1 行（已停用）。
- Signature：landscapes 6 行、grand-tour 2 行、silk-road 2 行（现 20 → 12）；空值补 12：cherry-blossoms 1 行、imperial-heritage 3 行（其中 2026-08-13 已过期，建议不补）。
- **Golden China 保持 12**（它是 Discovery 层，但 PM 已定为 12，且官网也写 12）。

另有 A 级动作（须单独批）：团表加一个"不显示人数/紧张提示"字段、班期加"待确认暂不放出"标记 = 数据库结构变更，按规矩走 A 级、PM 回「合 N」。5/25 班期本身现在就能先标记，但标记位置要等结构变更上线。

## 4. 已拍板与待办

- 已定（PM 10-14，经 105/18 号转述）：对外不显示人数上限；内部 Discovery 18 / Signature 12；容量补录等团目录发布前再写，写前整张导出原值存档、写后读回对账、备回滚语句。
- 未定：无。团目录在「待确认暂不放出」位置上线前**不得发布**（5/25 上海）。

## 5. 不在本稿范围

5/25 上海返程日（PM 已邮件问 CTS）· Natural China「名额有限」措辞（74 号）· 官网改动（107 号）· 5/28 与 11/5 班期补录（98/107 号）。

## 6. 验证记录

- 只读 SQL：`tour_catalog_state`、`tour_catalog_tours`+`tour_catalog_departures`（库 glbdnayojixmexgofbsd，2026-10-14，均为 SELECT）。
- 官网代码：`chinatravel` 分支 `fix/natural-china-remove-limited-availability`（PR 245 所在）；线上页面两张（landscapes、shanghai-surroundings）。
- 未运行：任何测试 / 构建（文档变更）。
- Reuse Statement：复用团目录设计稿 v0.3 的输出过滤与发布闸；新增两个位置都是平台通用字段（不含客户名/行业词），客户特有的只是数据（哪个团打开开关）。
