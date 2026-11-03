# HBay Water：hbaywater.com 现状与待办（2026-11-03）

## 现状（当天实测）

- **线上**：https://hbaywater.com ，内容来自同事 Jundong 的 V5 版（原仓库 `jundongGit/hbay-v5` 作废）。
- **代码**：`bigbigraydeng-maker/hbay-magic-engine-demo`，合并 `main` 即上线。Jundong 已被邀请为写权限协作者（待他接受）。
- **托管**：Cloudflare Pages 项目 `hbaywater`（hello@magicengine.cloud 账号，免费档），每个 PR 自动出预览链接。
- **域名**：GoDaddy 注册；域名服务器已改为 Cloudflare，解析在 Cloudflare 管。www 和 http 都 301 到 https://hbaywater.com。旧 github.io 演示链接也 301 到这里。
- **当天已改**：收费字体换成免费字体（标题 Fraunces、正文 Figtree）；首页大图只保留「Natural Artesian Water」一张；手机端白边、照片蓝框、页脚对齐已修。

## 两个站并存（PM 2026-11-03 拍板）

hbaywater.com 与客户自己的 nzmiracle.com **并存**，不互相替代。分工按此执行：

- **hbaywater.com = 品牌消费者站**（我们管）：面向新西兰超市购物者，ME 的 SEO / AI 可见度 / 广告落地都以它为准。
- **nzmiracle.com = 公司站**（客户管，我们只读）：公司介绍、质检报告原件、出口与批发联系。
- 两站标题和简介不能写成一样（否则在搜索里互相抢）；两站互相加链接（nzmiracle.com 那边要客户加）。
- 结构化数据里两个网址都标成同一个品牌的官方站（sameAs），让 AI 知道是一家。

## 待办

### 要 PM 拍板

1. HBay 签没签约：ME 里仍是「潜在客户」，合同停在草稿 v0.7。接账号、花广告钱都在签约之后。
2. 域名、Cloudflare、代码都挂在我们名下：合同里要写清客户退出时怎么移交。
3. ME 客户档案的网址从 nzmiracle.com 改成 hbaywater.com（改生产数据，要 PM 回话）。

### 要客户给 / 审

4. 隐私政策、使用条款现在是样稿，要客户审。
5. 水质数字（pH 7.3 等）、Hill Labs 检测说法、「Bottled in Hastings」要客户核对。
6. 账号权限：Facebook 主页、Instagram、Google 商家资料、Meta 广告账户、GA4 / Search Console。
7. 真实社媒链接（页脚现在只链到各平台首页）。
8. nzmiracle.com 加一个指向 hbaywater.com 的链接。

### 我们做（按 ENGINEERING_QUALITY_GATES §11 排序）

| # | 事 | 现状 | 打分 |
|---|---|---|---|
| 9 | 开放搜索收录 | 全站 noindex（要 PM 本人点头才能去，SEO 手册档 3）；sitemap.xml 11-03 已加但**还没提交给 Google**；robots.txt 仍没有；不存在的页面返回首页（软 404）；没有 canonical、分享图 | 频率高 / IMPACT 高 / 收入中 → P0 |
| 10 | 装数据追踪 | **GA4 已装（11-03）**、**搜索控制台已验证（11-03，域名级）**；**ME 已授权 Google 并接上（11-03）**，同步成功但数字是 0（见下，这是正常的，不代表有数据）；Meta 像素没装（没投广告）；Cookie 横幅是照搬的、点了不生效；隐私政策要补一句「使用访问统计」 | 频率高 / IMPACT 高 / 收入中 → P0 |
| 11 | 批发询盘进 ME | 「Trade Enquiries」跳 nzmiracle.com 联系页，询盘 ME 看不到；并存后可保留跳转，但要先在本站留一个能进 ME 的询盘入口 | 频率中 / IMPACT 高 / 收入高 → P0 |
| 12 | 订阅框能用 | 填邮箱不会保存到任何地方 | 频率中 / IMPACT 高 / 收入中 → P2 |
| 13 | AI 可见度底子 | 页面没有正文大标题（H1）；没有品牌/产品结构化数据；AI 可见度上次实测 0/3 | 频率中 / IMPACT 中 / 收入中 → P2 |
| 14 | 清照搬残留 | 参考站的购物车代码、SEO 插件注释、icelandicglacial 字样 | 频率低 / IMPACT 低 / 收入中 → P3 |
| 15 | 照片署名 | 风景照来自公共图库，授权要求署名，现在没有（已公开，版权风险已存在） | 频率低 / IMPACT 低 / 收入中 → P3 |

规矩要求补：网页上线前过 Impeccable 检查（CLAUDE.md §7），这个站还没过，跟第 9 条一起做。
第 9 条要等第 4 条（客户审完隐私政策）再开，否则样稿会被搜索收录。

### ME 系统接入（签约后）

16. 客户档案补第一份 master_brief（现在 0 份，没有 brief 按红线不能做任何对外内容）。
17. 账号到位后接社媒、广告、口碑三条线。
18. 新站上线后重测 AI 可见度，作为起点。

