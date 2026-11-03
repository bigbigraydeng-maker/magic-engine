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
| 9 | 开放搜索收录 | 全站 noindex；没有 robots.txt、sitemap；不存在的页面返回首页（软 404）；没有 canonical、分享图 | 频率高 / IMPACT 高 / 收入中 → P0 |
| 10 | 装数据追踪 | 没有 GA4、Meta 像素、Search Console；Cookie 横幅是照搬的、点了不生效 | 频率高 / IMPACT 高 / 收入中 → P0 |
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
