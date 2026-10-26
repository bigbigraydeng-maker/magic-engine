# East Inter 试跑 1 条 Facebook 视频：方案（111 号，2026-10-14，只准备，不提交工单）

- **范围**：PM 批准**试跑 1 条**（不是 6 条）；成片只交苏东坡+马良审；**不发布、不设开关**。本页没有任何代码，没有建工单。
- **状态**：未提交到仓库（避免触发 PR 2646 的机器人再审一轮）；2646 合并后再入库。
- **谁提交工单**：出片机就绪（见 §5）并由 18 号通知后，由本窗口提交；工单是写生产库，提交那一刻必须有 PM/18 号明确的「建单」。

## 1. 这 1 条片是什么

**价格封面版数据卡**（模板 `datacard`，纯数字画面，约 11 秒，1080×1920，英文）。选它做试跑的原因：它就是 PM 要的「封面先用价格」，也是出片机刚接通的那个模板，一条跑通就能证明整条链路。

数字来自官网计算器同一份计费引擎（`docs/clients/east-inter/calculator-2026-10/pricing-engine.js`，本窗口 10-14 在本机跑出）：

| 条件（广州出发，海运拼箱 LCL） | 计算器结果 |
|---|---|
| 1 m³ → 悉尼 | A$378（约 20 天） |
| 5 m³ → 悉尼 / 墨尔本 / 布里斯班 | 都是 A$1,238（布里斯班约 25 天） |
| 10 m³ → 悉尼 | A$2,252（= 每 m³ A$225.2） |

**提交工单前必须再对一次线上计算器**（本机引擎与线上页面应一致，但没有生效日期，只能当天核）；任何一个数字对不上就以线上为准、重写 props。

### props 草稿（`brief.remotion = { template: 'datacard', props }`）

```json
{
  "bgColor": "#123B63",
  "textColor": "#FFFFFF",
  "brandColor": "#F2A900",
  "logoFile": "logo.png",
  "musicFile": "horizons-call.mp3",
  "musicStartSec": 0,
  "hook": { "lines": ["CHINA→SYDNEY", "1 m³ ≈ A$378"] },
  "hookSec": 2.5,
  "rows": [
    { "label": "Current rates", "value": "A$378",   "sublabel": "1 m³, Guangzhou → Sydney", "bar": 0.17 },
    { "label": "5 m³",          "value": "A$1,238", "sublabel": "same price, 3 cities",      "bar": 0.55 },
    { "label": "10 m³",         "value": "A$2,252", "sublabel": "A$225 per m³",              "bar": 1 }
  ],
  "rowSec": 1.6,
  "holdSec": 3,
  "barMode": "bars",
  "disclaimer": "Estimates only. Subject to a binding quote."
}
```

- 没有月份、没有倒计时/限时/截止/最低价；「Current rates」在第 1 行标签里。
- 「Estimates only」是官网原句；PM 指定的完整句「Indicative estimate. Final charges are subject to a binding quote.」是 66 个字符，**模板免责文案上限 44 个字符放不下**（改上限要改模板代码，不在本轮范围）。做法：画面用官网原句短版（43 字符），**完整句放进 Facebook 配文第一行**，不丢。需 18 号/PM 认可这个折中。
- 海运类必须带「不含 GST」：画面放不下，写进配文和首评（「Not included: any applicable GST, import duty, fumigation…」按计算器原话）。
- 画面条形（bar）只是相对长度，不代表比例精确；数值才是数据。
- 素材：数据卡**没有镜头素材**，只用 East 的 logo；所以这条试跑**不涉及**物流素材，也不会有「通用场景图」问题。6 条正式片才用 Dropbox 里 Pexels 授权的物流素材（逐条登记在 `collection-record.json`），并标「Illustrative footage / 通用场景图，非东际实拍」。
- **音乐（18 号已授权我挑）**：选共享乐库 `Music/Horizon's Call.mp3`（乐库登记 id `horizons-call`，30 秒，约 110 BPM，能量中、风格 light、「开阔、期待」，PM 确认 Dropbox/ME 乐库可用）；props 里写暂存名 `horizons-call.mp3`。**我没听过它**，不能保证无人声——请苏东坡+马良审的时候一并听；有人声就换 `Feel Good Travel`（低能量）或 `Building Momentum`（中速渐强，CTS 用过）。不踩点（数据卡没有节拍表）。
- 其余工单必填项（照 CTS 10-06 的工单样例）：`client_id=2e3f040d-4497-4527-89f6-50b6fa91e205`、`master_brief_id=09aae30e-160e-494f-b25c-98ff22a1ef72`、`order_type=fresh_angle`、`angle_source` 写明「PM 授权试跑 + 官网计算器核对日期」、`budget_cap_usd=0.5`、`brief.copy.endcard`（cta + 官网 url，否则审核页「CTA/首评链接」自动检查会判不过）。`content_work_orders.goal_id` 是 NOT NULL；18 号已在生产库为 East 建了一条**草稿占位目标** `goal_id=4160565f-df4a-403c-a725-ad7e9a0f9d74`（status=draft，不参与广告自治，**只是占位，不是正式目标，正式目标由广告计划另定**；回滚：`delete from goals where id='4160565f-df4a-403c-a725-ad7e9a0f9d74'`）。本窗口 10-14 只读核对过：存在、属于 East、status=draft。提交工单用它。