## 数据测量（2026-11-03 已做，PM 回「可以」）

- **GA4**：属性名 HBay Water，建在 Google Analytics 的「Magic Engine」账号下（和 Park Homes 同账号，没另开账号，免新条款）；网站数据流 hbaywater.com；衡量 ID G-ZL3CZPGQ35 已装进 index / privacy / terms 三页，实测实时报告收到访问（页面标题对、page_view 在）。
- **搜索控制台**：域名级属性 hbaywater.com，用 Cloudflare 里加一条 TXT 记录验证通过。**那条 TXT 不要删**，删了会失去验证。没有授权 Google 去读 Cloudflare 账号（选了手动那条路）。
- **不设关键动作（key event）**：品牌形象站没有收银台，也没有留联系方式的表单；点「Find in store」只是跳去超市搜索页，看不到后续成交，不算。GA4 自动记点击出站链接，不用另设。以后只有批发/出口询盘提交值得设，要等询盘入口建好并能进 ME；投广告后也可再加。
- **主数字**：①品牌词搜索量（GSC，ME 里 HBay 品牌词别名已填 4 个）；②AI 可见度（8 月实测 0/3，作起点）；GA4 只当背景（来多少人、从哪来）。
- **账号归属**：PM 定——GA4 和搜索控制台建在我们名下，客户当管理员，合同写退出移交（对应上面「要 PM 拍板」第 2 条）。**我们这边的管理员有两个**（11-03 已加并回读核对）：bigbigraydeng@gmail.com（创建者；GA4 是组织管理员+管理员，搜索控制台是所有者）和 hello@magicengine.cloud（PM 指定；GA4 管理员，搜索控制台所有者）。**客户那边的邀请先不发**：ME 档案里只有 admin@nzmiracle.com，是公司公共信箱、联系人姓名为空，而且 nzmiracle.com 的邮件走微软 Outlook，不是 Google 账号，邀请发过去对方要先注册 Google 账号才能接受；合同也还没签。等合同签了，让客户指定一个人、给 Google 邮箱（Gmail 或 Google 工作邮箱）再发（见台账 2026-11-03-hbay-client-admin-invite-after-signing）。
- **ME 授权 Google（11-03 已接上）**：PM 看过授权范围（含商家资料管理、表格读写、网址索引提交；Google 提示应用未验证，开发者是 bigbigraydeng@gmail.com；这个账号此前已给过 ME 7 项服务的权限）后回「点继续」，我点了继续。搜索控制台选了 sc-domain:hbaywater.com 并保存；GA4 自动列属性失败（老毛病，magic-engine#1127 那条），改手动填 Property ID，保存时 ME 现场读了一次数据，验证成功。两个「立即同步」都成功，但数字全是 0：搜索控制台是因为网站还不让收录；GA4 是因为标准报表比实时报告晚 24–48 小时（实时报告里已有我的测试访问）。**所以现在只能说「接上了」，不能说「有数据了」**，11-05 提醒那天再看。
- **sitemap.xml**：已上线（3 个网址），**先不提交给 Google**：网站仍是 noindex，开放收录要 PM 本人点头。

## 新 ME 配置（2026-11-03，PM 回「完成 hbay 在新 ME 内的配置」「确认写入」）

新 ME = 通过 Claude 连接器 `https://portal.magicengine.com.au/api/portal/mcp` 访问的那套，客户名 Hbay（id 5bfb7e39-4dd5-4e0b-a45e-fdf72d8ad044）。所有写入都走「提案 → 确认」。

- **已填**：行业=其他（行业清单里没有瓶装水）、简介、市场（新西兰、英文）、2 个产品（1.5 L ×6、500 mL ×24）、4 个品牌名、4 个地名、3 条卖点、2 类客人（超市购物者、批发买家）、2 个竞品网站（antipodes.co.nz、1907water.co.nz）；网站健康目标网址 https://hbaywater.com/ ，每周一次。
- **品牌草稿**：系统读 hbaywater.com 生成了 v1 草稿，**没有启用**。语气部分有网站依据；视觉部分只有默认白底黑字，缺 Logo 和品牌蓝 #1E95D4，补齐并经 PM 看过才启用。
- **故意没填**：关键词（要 DataForSEO 实测，旧系统那 7 个来源不明没带过来）；水质数字和检测说法（客户还没核对，不写进「可用说法」）；客户登录账号（等签约）。
- **还没处理**：系统里另有一份「企业资料草稿」状态是待处理；客户档案的「网站」字段仍为空（没找到能设置它的功能，只设了网站健康那边的网址）。
- **新加坡（PM 11-03 补充，11-04 回「加新加坡」）**：新 ME 档案的目标市场已改为新西兰+新加坡（2026-11-04 11:41 回读：目标市场 NZ、SG；服务地区 NZ、语言英文保持不变）。注意：企业资料「市场」分区的写入是整区覆盖，只传一栏会把另外两栏清空（这次踩到，已当场写回）；以后改这一区必须三栏一起传。网站仍只面向新西兰，是否做新加坡内容待 PM 决定。
