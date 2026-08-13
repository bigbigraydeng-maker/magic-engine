# NZCPE 2026 — 客户档案

**建档日期**：2026-08-04 · **client_id**：`3f3617f5-2124-475d-9212-6f8c14f0b0e2` · **接入模式**：FDE（`clients.source = 'fde'`）
**master_brief id**：`bdd70553-b16a-47ba-a5c8-bfb219e508ac`（v1，`is_active = true`）

> 本文标每句话的来源：**官网可溯**（WebFetch nzcpe.co.nz 抓到）· **brief可溯**（PM 提供的 `NZCPE-2026_Marketing-Asset-Kit-Brief.docx` / `GO-LIVE-Guide-nzcpe.co.nz.md`，源文件在 `~/Documents/Claude/Projects/NZCPE/`）· **未证实**（待 FDE 核实，不能直接对外用）。

## 一句话

新西兰-中国商品博览会（NZCPE），第 6 届，2026年11月20-22日（19日布展）在奥克兰 NZICC 举办的 B2B 贸易展会，中国商务部贸发局 + 广东省贸促会主办，EJ Holdings Ltd（新西兰独家承办方）执行。*(brief可溯)*

## 基本信息

| 项 | 值 | 来源 |
|---|---|---|
| 域名 | nzcpe.co.nz | 官网可溯 |
| 建站方式 | Claude Cowork 生成 → Cloudflare Pages 部署（项目名 `nzcpe-site`），域名原在 GoDaddy，已转 Cloudflare 管 DNS | brief可溯（GO-LIVE 手册）|
| 表单 | Formspree 三个 endpoint（Exhibitor/Buyer/Visitor） | brief可溯 |
| 主办方 | NZ EJ Holdings Ltd（New Zealand International Convention Centre，101 Hobson Street, Auckland CBD） | brief可溯 |
| 主办/背书机构 | 中国商务部贸易发展局、CCPIT 广东省委员会；16 个新西兰商会背书（CCCNZ / Auckland Business Chamber / NZCTA / EMA 等） | brief可溯 |
| 展会日期 | 2026-11-19 布展 · 11-20 贸易日（仅买家）· 11-21/22 公众日 | brief可溯 |
| 总联系邮箱 | info@nzcpe.co.nz（Formspree 已接，能收到表单） | brief可溯 |
| 总机电话 | +64 9 9750686 | 官网可溯 |
| 主要负责人 | **Richard Meng +64 21 535168**（NZ EJ Holdings Ltd，PM 2026-08-05 确认为 NZCPE 主要对接人） | PM 确认 |
| 买家/赞助/媒体邮箱 | buyers@ / sponsorship@ / media@ / exhibitors@nzcpe.co.nz | brief可溯 |
| 上一届数据（2025） | 现场交易 2000万人民币，意向合同 7000万人民币；2024届 12,000+ 访客，1,900+ 专业买家 | brief可溯 + 官网可溯 |
| 13 个行业分区 | 食品饮料/礼品文创/纺织服装/家居建材/数码电子/户外运动/光伏储能/文旅/电商/金融/物流航运/非遗工艺 + 4 个省份馆(广东/陕西/湖南/福建) | brief可溯 |

## 品牌视觉（2024.07.31 VI 手册）

- **NZ 深蓝**（主色）`#003DA5` · **中国红**（主色）`#E81E1D` · 深藏青(logo阴影) `#002B73` · 天蓝(logo高光) `#4F88C9` · 深红 `#B71818`
- 英文字体 Manrope(展示)/Inter(正文)；中文字体 思源黑体(展示)/苹方(正文)
- 双语 EN/ZH，双主色（新西兰蓝 + 中国红）— **不要**用 Tailwind 默认 sky-/emerald- 等色顶替，已按客户档规则录入 `master_briefs.vi_colors`

## 目标受众

- **B2B**：中国制造商/出口商(找NZ入市通道) · NZ进口商/零售商/经销商 · 采购团队 · 投资人 · 政府贸易机构(NZTE/MFAT/MPI/MBIE) · 行业商会
- **B2C（仅周末公众日）**：奥克兰居民(占历届公众访客73%) · 华人社区 · 亲子家庭 · 价格敏感型购物者
- **地域**：主 = 奥克兰 · 次 = Waikato/Bay of Plenty/Wellington/Christchurch · 三级 = 太平洋岛国贸易伙伴(斐济/萨摩亚/汤加/瓦努阿图)

## 社媒渠道 — 当前范围（PM 2026-08-05 拍板）