## 2. 配方对账表（CLAUDE.md §8，必须先出）

2026-10-14 实查生产库 `viral_reference_library`（只读）：行业只有 travel / beauty / fashion / tech / fitness / real_estate / flooring / food / ai_education / digital_marketing。**没有物流、贸易**，也没有「纯数字画面」类配方；全库对账细节沿用 `scripts/factory-worker/engines/remotion/DATACARD_RECIPE_RECONCILIATION.md`（388 条样本）。

| 配方列 | 这次做了什么 | 判定 |
|---|---|---|
| 第 0 帧文字钩子、禁风景空镜 | 第 0 帧就是「CHINA→SYDNEY / 1 m³ ≈ A$378」大字，无任何风景 | ✅ 满足 |
| 开场钩子 text_overlay_question / product_reveal | 价格悬念 + 数据行逐行揭晓 | ✅/⚠️ 部分（文案好坏取决于 props） |
| 视觉冲击 visual_shock | 纯色底+文字，无冲击镜头 | ❌ 未满足 |
| 真人出镜 / 自拍感 / 幽默共鸣 | 无任何真人 | ❌ 未满足 |
| 真实感（自有实拍） | 无任何实拍素材 | ❌ 未满足 |
| 快切 | 每行 1.6 秒逐行揭晓，不是镜头快切 | ⚠️ 部分 |
| 航拍 | 无 | 不适用（纯数字） |
| 配乐踩点 | 未选乐；若选乐也**不踩点** | ❌ 未满足 / 未验证 |
| 弱化 logo、不加尾卡 | logo 只作右上标识，无尾卡 | ✅ 满足（以成片为准，分镜表核） |
| 素材真实性 | 无第三方素材 | 不适用 |
| 行业配方（物流/贸易） | 库里没有 | ❌ **缺口**（只能攒样本后回填） |

缺口只能靠换素材/换模板补，不假装调参数能补；数据卡不能替代真人/实拍主力片，只作价格补充（模板回执 `recipeGaps` 会如实写进成片回执）。

## 3. 成片前分镜自检表（模板；成片出来后由出片窗口逐格填，再交苏东坡+马良）

截成逐帧缩略图（建议 0.4 / 2.8 / 4.4 / 6.0 / 7.6 / 9.5 / 11.5 秒共 7–9 格），每格查三件事：

| 格 | 时间 | 图对不对 | 字对不对 | logo |
|---|---|---|---|---|
| 1 | 0.4s | 纯色底+钩子，无错位、无被 Facebook 界面遮挡区（顶部约 y<270、底部 y>1248）压住的字 | 「CHINA→SYDNEY / 1 m³ ≈ A$378」与计算器一致 | 清晰完整（来自 East 品牌包 watermark.png） |
| 2 | 2.8s | 第 1 行 A$378 + 条形 | 「Current rates」「1 m³, Guangzhou → Sydney」 | 同上 |
| 3 | 4.4s | 第 2 行 A$1,238 | 「same price, 3 cities」（悉尼/墨尔本/布里斯班，核计算器） | 同上 |
| 4 | 6.0s | 第 3 行 A$2,252 | 「A$225 per m³」（2252/10=225.2 ✓） | 同上 |
| 5 | 7.6s+ | 全部行+免责 | 「Estimates only. Subject to a binding quote.」，无月份/倒计时/限时/最低价 | 同上 |
| 6 | 末帧 | 无文字重叠、条形不越界 | 免责行完整不被裁 | 同上 |

