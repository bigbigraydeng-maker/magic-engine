# Vol.05 数据台账 · 中国 → 澳洲小批量物流市场与数字营销机会

**报告**：[`report.html`](./report.html)
**核查日期**：2026-09-05
**发布闸**：✅ 通过（0 blocking · 0 warning）
**性质**：对 2026-09-03 同题报告 Vol.02（已作废）的重做

> 台账规则：每个印进报告的数字都必须在本表出现，带期间、口径、发布方、URL 与置信度。
> 报告里有、本表没有的数字 = 违规，必须删掉或补上来源。
>
> **本卷经过两轮核查**：第一轮由 6 路并行 agent 逐条打开发布方页面采集（62 条一手数据），
> 第二轮由独立的敌意核查 agent 对每条数字重新打开原始 PDF/网页/API 复核，
> 并专门排查"口径混用""营销页报价当事实印"两类风险。本表是两轮核查后的最终版本。

---

## 置信度定义

| 标记 | 含义 |
|---|---|
| `一手确认` | 本人或核查 agent 在发布机构自己的页面/PDF/API 上读到该数字 |
| `一手·派生` | 数值本身来自一手数据，但为对已发布的月度/季度值求和或相除得出，非发布方直接刊出 |
| `二手` | 未能打开一手页面，仅有行业媒体转载确认 |
| `行业口径` | 货代等市场参与者公开的营销/指导报价，非权威指数、非成交价 |
| `判断` | 本院综合判断，**明确不是数据** |
| `未取得` | 本轮未拿到，原因写明，**报告中不出现该数字** |

---

## 一 · 澳中贸易（报告第 01 / 02 节）

| 数字 | 值 | 期间 | 口径 | 发布方 | URL | 置信度 |
|---|---|---|---|---|---|---|
| 澳大利亚自中国进口（货物+服务）| A$130,211m = **A$1,302 亿（A$130.2 b）**，2024 年 A$115,741m，+12.5% | CY2025 | 货物按 recorded trade basis、服务按 BoP 口径，DFAT 调整后 ABS 数据 | DFAT, *Australia's trade in goods & services 2025* | https://www.dfat.gov.au/sites/default/files/australia-goods-services-exports-imports-2025.pdf | 一手确认 |
| 中国占澳洲进口比重 | **19.8%**，第 1 大来源国；2 美国 A$98,581m(15.0%)；3 日本 A$32,398m(4.9%)；4 新加坡 A$28,249m(4.3%)；5 泰国 A$23,607m(3.6%)；总进口 A$658,308m | CY2025 | 货物+服务，同上 | 同上 | 同上 | 一手确认 |
| 自中国主要进口品目 | 电信设备 9.8 / 电机 8.2 / 乘用车 7.4 / 电脑 7.0 / 家具床垫 4.7 / 玩具运动品 3.8（A$b）| CY2025 | DFAT-adjusted ABS 数据，货物项目，可能剔除保密品目、四舍五入 | DFAT, China country/economy fact sheet | https://www.dfat.gov.au/sites/default/files/chin-cef.pdf | 一手确认 |
| 自中国进口（仅货物）| 约 **A$123,684m = A$1,237 亿（A$123.7 b）**，占货物进口约 26.9% | CY2025 | 海关价值，China (excl. SARs & Taiwan)，对 ABS 已刊 12 个月度值求和 | ABS, International Trade in Goods (5368.0) Table 14b | https://www.abs.gov.au/statistics/economy/international-trade/international-trade-goods/jul-2026/5368014b.xlsx | 一手·派生 |
| 小卖家品类中国占比（SITC 3 位）| 陶瓷 666 79.1%；灯具 813 78.9%；金属家用器具 697 75.0%；家具床垫 821 74.4%；玩具运动 894 68.3%；电机电器 778 64.8%；纺织制成品 658 62.5%；塑料制品 893 61.2%；服装配饰 84 57.3%；家用电器 775 54.7%；电信设备 764 52.2%；鞋类 851 40.8% | CY2025 | 仅货物，海关价值，对 ABS Data API 已刊月度值求和；占比 = 中国值 ÷ 该品类全部来源进口值 | ABS Data API, dataflow ABS,MERCH_IMP,1.0.0 | https://data.api.abs.gov.au/rest/data/ABS,MERCH_IMP,1.0.0/ | 一手·派生 |

