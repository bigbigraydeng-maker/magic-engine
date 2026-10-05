# CTS 重庆「李子坝」主题页面合并方案（只是方案，未动网站）

日期 2026-10-05 · 数据：库里谷歌逐页数据（近 28 天，截至 9/29）、线上真实页面 2026-10-05 抓取、网站代码仓库 chinatravel 主干
结论一句话：**3 个页面抢同一批搜索，选 `/blog/liziba-station-chongqing-guide` 当主页面，把 `/liziba-station-chongqing` 永久跳转过去，第三页改成不同角度并互相链接。**

## 1. 现状（事实）

| 页面 | 近28天曝光 | 点击 | 平均排名 | 字数 | 线上标题 |
|---|---|---|---|---|---|
| A `/blog/liziba-station-chongqing-guide` | 5,536 | 18 | 6.9 | 2,278 | Liziba: China's Most Photographed Train Station \| CTS Tours（9/27 自动改过） |
| B `/liziba-station-chongqing` | 2,386 | 4 | 9.4 | 1,607 | Liziba Station Chongqing: Train Through a Building \| CTS \| CTS Tours（品牌尾巴重复） |
| C `/blog/liziba-monorail-chongqing-guide` | 2,652 | 23 | 7.3 | 3,103 | Liziba Monorail Through-the-Building: How to Visit Chongqing's Most Photographed Station \| CTS Tours（92 个字符，搜索结果里会被截断） |

- 三页合计 10,574 次曝光、45 次点击，点击率 0.43%，三页排名都在 7–9 名。
- B 的页面大标题是"Liziba Station, Chongqing: A Complete Visitor Guide"，和 A 改标题前的"Liziba Station Chongqing: Complete Visitor Guide"几乎一字不差——两页一开始就在写同一件事。
- B 是 4 个页面的内链目标（A、nightlife-guide、travel-guide、how-many-days 都链到它），自己却没有任何向外链接；点击是三页里最差的。
- 9/19 和 9/28 两轮自动改标题，曾把 A、C、night-city-lights 的标题分别改成"How Many Days in Chongqing | CTS"这类互相冲突的标题，已全部撤回（这是已知的主题冲突问题，台账 2026-09-28）。
- **数据缺口**：跟踪的 58 个关键词里一个"liziba"词都没有，所以这组页面的真实搜索量我们没有存。能确认的只有谷歌给的曝光。

## 2. 方案

**谁当主页面：A。** 理由：曝光最大（5,536，比 B、C 都高）、发布最早（2026-04-25）、地址里带主词、已有向外内链；B 最弱（点击最差、字数最少、无发布日期）。C 的点击率其实比 A 高（0.87% vs 0.33%），所以不合并，只改角度。

1. **B → A 永久跳转（301）**：在网站 `next.config.js` 的跳转表里加一条。B 的现有点击很少（4 次），损失极小。
2. **改 B 的 6 处内部链接指向 A**：`chongqing-tours/page.tsx`、`blogs-longtail-batch1.ts`、`blogs-longtail-batch2.ts`、`guides.ts`，以及 how-many-days 和 chongqing-vs-chengdu 两篇博客里指向 B 的写法；同时把 `sitemap.ts` 里的 B 去掉。
3. **三页拉开角度，标题各自 ≤60 字符**（建议，不是最终稿，仍要过事实核对闸）：
   - A（主）：`Liziba Station Chongqing: Train Through a Building | CTS Tours`（62 字符，上线前砍到 ≤60，例如去掉末尾品牌）
   - C（辅，讲拍照和乘坐）：`Liziba Monorail Photo Spots & How to Ride | CTS Tours`（53）
   - A 页内加一句指向 C 的链接，C 页内回链 A，用不同的锚文字。
4. **重庆总览页 `/chongqing-travel-guide` 补链**：它现在链接 B、Hongyadong、how-many-days，没有链接 A 和 C；改成指向 A，再新增 C。
5. **不动**：夜景三页（night-city-lights、nightlife-guide、hongyadong）角度各不同，重叠轻，先不合并。how-many-days 刚被改过标题，不碰。

## 3. 预期与衡量（诚实版）

- 如果合并后主页面把平均排名推到约第 5 名，点击率 2%–3.5%，按合并后可见曝光 6,000–8,000 算，约 120–280 次点击/28 天，减去现在的 45，**增量粗估 +80 到 +230**。这是上限型估算：通用点击率对博客类页面偏高，搜索结果顶部的 AI 概览会分流；曝光不会是三页简单相加（同一个搜索只会露出一个页面）。
- 衡量不归因点击：看目标词排名是否动 ≥3 名、三页合计点击是否回升、全站同期趋势；改动 28 天后对比，期间这三页不再改别的。
- 基线用库里已存的谷歌逐页逐天数据（三个页面每天的曝光、点击、平均排名），不需要另加跟踪词（更正：前面写的"先加 5 个词进跟踪"不成立——跟踪词表来自数据供应商给的"该域名已排上的词"，不是手工配置的清单；李子坝词不在表里是因为供应商没收录这些长尾词，但谷歌自己的数据里有曝光）。

## 4. 风险与前置条件

- 改网站（跳转、链接、标题）会让 CTS 正式网站重新部署，**需要 PM 点头**。
- B 如果有外部网站的链接指向它，跳转会把这些权重带给 A（有利），但上线前应查一次 B 的外链，有重要来源就先通知。
- 9/27 对 A 的标题改动还在观察期（改满 14 天约 10/11）。建议 10/11 之后、网站周日体检刷新完页面基线再做，一次做完，之后 28 天不再动这三页。
- 不涉及受保护页面，不涉及签证页。

## 5. 已定

PM 2026-10-05 回复"全做"。网站改动已做成草稿 PR（chinatravel#221），本机试跑通过（旧页 308 跳转、标题 57/54 字符、内链正确、站点地图已去旧页）；按本方案 10/11 周日体检之后合并。

## （原）要你定的只有一件事

按这个方案做（10/11 之后一次做完），还是只做第 3、4 步（改标题和链接，先不跳转）。