- **Facebook**：已确认存在，Page = "New Zealand China Products Expo"，`page_id = 721663957708055`（48 粉丝，PM 2026-08-05 截图确认），已写入 `clients.facebook_page_id`。同一资产下还绑了一个 Instagram（31 粉丝，handle 待查——本轮暂缓不用管）。这个 Page 挂在它自己独立的 Business Manager `721685761039208`（"New Zealand China Products Expo"，PM 是 Admin，不是 PM 的通用账号，是专属这个客户的 BM）。
  - ✅ **2026-08-05 已打通**：通过浏览器在该 BM 的「公共主页 → 指定合作伙伴」把 Page 共享给 Magic Engine 业务组合（`business_id 1265811139097132`），权限勾了「内容」「广告」「成效分析」三项。Facebook 侧已确认生效（合作伙伴列表里能看到 Magic Engine）。
  - ⏳ **待确认**：ME 这边实时调用的 Meta Ads 工具（`ads_get_pages_for_business`）分享后立即查还是空的，大概率是 Facebook 那边的权限传播延迟（一般几分钟到更久），不是操作失败。下次会话先重查一遍确认能读到，再往下推进发内容/建广告。
  - 广告账户：还没建。倾向直接用 Magic Engine 已有的广告账户（`1018365291238494`，NZD，已有付款方式，状态正常），不用给 NZCPE 单独开户——等上面的权限传播确认后再验证这个账户能不能用这个 Page 投放。
  - 顺带一提：PM 早前截图里 Business Suite 顶部有一条红色提示"上一笔付款失败，广告已暂停投放"——不确定是不是这个账号的，PM 自查一下，这条跟接管 Page 无关，只是路过看到了。
- LinkedIn / Instagram / WeChat / 小红书 / TikTok：**本轮暂缓**，brief 里的优先级仅供未来参考，当前不投入精力

## 本轮推广目标（PM 2026-08-05 拍板）

**主要目的 = 11 月进口博览会的 To C（面向公众）推广**，不是 B2B 展商招募/买家注册那条线。对应 brief 里"周末公众日"目标：奥克兰居民 + 华人社区 + 亲子家庭，目标 15,000 公众访客（Sat 11-21 / Sun 11-22）。网站+FB 内容优先服务这个目标，B2B 展商/赞助商相关内容非本轮重点。

## 2026 营销目标（brief可溯，PM/EJ Holdings 定的，非 ME 承诺）

招 160+ 展商（2025基线150）· 注册 2,200+ NZ专业买家（2024基线1,900）· 12+ 赞助商 · 周末公众访客 15,000 · 250场预约买家/展商配对 · LinkedIn 粉丝到 5,000 · 邮件库到 15,000

## FDE 接手范围（2026-08-05 收窄）

**网站**（Cloudflare Pages 上的 nzcpe.co.nz，内容更新/SEO/表单监控）+ **Facebook**（唯一在跑的社媒渠道），服务于 **11 月博览会**。LinkedIn/Instagram/WeChat/小红书/TikTok 暂缓。

### ⚠️ 推广方向：两条线目前不一致，**以本节为准**

同一天（2026-08-05）先后有两个口径，谁最新一眼看不出来，所以在主档里定死：

| 线 | 现行方向 | 依据 |
|---|---|---|
| **网站 SEO / 排产内容** | **B2B** —— 中国企业出海 / NZ 企业对华采购、供应链 | PM 2026-08-05 **后**改的口径，见 [seo-content-plan.md](./seo-content-plan.md) 开头「方向调整」。第一篇 To C 文章（Family Day）已上线不撤，后续按 B2B 排产 |
| **广告 / Facebook 社媒** | **To C** —— 冲 15,000 周末公众访客 | [content-and-ads-plan.md](./content-and-ads-plan.md)，对应客户自己的公众访客目标 |

**这不是笔误，但也没被明确批准成「就该这样」。** 待 PM 一句话定死（ROADMAP `NZCPE-1`）：
是有意分开跑（SEO 抓 B2B 长尾、广告抓公众到场），还是广告也要一并转 B2B。
**在 PM 定死之前，广告线按 To C 继续跑**，不要因为看到 SEO 转了 B2B 就自行改广告受众。

## 假新闻清理（2026-08-05，已上线）

`news.html`/首页/`about.html` 里建站时留下的编造内容已处理：
- **彻底删除**：Foodstuffs"官方2026买家合作伙伴"（brief 只说是历届买家，非合作伙伴）、Q1 2026 贸易涨8.9%+Statistics NZ 品类细分（年份错+无出处）
- **编辑修正**：2025/2024 届总结去掉未证实细节，只留 brief 能对上的数字
- **PM 确认后恢复**：2026 首次从 Auckland Showgrounds 换到 NZICC 是真的，补回一条准确版本（去掉编造的"买家人流翻倍"数字）；合办方 Shaanxi Brand Culture Technology Co., Ltd.（SCG 子公司）确认真实，保留
- **PM 拿不到真数字，已删除**：2024 届现场交易/意向合同具体金额（原写 400万/8000万人民币，逻辑还矛盾——意向合同比 2025 届还高却叫"增长"）、2025 届展区面积"5,000㎡"

## 假新闻清理漏网补丁（2026-08-14）