另查：真播放确认有音轨（若选乐）；字幕 SRT 逐条与画面一致；红线复扫无命中（East 已配 22 个禁用词）。生产方（本窗口）自评不算，审的是苏东坡（文案/价格）+ 马良（画面/封面）。

## 4. 提交工单的入口（走视频工厂，不另写脚本）

沿用 CTS 10-06 同一条路：把 §1 的 props 填进工单 JSON（样例结构见 `docs/clients/cts/2026-10-06-shanghai-reel-orders/E3.order.json`），写入 `content_work_orders`（状态 queued，只存草稿，`budget_cap_usd=0.5`），**出片机自己领单、渲染、传回、进审核队列**；成片出现在 ME 驾驶舱 `/dashboard/factory` 审片队列。不调任何生成 API、不碰发布。生产库写入需 PM/18 号在提交那一刻明确授权，并先 `dry_run` 校验 props（`engines/remotion` 的 `loadTemplate('datacard', props)`）。

## 5. 出片机就绪清单（本窗口不能做，等通知）

1. PR 2646 已合并，出片机那台电脑的 worker 代码升级到含它的版本（旧版领到 datacard 会拒）。
2. 出片机 `.env`：`FACTORY_REMOTION_CLIENT_IDS` 追加 `2e3f040d-4497-4527-89f6-50b6fa91e205`；`FACTORY_CLIENT_STUDIO` 加 `"2e3f040d-4497-4527-89f6-50b6fa91e205":"East_Inter"`（`MagicLab_Studio/East_Inter/brandkit` 已建，含 logo/水印/主色）。
3. 重启出片机，并在日志里看到启动正常。
4. 出片机窗口（106）在 PM 授权下做；做完 18 号通知我「出片机已就绪」。

## 6. 成功标准与没验证的

- 已验证：上面这份 props 用真实引擎 `loadTemplate('datacard', props)` 校验通过（长度、颜色对比度都合格），总长 309 帧 ≈ 10.3 秒；红线复扫看到的文字里 `m³` 会被规范成 `m3`（只影响复扫文本，画面仍是 m³）。
- 成功：工单进 `in_review`，成片 1080×1920，字幕与画面一致，红线复扫无命中，苏东坡+马良逐项审过；PM 看到可用样片。
- **没验证**：线上计算器今天是否仍是这些数；音轨怎么解决；数据卡真实渲染（本机没装渲染依赖，只跑过假引擎和强制打开的引擎契约测试）；完整免责句放不进画面这个折中是否被认可。
- 不做：6 条正式片、物流素材混剪（montage）、发布、广告投放。

## 7. 竞品公开报价对比（111 号，2026-10-15，Google + 公开网页，只读，没联系任何对手）

口径：广州出发、海运拼箱（LCL）到悉尼，人民币按计算器同口径 4.9 折澳元（向上取整）。**东际数字来自官网计算器同引擎；对手数字来自对手官网公开页面，均是「估价」，多数页面没写日期。**