> ⚠️ **两个"中国进口额"不可相减比较**：19.8%（货物+服务，分母 A$658,308m）与仅货物占比约 26.9%（分母不含服务）是两个不同分母算出的比例，报告正文与图表说明均已注明。
> ⚠️ **19.8% 与品类占比（74.4% 等）分母不同**：前者货物+服务总盘，后者仅货物按 SITC 细分。两者出现在同一节时已在正文与图表说明中分别标注口径。

---

## 二 · 澳洲电商与零售（报告第 02 节）

三个一手源，**口径互不相同，报告不做相加或相减**。

| 数字 | 值 | 期间 | 口径 | 发布方 | URL | 置信度 |
|---|---|---|---|---|---|---|
| 线上消费总额 | **A$82.6b（A$826 亿）**，+14% YoY | CY2025 | CommBank iQ 电子交易数据 + BNPL 估算，未定义是否仅实物商品、是否含 GST | Australia Post, eCommerce Report 2026 | https://auspost.com.au/content/dam/auspost_corp/media/documents/ecommerce-reports/annual-ecommerce-reports/ecommerce-report-2026.pdf | 一手确认 |
| 线上占全部零售比重 | **24%**，+1.6pt YoY | CY2025 | 同上口径 | 同上 | 同上 | 一手确认 |
| 网购家庭数 | **9.8m 户**，+0.7% YoY，= **82%** 全部家庭；41% 至少每两周网购一次 | CY2025 | Australia Post 包裹投递数据推算 | 同上 | 同上 | 一手确认 |
| 平均客单价 | **A$96**，−0.4% YoY | CY2025 | CommBank iQ 口径 | 同上 | 同上 | 一手确认 |
| 纯线上平台消费（Amazon/Temu 等）| A$18.9b，+13% YoY，占线上消费 23% | CY2025 | 不含 Big W Market / Kmart Marketplace 等零售商自营平台 | 同上 | 同上 | 一手确认 |
| 线上零售额（NAB 指数）| **A$66.23b**，约占 ABS 零售估算 **14.9%**，12 个月增速 14.2% | 截至 2025-09 的滚动 12 个月 | NAB 个人电子支付交易外推全经济；"含海外商户"一句在 NAB 官网 HTML 页未找到出处，仅见于 PDF，本报告不采用该归因 | NAB Group Economics, Online Retail Sales Index (Sep 2025) | https://business.nab.com.au/tag/economic-commentary/nab-online-retail-sales-index--september-2025- | 一手确认 |
| 线上零售营业额（ABS 官方）| **A$4,703.8m**（2025 年 6 月，季调），同比 +13.0%；线上占比 **12.7%**（原始值，去年同月 11.6%）；该系列已停更 | 2025-06 单月 | ABS 名录内零售企业，含 GST，不含海外卖家 | ABS, Retail Trade, Australia, June 2025（最终一期）| https://www.abs.gov.au/statistics/industry/retail-and-wholesale-trade/retail-trade-australia/jun-2025 | 一手确认 |
| 接受线上订单的企业比例 | **32%**（2021-22 为 30%）| FY2024-25 | ABS 企业特征调查，覆盖有雇员企业，是比例非绝对数 | ABS, Characteristics of Australian Business | https://www.abs.gov.au/statistics/industry/technology-and-innovation/characteristics-australian-business/latest-release | 一手确认 |

> ⚠️ 三个"线上零售规模"数字口径完全不同（是否含海外商户、是否含 GST、是否仅名录内企业），报告图 3 已分列呈现，未相加或平均。

---

## 三 · 港口吞吐（报告第 03 节）

排名图只用 **FY2024-25** 这一期官方数字，确保五港口径可比。

