# East Inter 官网：追踪代码 + 隐私政策（草稿，未上线）

范围只有两样：①追踪（Meta 像素 + GA4）②/privacy 页。官网在独立仓库 `bigbigraydeng-maker/east-inter-demo`，本目录是可直接放进去的成品文件；**没有部署，合并本 PR 不会改官网**。

## 要 PM 提供的东西（不得自拟）
1. ~~Meta 像素编号~~：已有，`2901017560298130`（East Inter Pixel，已连 East 澳币广告户，统筹 18 号 10-14 提供），已填进 `tracking-config.js`。代码里 `fbq('init', id)` 不传任何用户信息；Meta 后台的「自动高级匹配」开关必须保持关闭（这是数据集设置，不在代码里，需在 Events Manager 里确认）。**10-14 统筹 18 号已核对：「网站自动高级匹配」为关闭。** 另有一项默认开着：「自动包含更详细的页面和商品信息」（AI 识别页面详情，不含个人信息），未改动，**PM 10-14 已定：关闭。** 由 18 号在 Meta 后台（Events Manager → East Inter Pixel → 设置）关掉，上线前确认。
2. ~~GA4 衡量编号~~：已建，`G-Y0L10QHRLB`（谷歌分析账户 East Inter → 媒体资源 eastinter.com.au，澳元、悉尼时区；10-14 PM 同意条款后由我创建；创建时 4 项数据共享全部取消），已填进 `tracking-config.js`。
3. **隐私页主体名称**：目前页面只写「East Inter International Logistics」（与官网页脚一致）；如要写澳洲公司全名或 ABN，请给。
4. **隐私页要不要请人看一眼法律措辞**（建议开投前看，页面把数据去向写成了 China + Google/Meta 海外处理）。

两个编号都已填：合并并发布官网后两边即开始记事件；发布前什么都不会发。

## 文件 → 官网仓库
- `tracking-config.js`（新）填两个编号；`tracking.js`（新）；`privacy.html`（新）
- `index.html`、`eastinter-pricing-calculator.html`（改）：页头加两个 script，页脚加 Privacy policy 链接，别的没动

## 记什么事件（只记点击，不记个人信息）
| 事件 | 触发 | Meta | GA4 |
|---|---|---|---|
| 邮件链接点击 | 任一 mailto 链接 | Contact | quote_email_click |
| 首页询价表单提交（只是在访客自己的邮箱里生成草稿） | 表单 submit | Contact | quote_email_prepared |
| 计算器第一次真实操作 | 选服务/城市/填数量，每次打开只记一次，只带服务和城市 | ViewContent | calculator_estimate |
| 首页点去计算器 | 链接点击 | 自定义 | calculator_cta_click |
| 打开任一页 | 自动 | PageView | page_view |

口径提醒：这些是「点击信号」，不是询盘（网站看不到邮件有没有真发出去），与 108 号一页纸第 1 层一致。访客开了「请勿追踪」时，什么都不加载。GA4 关闭了 Google 信号和广告个性化。

## 验证（2026-10-14）
- `node --test docs/clients/east-inter/site-tracking-2026-10/tests/tracking.test.js`：9 项通过，退出码 0（没填编号不加载；编号格式不对不加载；请勿追踪不加载；各事件不带个人信息）。
- 本地起服务打开 /privacy、计算器页：页面正常，控制台无报错，没填编号时 fbq/gtag 都不存在。
- Impeccable：隐私页只有 1 项，且是模板里估价卡的阴影，不在隐私页上，属误判。
- **没跑**：用真实编号的联调（没有编号）；Meta 事件测试工具里的实测；GA4 实时报表实测。这三项等 PM 给编号、合并并上线后当场做。

## 回滚
官网仓库删掉 `tracking-config.js`、`tracking.js`，把 `index.html` 和计算器页还原到上线前版本（此时官网最新为 `35fa64f`），`privacy.html` 删掉即可。