| 公司 | 类型 | 1 m³ | 5 m³ | 10 m³ | 含什么 | 不含什么 | 时效 | 页面日期 / 来源 |
|---|---|---|---|---|---|---|---|---|
| **东际（计算器）** | 中文圈货代 | **A$378**（RMB 1850） | **A$1,238** | **A$2,252** | 中国出口清关、海运、澳洲进口清关+检疫(AQIS)、30km 内送货 | GST、关税、熏蒸 A$143、熏蒸检查 A$49、报关行费 A$99 起 | 约 20 天 | 官网计算器，无生效日期 |
| 好望角物流（goodhope86.com） | 中文圈货代 | A$439（RMB 2150） | A$1,378（2150+4×1150） | A$2,551（2150+9×1150） | 目的港清关、30km 内送货、5 类商品报关费、澳洲服务费 GST | 进口 GST 10%、关税、海关系统费 A$92/票、熏蒸 RMB 700、AQIS A$49 | 开船后约 15 天+清关 2 天+拆柜 1–3 天；采集 2–5 天 | 页面无日期 |
| 递接物流 DJ Cargo（djcargo.cn） | 中文圈货代 | A$510（RMB 2500，币种页面未标，按人民币推断） | A$1,816（2500+4×1600） | A$3,449（2500+9×1600） | 「双清不含税」、30km 内免费送货 | 税 | 页面未写 | 页面无日期 |
| Spotyard（spotyard.com.au） | 澳洲本地进口货代 | A$245.24（货值≤RMB 1 万）/ A$274.09（>1 万） | 页面只给 1 m³ 例，未给分档（按线性只能当粗估 A$1,226–1,370，不可当报价） | 同左 | DDP，页面写「进口关税和 GST 已含在运费里」 | 中国提货、保险、特殊处理、偏远附加费 | 装柜后 15–25 个工作日 | 价格配置更新 2026-10-09 |
| Epic Sourcing（澳洲） | 采购/进口服务 | 每 m³ 约 A$150–300（文章区间） | — | — | 未说明 | 未说明 | — | 2026-04-05，只看到 Google 摘要，**未打开原文核对** |
| Crazy.freight（Facebook 广告帖） | 中文圈货代 | 「Lowest Rate from AUD 170」 | — | — | 未说明 | 未说明 | — | 2026-08-20，只看到 Google 摘要，**条件不明，只能当线索** |

### 怎么读这张表（只摆事实，不替 PM 定价）

1. **同类（中文圈货代、同样「双清 + 30km 送货」结构）里，东际最便宜**：1 m³ 比好望角低约 14%、比递接低约 26%；5 m³ 低约 10% / 32%；10 m³ 低约 12% / 35%。而且东际连熏蒸 RMB 700（≈A$143）、AQIS A$49 这些附加项的数字跟好望角几乎一样，说明口径可比。
2. **澳洲本地 Spotyard 的 A$245–274 明显更低，且写着税已含**。东际 A$378 不含 GST/关税，所以对着这一家，东际在标价上高 38%–54%，真实落地价差距更大。
3. **「最便宜」「最低价」一律不能写**：Spotyard 和 FB 帖都比东际低，禁用词也已入库。可写的是「同口径可比」「明细即时可见」「同样的 5 类附加费都写明」。
4. **没核实的**：各家有效期（多数无日期）、递接的币种、Spotyard 是否真含 China 端清关、Crazy.freight 的条件、Epic Sourcing 原文；没找到 DHL/Schenker/中外运的拼箱公开价（它们是大公司，不是东际真正抢客户的对象）。

## 8. 为什么 Spotyard 这么低 / 东际高是不是因为包含更多（111 号，2026-10-15）

**页面写明的事实（Spotyard 官网）**：价格只覆盖「标准假设」——深圳出发、普货、1 m³ 按 100 kg 算、申报货值 RMB 5,000（≤1 万档）或 15,000（>1 万档）、有卸货条件的商业地址；排除中国提货、保险、特殊处理、查验、仓储、住宅卸货、偏远附加费，金额都没写；「密度大或最低计费体积可能增加计费 CBM」，没写公斤/立方换算；页面不是报价，「subject to freight availability and confirmation」；Spotyard 自称「中介，不持有进口或报关行牌照」，实际由中国货代伙伴订船、报关。**页面写「关税和 GST 已含在运费里」，但没写怎么算。**

**我的推算（不是页面说的，标为推断）**：GST = 10% ×（货值+运费+保险+关税）。货值 RMB 15,000 ≈ A$3,061，光 GST 就 ≥ A$306，已经高于它 >1 万档的整个报价 A$274.09；货值 RMB 5,000 ≈ A$1,020，按 0 关税反推，运费只剩约 A$130，按 5% 关税反推只剩约 A$79——都远低于东际/好望角/递接的整个海运+清关底价。所以「税已含」不可能按真实货值全额成立，更像：①按很低的申报货值或打包税额算（中文圈常说的「包税渠道」，每方 RMB 650–1300，Spotyard 的 A$245≈RMB 1,200 正好落在这个带）；②或者实际要加钱（查验、重货折算、偏远、住宅卸货、保险都没写金额）。我**不能证明**它是哪一种，也不是说它违规；只能说它与「货值多少、税怎么交」强相关，而不是运费本身更便宜。