| 港口 | FY2024-25（官方，排名用）| 其他期间参考 | 发布方 | URL | 置信度 |
|---|---|---|---|---|---|
| 墨尔本 | **3.39M TEU**，+3.7%（上年 3.26M；空箱 919,000）| CY2025 官方"record 3.5M TEU"；FY2025-26 四季相加约 3.52M（**自算，官方未发布年度数**）| Port of Melbourne | https://www.portofmelbourne.com/about-us/trade-statistics/trade-performance/ | 一手确认 |
| 悉尼 Port Botany | **2,773,381 TEU**（FY26 报表中的 FY25 同期列）| FY2025-26：**2,947,129 TEU，+6.26%** | NSW Ports, Monthly Trade Report | https://www.nswports.com.au/file-download/download/public/2830 | 一手确认 |
| 布里斯班 | **1,618,085 TEU**（新闻稿"record 1.62M"；新报表重述为 1,619,956）| FY2025-26：**1,738,262 TEU**（约 +7.3%，自算）| Port of Brisbane | https://www.portbris.com.au/documents/d/port-of-brisbane/0-1-monthly-trade-report-6-pdf?download=true | 一手确认 |
| 弗里曼特尔（珀斯）| **887,514 TEU**，+3.6% | FY2025-26：920,521 TEU，+3.7%（**二手**，WA 州政府媒体声明原页未检索到）| Fremantle Ports 2025 年报（WA 议会存档）| https://www.parliament.wa.gov.au/publications/tabledpapers.nsf/displaypaper/4210501a1f2563bdf6da7a2148258d090005f995/$file/tp+501+(2025)+fremantle+ports+2025+annual+report+-+final.pdf | 一手确认（FY24-25）／二手（FY25-26）|
| 阿德莱德 Flinders | **Total 399,861 TEU；Full 286,425（−1.9%）**| CY2025 月度重箱累计约 295,157（自算）| Flinders Port Holdings, Annual Report FY'25 | https://www.flindersportholdings.com.au/wp-content/uploads/2025/11/FPH_AnnualReport_FY25_WEB-1.pdf | 一手确认 |
| 澳洲最大港排名 | 墨尔本第一，官方自述"比全国任何港口多 21% 的货量"| FY2024-25 | 各港官方数据综合 | https://www.portofmelbourne.com/record-trade-value-port-of-melbourne-reveals-fy25-trade-data/ | 一手确认（官方原话，未叠加自算百分比）|

> ⚠️ 报告只引用港口官方原话"21%"，不与自行计算的百分比并列——两者可能用了不同基准年的 Port Botany 数字，混排会造成"官方数字自相矛盾"的错觉。

---

## 四 · 进口监管事实（报告第 04 节）

全部为现行规则，一手确认。

| 事实 | 值 | 发布方 | URL |
|---|---|---|---|
| 低值 GST 门槛 | **A$1,000 或以下**（海关价值）由离岸卖家在销售点代收 10% GST，自 2018-07-01 起 | ATO | https://www.ato.gov.au/businesses-and-organisations/international-tax-for-business/gst-for-non-resident-businesses/gst-on-low-value-imported-goods |
| 边境征收 | 超过 A$1,000：GST + 关税 + 清关费在边境向进口商征收 | ATO | 同上 |
| 离岸卖家 GST 注册门槛 | **A$75,000 / 12 个月**（非营利 A$150,000）| ATO | https://www.ato.gov.au/businesses-and-organisations/international-tax-for-business/gst-for-non-resident-businesses/how-australian-gst-works |
| 清关方式分界 | **≤A$1,000**（空/海运）→ 自评估清关 SAC；**>A$1,000** → 完整进口申报 FID (N10) | ABF | https://www.abf.gov.au/importing-exporting-and-manufacturing/importing/how-to-import/import-declaration |
| 进口处理费 IPC（电子申报）| ≤$1,000: **$0**；>$1,000–<$10,000: **$50**；≥$10,000: **$152**（AUD）| ABF（引 ACN 2015/44）| https://www.abf.gov.au/importing-exporting-and-manufacturing/importing/cost-of-importing-goods/charges/import-processing-charge |
| 生物安全 FID 费 | 空运 **$48** / 海运 **$71**（>$1,000 货物，ABF 代 DAFF 收取；生效日页面未标注）| ABF（引 ACN 2026/23、DAFF 106-2026）| 同上 |
| BMSB 季节 | 每年 **9 月 1 日至次年 4 月 30 日**（以提单 shipped on board 日期为准）；2026-27 季自 2026-09-01 开始 | DAFF | https://www.agriculture.gov.au/biosecurity-trade/import/before/brown-marmorated-stink-bugs |
| BMSB 对中国货物 | 中国 = "heightened vessel surveillance only" + 新兴风险国 → **随机岸上查验，不强制离岸处理**（不同于美国、意大利等 41 国强制处理名单）；空运自中国的目标高风险货物同样只随机查验 | DAFF | 同上 |
| 木质包装 | 含实木/竹的包装须按 ISPM 15 处理并申报；FCL/LCL 集装箱货须 packing declaration，空运不需要 | DAFF | https://www.agriculture.gov.au/biosecurity-trade/import/goods/timber-packaging |
| ChAFTA 生效 | **2015-12-20** | DFAT | https://www.dfat.gov.au/trade/agreements/in-force/chafta/australia-china-fta |
| ChAFTA 关税待遇 | 2015 年起 82% 品类即时零关税，**2019-01-01 起 100% 品类零关税**；须满足原产地规则、附 COO | DFAT | https://www.dfat.gov.au/trade/agreements/in-force/chafta/doing-business-with-china/chafta-frequently-asked-questions |

