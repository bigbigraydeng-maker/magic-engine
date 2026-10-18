# 外滩黄昏明信片（postcard，有内容版）· 文案 + 出处 + 对账表（待过目，工单未提交）

> PM 10-18：氛围片模板降格为素材；用现有 postcard 模板出一条有内容的外滩黄昏片。样片 17419d99 已打回（原因「没有实际内容，PM 批」）。只进审片页给 PM，不发布、不进广告素材池。

## 结构与时长（总 17.0s ≤19s；音乐起点 0.1333s，窗口 0.133+17+1=18.13 ≤ 登记 20s ✓）
钩子 3s → 场景 1 五秒 → 场景 2 五秒 → 片尾卡 4s（无价格，`price:null`）。素材：atm1（黄浦江日落，39s）、atm2（东方明珠航拍日落，14.3s）；postcard 的素材都从文件头起播，所以要先切 4 段 5 秒左右的衍生片（`pc1_…`，1080×1920 h264），**不重复同一段画面**：钩子=atm2[0:4]、场景1=atm1[2:7]、场景2=atm2[8:13]、片尾背景=atm1[24:28.5]。衍生片出处沿用 credits-v10（Pexels，作者 Cfq938888 Chen / KJeremy，免费商用无需署名）。

## 屏幕上的每一句字与出处（只用 CTS 官网原词，不编）
| 位置 | 屏幕文字 | 出处（官网页面 + 原文） | 说明 |
|---|---|---|---|
| 钩子（2 行大字） | `SHANGHAI` / `AT DUSK` | 钩子文字不要求出处；只描述画面（上海、黄昏），不含任何产品/价格/时效断言 | 钩子过禁词/价格闸 |
| 场景1 地名 | `Shanghai` | shanghai-surroundings 路线原文：「Auckland → Shanghai → Suzhou → Wuxi → Xinshi Ancient Town → Hangzhou → Shanghai → Auckland」 | 与既往 Shanghai 工单同一出处 |
| 场景1 一句话 | `The Bund` | https://www.ctstours.co.nz/tours/china/discovery/shanghai-surroundings Day 08：「The Bund and City God Temple area」；亮点原文：「The Bund, City God Temple quarter, World Cultural Heritage Art Exhibition Centre, and Nanjing Road」 | ⚠️ **画面是否就是外滩**：我目视是黄浦江对岸的历史建筑群，Pexels 标签含 Shanghai、作者自称上海人，但**页面没写「The Bund」**——不是 100% 证实。保守替代：把这句改成 `Along the river` 之类无出处的就不行（一句话必须有出处），所以保守方案=场景1 一句话也用「The Shanghai skyline」。**请 18 号/PM 定：用「The Bund」（官网有原词，画面我判断是）还是保守** |
| 场景2 地名 | `Shanghai` | 同上 | |
| 场景2 一句话 | `The Shanghai skyline` | shanghai-surroundings 原文：「Water towns, gardens and the Shanghai skyline.」；Best of China 页另有「Lujiazui skyline corridor」 | 东方明珠航拍日落，画面与 skyline 吻合；**官网没写「Oriental Pearl」，所以不写塔名** |
| 片尾卡标题 | `CTS TOURS` | 品牌名，无断言 | 不放价格/团名/日期 |
| 首评（不上画面） | 沿用既往无价格口径：「Full itinerary and inclusions」+ 链接 shanghai-surroundings | 官网 | 价格只放首评链接，不在画面 |
- 都过现有闸：价格闸（无金额）、禁词闸、出处闸（`quoteSupports` 词重叠：The Bund ↔ 原句含 bund；skyline ↔ 原句含 skyline/shanghai）、宽度闸（已用引擎 `parsePostcardProps` 验证通过：`postcard.props.draft.json`）。

## 配方对账表（库：viral_reference_library travel 类；动手前先出，出片后回填）
| 配方列 | 本片做法 | 状态 |
|---|---|---|
| 首秒直接出现最精彩画面 | 钩子=东方明珠日落航拍，第 0 帧即画面+大字 | 满足（待验：第 0 帧文字是否完整） |
| 真实素材（非 AI） | Pexels 实拍 | 满足 |
| 有信息量/不是纯氛围 | 每景地名+一句官网原词，片尾品牌卡 | 满足（人工项「单独发给粉丝能看懂吗」仍待 PM） |
| 文字短而大、安全区 | 沿用 postcard 版式（cardTop 870，避开 Logo） | 满足 |
| 无价格/倒计时/限时 | 无 | 满足 |
| 情绪配乐、无人声 | jade_river_journey（登记到 20s，总长 17s） | 满足（弱证据：PM 审片通过） |
| 人物背影/真人出镜 | 无（无自有素材、无肖像授权） | **未满足** |
| 地点真实可溯 | 上海（官网路线原词）；是否「外滩」见上 ⚠️ | 部分（待定） |
| 时长 | 17s | 满足 |
| 与 NC v4 同曲 | 都用 jade：不要同一天公开，是否同发由 PM 定 | 需 PM 定 |