**东际高，是因为多含了东西吗？**
- 对比好望角（同类、同样「双清+30 km 送货」）：它含的东西东际也含（目的港清关、30 km 内送货、一批报关）。它写明不含：进口 GST、关税、海关系统费 A$92/票、熏蒸 RMB 700、AQIS A$49；东际写明不含：GST、关税、熏蒸 A$143（=RMB 700）、AQIS 检查 A$49、报关行费 A$99 起。**两家附加项几乎一一对应，所以东际没有「多包」什么，反而 1 m³ 便宜约 14%。**
- 两家都按「实际重量÷500 kg 折算立方」（东际计算器、好望角页面都写 500 kg = 1 m³），口径一致；Spotyard 没写。
- 所以东际 A$378 高于 Spotyard A$245–274，**主要不是东际多含了费用，而是 Spotyard 的「包税」口径不同/假设很窄**；这个判断是推断，要拿真实货值走一遍两边的完整报价才能最终确认。

**市场区间（中文圈货代公开文章，非官方）**：双清包税门到门每方常见 RMB 650–1,300（旺季上浮 15–20%）；双清不含税（东际这类）首方 RMB 1,800–2,500（好望角 2,150、递接 2,500、另一家 1,800/2,300），续方 900–1,600。东际 1,850/1,050 处在「不含税」档的低端。文章自己也说：同一航线不同货代报价差几倍，原因多是包含的费用范围不同。

## 9. 物流素材看片结果（111 号，只各看了一帧缩略图，没完整播放）

Dropbox `00_Inbox/industry-logistics/2026-10-14_International_Logistics/originals` 现有 24 个文件（10 视频、14 图；Codex 窗口 21:20 后又新增 4 条视频，登记文件 `collection-record.json` 仍只登记了 20 条，**新增 4 条（e0c4…、5c83…、dcb5…、f37c…）待登记，登记前不用**）。
- 适合做背景、无明显第三方品牌：港口集装箱船（e5a9…，45 秒，偏暗）、码头航拍（b49c…）、集装箱铁路平板车（f37c…，未登记）、叉车搬托盘（e0c4…，未登记）、公路货车（93f8…，**唯一竖屏 1440×2560**）、传送带包裹（47ba…）。
- 要避开或遮挡：日本邮政国内货车（70d9…，不能当跨境）、Delta（dcb5…，未登记）/ Philippine Airlines（a184…）/ 吉祥航空（353e…）机身、OEL INDIA 船名（1627…）、HELI 叉车（2d5c…）——有第三方品牌。
- 大多是 16:9 横屏 4K，要裁成 9:16 竖屏，会损失两侧画面。全部标「通用场景图，非东际实拍」。

## 10. 进展（111 号，2026-10-15）

- **A 版（纯数字价格卡，链路验证，不是成品）已出片**：工单 `6403582c-808f-4db2-991f-d454bb129f92`（东际 `2e3f040d…`，goal=占位目标 `4160565f…`），status=`in_review`，成片 1080×1920、10.304 秒、-18.5 LUFS，7 项自动检查全 PASS，`redline_hits=[]`，花费 0。提交前已用线上计算器引擎核数：悉尼 1/5/10 m³ = A$378/1,238/2,252。**没看过存储桶里出片机渲的那份文件**（无存储钥匙，审片页要登录），只用本机同参数预览代替；待真人真播放并听 Horizon's Call 是否有人声，再交苏东坡+马良审。不发布。
- 出片卡了约 30 分钟的原因：出片机开机自启文件里写死过「只领 CTS」，盖住了 .env；106 号去改时发现已被别人改掉，重启后心跳含 CTS+Oztop+东际。教训：出片机环境变量要看**启动文件**，不能只看 .env。
- **B 版（物流素材+价格混剪）**：本机预览已做（17.6 秒，9 段裁成竖屏的 Pexels 素材；props 存 `2026-10-15-east-montage-preview.props.json`）。**没提交工单。** 已知问题：价格 ≈A$378 只停约 1 秒；画面有 TOYOTA/INNOVA 字样；两段公路货车像南亚路景需换；音乐没听过、节拍未验；正式提交前素材要先放进 `MagicLab_Studio/East_Inter/remotion-assets/clips/`（现在只在本机临时目录）。
- 竞品对比与「澳洲本地 Spotyard 为何更低」见第 7、8 节。
- 后续（不在本轮做）：不可见字符整类拒收（U+FE0F 等，list/montage/datacard 三个模板共有）；数据卡免责句 44 字符上限放不下完整句。