> ⚠️ **报告已明确写出"关税免了不等于全免税费"**：ChAFTA 零关税只免关税本身，10% GST、IPC、生物安全费依然照收。
> ⚠️ **报告未写"中国货物需强制熏蒸处理"**——DAFF 原文明确中国是随机查验、不强制处理，与美国、意大利等国不同。

---

## 五 · 运价与指数（报告第 05 节 · 只允许定性）

| 事实 | 说明 | 来源 |
|---|---|---|
| 三大权威海运指数不覆盖本航线 | Freightos FBX（12 条航线均无大洋洲）、Drewry WCI（8 条主干航线无澳洲）、Xeneta XSI-C（8 条航线无澳洲）——逐个发布方页面确认 | 各发布方页面（2026-09-05 核对）|
| SCFI 有"澳新（墨尔本）"航线但数值未公开 | 上海航运交易所 SCFI 综合指数 3590.05（2026-09-04 期，上期 3509.53），澳新航线存在（权重 5.0%）但公开页数值单元格为空，需付费订阅 | 上海航运交易所 · https://www.sse.net.cn/index/singleIndex?indexType=scfi |
| 货代报价互相矛盾 | 报告不印任何具体运价数字。已知情况：不同货代营销页给出的 LCL/FCL/空运报价能相差数倍，反映的是报价来源混乱而非真实市场价 | 多家货代公开营销页（均判定为不可当成交价引用）|
| LCL/FCL 破本点 | 业内常见说法约十几个 CBM，不同货代给出的具体数字有出入，报告只写"业内常见说法"不写成事实 | 多家货代口径（非权威统一标准）|

**报告明确不给出的数字**（核查后判定"只能定性，不许给数字"）：
- 任何具体运价（US$/CBM、US$/kg 等）—— 无权威指数、货代口径互斥且随月波动
- 精确的运输天数 —— 只给"数周量级"这类定性描述
- Freightos Global FBX、FAX 的具体点位数字 —— 页面无日期、非中澳航线，印出来会被误认作中澳运价

---

## 六 · 数字营销现状（报告第 06 节）

| 数字 | 值 | 置信度 |
|---|---|---|
| SERP 首页 12 名（"freight forwarder china to australia"，澳洲区）| 1 willship.com.au · 2 transcoast.com.au · 3 wwcf.com.au · 4 freightos.com · 5 dhl.com · 6 mbmlog.com · 7 brint.com.au · 8 wise.com · 9 icecargo.com.au · 10 maskuralogistics.com · 11 jikelogistics.com · 12 auspost.com.au | 实测（Semrush，au 库）|
| AI 检索引用来源 | 洋人问"最好的中国到澳洲货代"时，AI 检索引用 Alibaba SmartBuy 采购指南、WWCF、One World Courier，以及中国背景的 DFH Logistics、Mbmlog、China Top Freight | 实测（WebSearch，定性观察）|

**完整凭证**：[`receipts/semrush-serp-2026-09-05.md`](./receipts/semrush-serp-2026-09-05.md)（含原始 CSV 返回）