8-05 那轮清理漏了一批编造买家名单，散在 6 个文件（`about.html`/`register-exhibitor.html`/`exhibit.html`/`index.html`/`china-focused-trade-shows-new-zealand.html`/`china-business-entry-new-zealand-market.html`），写着"历届买家包括 Mainfreight / The Warehouse Group / Noel Leeming / Metro 10 / EMA"——brief 只 confirm 了 Foodstuffs 一家历届买家，其余全无出处，已全部删除只留 Foodstuffs。`china-business-entry-new-zealand-market.html` 还查到一条编造的"Q1 2025 贸易增长8.9%"（可见正文 + JSON-LD FAQ + 隐藏的 AI 说明块三处都写了，已全删）；`china-focused-trade-shows-new-zealand.html` 有编造的"five-tier sponsorship"赞助档位细节（brief 只有 sponsorship@ 邮箱，没有具体档位设计），已改成"联系 sponsorship@ 问档位"。

**这次多查到的教训**：网站里除了人看的正文，还藏着专门喂给 AI 搜索引擎看的隐藏说明块（`class="ai-instructions"`，`display:none`），这次假新闻清理 8-05 那轮完全没扫到这层——以后清理假内容要连这层一起查，不能只看人眼可见的部分。已部署。

## 网站地址错误修复 + GBP 卡点（2026-08-05）

**发现并修复**：网站全站写的 NZICC 地址"11–13 Hobson Street"是错的。NZICC 官网（nzicc.co.nz）两处信源核实，真实地址是 **101 Hobson Street, Auckland Central, Auckland 1010**。已全站（13个文件，23处）改正并部署验证生效。

**GBP 卡点（需要 Richard 动手）**：Google 上已有一个未被认领的商家档案"NZCN Expo Auckland office"（同一主办方旧年份用的，地址 161 Central Park Drive, Henderson），PM 拍板要把它改名/更新成 2026 版。但这个档案**还没被认领**，Google 要求认领必须走验证流程（通常是给公司自己的电话/地址发验证码），得客户自己的账号去认领，不能用我们的账号认领——认领完之后加我们 Manager 权限，我们才能改名字/地址/网站链接。这步我做不了，需要 Richard 本人操作。

**顺带查到的真实信息**（未来有用）：
- 该展会 2023 届网站 nzcnexpo.co.nz 还在，组织方写的是"EJ Holding Limited"，场地是 The Trusts Arena, 65-67 Central Park Drive, Henderson
- 真实联系方式：NZCNEXPO@126.com，电话 0214050930 / 021535168
- NZ EJ Holdings 真实注册办公地址：Level 15, Tower 2, 205 Queen Street, Auckland CBD 1010
- Eventbrite 上有独立的 2026 届 listing，地址写 101 Hobson Street——跟 NZICC 官方地址交叉验证一致
- 场地沿革：2023 The Trusts Arena(Henderson) → 2024/2025 Auckland Showgrounds(Epsom) → 2026 首次搬到 NZICC(CBD)

## 追踪工具接线状态（2026-08-05 全部打通）

| 工具 | 状态 | ID / 备注 |
|---|---|---|
| Google Search Console | ✅ 全通 | 已验证(HTML tag+Domain双重生效) + 已提交 sitemap.xml |
| GA4 | ✅ 全通 | Property "NZCPE 2026"，Measurement ID `G-Q2L7PFQSB5`，挂在 Magic Lab 账号(390936306)下，跟 CTS/Oztop 同一套结构；直接写 gtag.js 到全站，没另建 GTM 容器 |
| Meta Pixel | ✅ 全通 | 发现 NZCPE 业务组合下**早就有一个从没装过的 Pixel**(`1109538797562911`)，直接拿来用没建新的；已装到全站 PageView + 三个报名表单成功提交时触发 `Lead` 事件(GA4 同步触发 `generate_lead`) |
| Google Tag Manager | ⏭️ 跳过 | GTM 的价值是"不用改代码就能加新工具"，但这次两个追踪工具都是直接改代码部署的，加一层 GTM 反而多一次跳转+有重复计数风险。以后要频繁加新的第三方像素再考虑 |

**部署方式**：Cloudflare wrangler + 专属 API token(`ME NZCPE Pages Deploy`，权限限定 Cloudflare Pages:Edit，账号 bigbigraydeng)，不用共享的全局 CLI 登录（本机多窗口并行时全局登录会被别的窗口切走，踩过坑）。

## 待办（已回写 [docs/ROADMAP.md](../../ROADMAP.md) → 「近期待办 › NZCPE 2026」段，编号 NZCPE-1…5）

1. **推广方向口径待 PM 一句话定死**（NZCPE-1）——见上面「推广方向」那节，SEO 已转 B2B、广告仍 To C
2. GBP 建档，地址挂 NZICC（101 Hobson Street, Auckland CBD）——自然搜索流量（NZCPE-2）
3. 确认 `plan_tier`（现设 starter，无预算信号，PM 确认后再调）（NZCPE-3）
4. 广告账户挂谁（NZCPE 自建 vs Magic Engine `1018365291238494` 代投）——PM 待拍板（NZCPE-4）