## 11. B 版（混剪）已建单 + 配方对账表 + 分镜自检（111 号，2026-10-15）

- 工单 `c716f7ee-67f6-4ee8-beec-e7dea921d9bf`（东际，goal=占位 `4160565f…`），出片机渲染（纯本机，**没调任何付费生成接口，花费 0**，预算上限 0.5 美元），status=`in_review`，7 项自动检查全 PASS，`redline_hits=[]`。成片 18.2 秒。PM 在对话回「提交混剪」授权，18 号也回「东际继续」。素材 10 段（Pexels 授权，来源/授权见 `MagicLab_Studio/East_Inter/remotion-assets/clips/SOURCES.txt`），已排除所有带第三方品牌的画面。
- **以后不需要再改出片机自启文件**：106 号/18 号已把 plist 里写死「只领 CTS」两行去掉，名单现在由 `.env` 管；线上白名单（Render `FACTORY_WORKER_CLIENT_IDS`）已含 CTS、Oztop、东际。

### 配方对账表（mixed montage；库 `viral_reference_library` 10-15 复查：行业只有 travel/beauty/fashion/tech/fitness/real_estate/flooring/food/ai_education/digital_marketing，无物流）

| 配方列 | 这次做了什么 | 判定 |
|---|---|---|
| 第 0 帧数字/文字钩子 | 第 0 帧「1 M³」大字 + 码头镜头 | ✅ 满足 |
| 禁风景空镜开场 | 开场是码头航拍但同时有大字钩子，不是空镜 | ⚠️ 部分 |
| 视觉冲击 visual_shock | 无强冲击镜头 | ❌ 未满足 |
| 快切 | 每拍一切（约 0.55 秒），指定小节半拍加速 | ✅ 满足 |
| 满屏大字 | 一词一屏，多种底色/旋转 | ✅ 满足 |
| 航拍 | 3 段码头航拍 + 港口船 | ⚠️ 部分 |
| 配乐踩点 | 拍点按乐库登记 110 BPM 算，登记状态 beats_unverified，没人听过/量过 | ❓ 未验证 |
| 真人出镜 / 自拍感 | 只有叉车操作员远景，无真人面对镜头 | ❌ 未满足 |
| 真实感（自有实拍） | 全部是 Pexels 库存 | ❌ 未满足（`recipe_gaps` 已记） |
| 弱化 logo、不加尾卡 | logo 只在最后 2 拍 | ✅ 满足 |
| 素材真实性 | 授权已登记；配文写 Illustrative footage，不暗示东际实拍 | ✅ 满足 |
| 行业配方（物流） | 库里没有 | ❌ 缺口 |

### 分镜自检（本机同参数预览逐帧看过；出片机渲的那份我没能打开）

| 时间 | 画面 | 文字 | logo |
|---|---|---|---|
| 0.2s | 码头起重机航拍 ✓ | 「1 M³」✓ | 无（设计） |
| 2.4s | 码头集装箱船航拍 ✓ | 「≈A$378」✓，停约 1.6 秒 | 无 |
| 5.6s | 阴天海面集装箱船 ✓ | 「EXCL.」→「GST」→「& DUTY」✓ | 无 |
| 8.0s | 码头起重机 ✓ | 「DOOR TO DOOR」✓ | 无 |
| 11–14s | 海面船 / 航拍 ✓ | 「CUSTOMS CLEARED」「30KM DELIVERY INCLUDED」✓ | 无 |
| 15–17s | 叉车搬托盘（操作员远景，不特写面部）✓ | 「LIVE PRICES ONLINE」「NO SIGN-UP」✓ | 无 |
| 18s（末 2 拍） | 海面船 | 无字 | 东际 logo 完整、清晰 ✓ |
未见：月份、倒计时、限时、最低价、第三方品牌文字。**价格在 4–7 拍出现，约占片长 1/4 处，不是第一秒**；封面（第 0 帧）是「1 M³」+ 码头，不是价格数字本身。