> ⚠️ **本轮未取得**：关键词搜索量 / CPC / 完整长尾矩阵。Semrush 生产额度本轮用尽（403 API UNITS BALANCE IS ZERO），报告不给出任何搜索量或 CPC 数字，只呈现已实测的 SERP 排名结构。

---

## 七 · 未取得（报告第 07 节已逐条公开）

| 项 | 原因 |
|---|---|
| 澳洲线上卖家绝对数量 | ABS、Australia Post、NAB 三个一手源均不统计，只有 ABS "32% 企业接受线上订单"这一比例 |
| 直接从中国进口的小企业数量 | 未在任何一手源找到 |
| 低值（≤A$1,000）小包裹的件数或金额 | ABS 货物贸易统计按海关申报价值汇总，不单独区分小额消费者包裹 |
| 关键词搜索量 / CPC 完整矩阵 | Semrush 生产额度本轮用尽 |
| Meta / TikTok / YouTube 社媒热度 | 本轮聚焦搜索与 AI 检索两个高意图入口，社媒未接入 |

---

## 八 · 曾考虑但最终未采用的数字（记录事故预防，非报告内容）

以下数字在采集阶段一度出现在候选数据里，经敌意核查判定为不可靠或有误导风险，**未进入最终报告**：

| 候选数字 | 判定 | 原因 |
|---|---|---|
| SINO Shipping US$35/CBM 等具体运价 | 剔除 | 货代营销页报价，与澳洲本地货代 AUD 150–300/CBM 起步价相差数倍，无成交依据 |
| Freightos Global FBX US$3,520 / FAX US$2.87/kg | 剔除 | 页面无日期、非中澳航线，印出来会被误认作中澳运价 |
| CBFCA "274 家持牌报关行 · 1,594 名报关员" | 剔除 | 2015 年数据，该协会已于 2020 年合并，印出来即为误导 |
| ICE "47,003,695 kgs"、Linfox "$60 billion"、Toll 客户数（三个页面互相矛盾）| 剔除 | 公司自述宣传数字，非独立可核实指标 |
| DHL 澳洲"5,000+ 员工 / 80+ 仓库"| 剔除 | 发布方原页未能直接打开，仅搜索摘要 |
| "NAB 含海外线上零售商，故大于 ABS" 归因 | 改写 | 该句在 NAB 官网 HTML 页找不到出处，报告改为客观陈述三者口径不同，不做归因解释 |

---

## 九 · 发布闸记录

```bash
npx vite-node scripts/magic-insight-prepublish-check.ts -- \
  docs/magic-insight/vol05-au-china-freight/report.html \
  --receipt docs/magic-insight/vol05-au-china-freight/receipts/semrush-serp-2026-09-05.md \
  --source "ABS" --source "DFAT" --source "Australia Post" --source "ATO" --source "ABF" \
  --source "DAFF" --source "各港务公司" --source "货代" --source "Semrush" --source "上海航运交易所"
# → ✅ 全部通过，0 blocking · 0 warning
```

**本卷经历两轮修订**：
1. 初稿基于 6 路并行采集的 62 条一手数据写成，过闸时补齐了数量级配对（A$826 亿 ↔ A$82.6 b）
2. 独立敌意核查 agent 逐条重新打开原始页面复核后，指出 6 类真实问题（详见上方各节 ⚠️ 标注），
   全部已修正：口径混用（19.8% vs 26.9%、三种线上零售口径）、未经证实的归因（NAB "含海外商户"）、
   把货代营销报价当事实印、把经验值当精确数据写、遗漏 ChAFTA 关税与税费的区别、
   港口跨财年混排

---

## 十 · PDF 生成

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
  --no-pdf-header-footer --virtual-time-budget=15000 \
  --run-all-compositor-stages-before-draw \
  --print-to-pdf="Magic_Insight_Vol05_China_Australia_Freight_2026-09-05.pdf" \
  "file://$(pwd)/docs/magic-insight/vol05-au-china-freight/report.html"
```

## 十一 · 封面图片来源

| 用途 | 内容 | 摄影师 | 授权 | 链接 |
|---|---|---|---|---|
| 封面背景 | 满载集装箱货轮航拍 | Rinson Chory（@nessa_rin）| Unsplash License（免费商用）| https://unsplash.com/photos/a-large-container-ship-in-the-middle-of-the-ocean-u0AClDhw800 |