## 12. v3（按苏东坡/马良审改意见重做，111 号，2026-10-15）

- 工单 `bf7fe47c-cf8c-4a2d-965e-1789ab7a9263`（取代 `c716f7ee…`，旧单未动），出片机本机渲染，花费 0，status=`in_review`，7 项自动检查全 PASS，`redline_hits=[]`，16.6 秒。**没有调任何付费生成接口。**
- 逐条对应审改意见：
  1. 价格回执：线上计算器真实页面截图 `evidence/2026-10-15-live-calculator-sydney-{1,5,10}cbm.jpg`（1 m³ = A$378；5 m³ = A$378+4×215 = A$1,238；10 m³ = A$317+9×215 = A$2,252），回执路径也写进工单 `angle_source.price_receipts`。页面服务卡原文 `DOOR TO DOOR · CLEARANCE INCLUDED`，页脚原句 `Estimates are indicative. Final charges are subject to a binding quote.`
  2. 字幕序列按苏东坡给的：1 M³ ≈A$378 / CHINA / TO / SYDNEY / ≈A$378 / DOOR / TO / DOOR / CLEARANCE / INCLUDED / LIVE / PRICES / ONLINE / NO / SIGN-UP / CURRENT / RATES / ESTIMATES / ONLY（仅第一词合并了价格，让第 0 帧见价格；已删 30KM DELIVERY INCLUDED、CUSTOMS CLEARED、EXCL. GST & DUTY）。
  3. caption 用他给的原文（m³ 统一、去掉 customs broker fee/fumigation/AQIS、加 Please confirm taxes, duties and insurance…）。
  4. 封面第一帧见价格 + East Inter logo（`evidence/…-v3-cover-frame.jpg`）。**注意：模板规定第一个词必须以数字开头且 logo 只在最后 2 拍，所以首帧的 logo 是我做进「封面素材板」里的，不是模板自带。**
  5. 换掉：Port of Balt… 吊机航拍、TOP FRUITS 叉车、SYDNEY 处的快递分拣带；现用素材全是无品牌无地名的集装箱堆场俯拍、港口船、装卸口、仓库货架、手持扫描、气泡膜（见 `East_Inter/remotion-assets/clips/SOURCES.txt`）。
  6. ONLINE：稳态不裁边；模板每个词开头 3 帧（0.1 秒）有「砸入」放大动画（1.7 倍），宽词这 0.1 秒会超出画面边——这是模板行为，不改代码就没法消除；已把宽词旋转归 0。
  7. 结尾价格板 3.3 秒（CURRENT RATES ESTIMATES ONLY）：≈A$378 + 1 m³ · China → Sydney · current rates + Estimates only，logo 全程在（前段在板里，最后 2 拍由模板叠，位置对齐；模板叠加那一下有轻微抖动）。网址在首条评论。
  8. Story 首帧（与封面不同）：`evidence/…-v3-story-first-frame.jpg`（仓库货架底 +「Same price to Sydney · Melbourne · Brisbane / A$1,238 / 5 m³ by sea · door to door / Current rates · Estimates only」），原图在 `East_Inter/review-assets/`。5 m³ 到三城同价来自计算器引擎（Melbourne/Brisbane 5 m³ 也是 A$1,238，Brisbane 约 25 天）。这只是 Story 的首帧静图，不是 Story 成片。
- **分镜自检（9 宫格）**：`evidence/2026-10-15-v3-storyboard-9grid.jpg` + 结尾四帧 `evidence/2026-10-15-v3-endcard-frames.jpg`；逐格看过：无第三方品牌字样、无地名、无月份/倒计时/限时/最低价；价格在第 0 帧和第 4–6 拍都见到。**我看的是本机同参数预览，没能打开存储桶里出片机渲的那份。** 音乐 Horizon's Call 已由 PM 听过无人声。
- 没解决（模板限制）：首帧 logo 与第一词必须数字开头的规则；词「砸入」动画 0.1 秒超边；真人出镜/真实感/行业配方仍是缺口。

## 13. v4（第二轮审改，111 号，2026-10-15）

- 工单 `b872551f-1ef3-44f8-839a-836a824dd039`（取代 `bf7fe47c…`，旧单不动），出片机本机渲染，花费 0，不发布。参数 `2026-10-15-east-montage-preview.props.json`。
- 逐条：①**封面第 0 帧**：原因是模板每个词开头 3 帧从 1.7 倍放大「砸入」+ 整个镜头层第 0 帧放大 1.22 倍，贴边内容会被切。改法：第一个词缩短成「1」（窄），logo/价格/路线放进封面素材板的安全边距内（X 130–950），帧 0 与 0.3 秒都不贴边（`evidence/2026-10-15-v4-cover-frame0-and-0.3s.jpg`）。②**结尾板**：现在只有价格 + logo + **See your live estimate** + **eastinter.com.au**（官网真实域名，页面当前跳转到 eastinter.com.au）+ `1 CBM · Guangzhou → Sydney · current rates` + `Estimates only`；字幕词 CURRENT/RATES/ESTIMATES/ONLY 已删，板上只剩价格卡（因为模板每拍必须有词，用价格词占位，不再乱跳）。③**logo 不重影**：板里的 logo 按模板叠加位置反向补偿（1.04 倍），最后 2 拍用无 logo 板 + 模板叠加。④**Story 首帧**：补了 Melbourne、Brisbane 5 m³ 线上计算器截图（均 A$1,238，Brisbane 约 25 天），标题改「5 m³ to Sydney · Melbourne · Brisbane」+「Same estimate for all three」。⑤起运地写 Guangzhou（板、Story、caption 都加）。⑥**M3→CBM**：模板对字幕做 Unicode 规范化会把「m³」变成「m3」，所以视频里一律写「1 CBM」，caption 写「1 CBM (1 m³)」，不再有 M3。⑦换掉欧式砖拱老仓库+红叉车镜头（DOOR TO DOOR 现在用仓库货架/港口船/俯拍）。
- 仍未解决（模板限制）：每词开头 0.1 秒砸入动画（马良已认可）；logo 不是模板首帧自带；真人出镜/真实感/物流配方缺口。
- 我没能打开存储桶里出片机渲的真实文件；以上是本机同参数渲染的逐帧自检，请马良/苏东坡复审真实件。

## 14. v5（第三轮审改，只改结尾板 + 一个字幕词，111 号，2026-10-15）

- 工单 `9ddac532-2441-480b-9dd5-3e5ad10eca8f`（取代 `b872551f…`，旧单不动），出片机本机渲染，花费 0，不发布。v4 苏东坡已通过；马良除结尾板外封面第 0 帧、Story 首帧、音轨、镜头均通过。
- **结尾板怎么锁静止（模板限制的绕法，不改代码）**：模板每一拍都是一个新镜头段，每段开头 5 帧把镜头层从 1.22 倍缩回 1.04 倍并抖动，所以「每拍脉冲」是模板行为。绕法：节拍数组允许任意间隔，把结尾做成**一个 3 秒的长镜头段**（beat 25→26 间隔 3.0 秒），整个结尾只在开头有一次 5 帧入场缩放，之后完全静止（`evidence/2026-10-15-v5-endcard-frames.jpg` 前 2 帧是入场、后面是静止、末帧是模板自带淡出）。模板叠的 logo 因此是结尾 3.5 秒里**唯一的 logo，位置固定**（左上，不是居中放大——模板 logo 位置不可配）。
- 结尾板内容：Guangzhou 路线行 + See your live estimate 按钮 + 「≈」徽标 + A$378 大字 + eastinter.com.au + Current rates · Estimates only，全部在安全边距 ≥60px（入场放大 1.22 倍时也不贴边）；删掉了「1 CBM」闪牌和重复价格词，因为模板每拍必须有词，结尾那一个词用「≈」（1 个字符，砸入 1.7 倍时也放得下）。
- 字幕：LIVE PRICES → CURRENT PRICES。封面价格条字号收小。
- **没能做到的**：logo 居中放大（模板 logo 位置固定在左上）；结尾板下方约 1/3 仍为空——那是 Facebook 界面遮挡区（y>1248），把内容放进去会被盖住，所以内容集中在 470–1250 之间。若 PM 要求 logo 居中/结尾板铺满全屏，需要改模板（加 endcard 参数），属开发窗口，建议用 DeepSeek 写、子牙魏征审。
