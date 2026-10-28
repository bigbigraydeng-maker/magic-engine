# 上海团改名 Shanghai & Beyond · 全面检查清单（2026-10-28 NZ 晚；PM 通知：CTS 上海团从 10/29 起全面更新为 Shanghai & Beyond）

取数方式：Mailchimp 网页后台（PM 已登录的 Chrome，只读，逐封拉正文搜关键词）、官网仓库与本仓库 grep、ME 生产库只读 SELECT。
没有客人邮箱、姓名落盘。**没改任何邮件、草稿、官网、库，没发任何东西。**

## 一、已知与未知

- 已知：PM 说「CTS 的 shanghai tour 从明天起全面更新为 Shanghai & Beyond」。
- 官网现在（10/28 晚）还没改：团页、站点地图里都没有 Beyond；本地所有官网工作目录、hello@ 邮箱、云端硬盘都没有任何改名资料。
- 未知（要 PM 给或等官网更新后读）：只改名，还是价格 / 出发日 / 路线 / 网址也变；新团页网址是什么。
- 历史：这个团 10 月前叫 Shanghai & Beyond，10 月活动期改叫 Shanghai & Surroundings；官网仓库有一条跳转「/tours/china/discovery/shanghai-beyond → shanghai-surroundings」，官网项目说明里写着「Surroundings（不是 Beyond）」。

## 二、Mailchimp（扫描 92 封活动的正文，0 封读取失败）

含旧名「Surroundings」的共 34 封：草稿 13、已发 21。含「Beyond」的 0 封。

### 2.1 草稿 13 封（以后可能被发出，改名要动手）
| 编号 | 名称 | 旧名出现次数 | 说明 |
|---|---|---|---|
| 15909753 | Email 1 · T+0 Welcome（每天 8:01 批次的底稿） | 2 | **在用：明早 8:01 若有新 Facebook 客人就会发这封**；另含已下架圣诞团和旧价 NZ$3,399 |
| 15910789 | 新人欢迎信 v2（2027 春季版，今晚刚做的） | 3 | 改名后要同步改；还没上线 |
| 15910787 | 电话后跟进：2027 年 3 月出发的中国小团（PM 说过「发 54」） | 5 | 发出前必须按新名字改 |
| 15910593 / 15910596 / 15910597 / 15910598 / 15910599 | 上海周边 N1–N5（上海团专属的 5 封跟进信） | 5 / 3 / 1 / 3 / 1 | 通篇用「Shanghai + Surroundings」，N4 写着 NZD $2,699 包含什么；路线价格变了就要重写，没变也要改名 |
| 15910600 | 上海周边 SP2 | 3 | 「十天走四个地方：苏州…」路线描述，要核新路线 |
| 15910364 | W1 2026-09-23「你从哪出发」分群信 | 2 | 带团页链接 |
| 15910375 | PREVIEW ONLY 新版欢迎信 2026-09-22 | 2 | 预览稿，勿发 |
| 15909756 | Email 4 · T+14d Final Call（旧序列） | 2 | 链接是 /campaigns/october-2026/shanghai-surroundings；已在上午拆雷（只发测试地址） |
| 15910547 | China Tour 3 Nov 2026 Best of China 出发前须知 | 1 | 只是行程句子里的「Shanghai surroundings」，不是团名，可不改 |

### 2.2 已发 21 封（改不了，只能保证链接还能用）
每日欢迎批次 auto_e1_batch_* 10 封、E2/E4 旧批次 5 封、E2 序列 1 封、上海周边 SP1（10/8，723 人）、春季 newsletter v5（活动名带「[DRAFT v5 NOT SENT]」，Mailchimp 报告显示 10/16 已发 694 人，含 8 处旧名和团页链接）、W3、reeng_r2、回团感谢信（上海及周边团，只写「你们刚走过的那个团」，不用改）。
这些邮件里的链接都指向 /tours/china/discovery/shanghai-surroundings（或 /campaigns/october-2026/shanghai-surroundings）。**官网改名时旧网址必须继续能打开（跳到新页面）**，否则已发邮件里的链接会失效。

## 三、官网仓库 chinatravel（只读检查，归网站开发窗口）
- 53 个源码文件、约 274 行含「Surroundings」；团页网址 shanghai-surroundings 在源码和公共文件里共 174 处引用。大头：营销计划数据 marketing-plan-2026.ts 42 行、十月活动页数据 october-2026-discovery.ts 24 行、各类博客 / 指南数据、best-china-tours 等 SEO 页、团目录数据 tours.ts、Baker 团介绍 baker-tour-intros.ts。
- **next.config.js 第 78 行现有跳转 shanghai-beyond → shanghai-surroundings。改名时必须反过来或删掉，否则新名字的网址会被跳回旧页面。**
- 项目说明 CLAUDE.md 第 89 行写着「Surroundings（不是 Beyond）」，改名后要同步，否则后面的窗口会再改回去。

## 四、本仓库 magic-engine（ME）
- **ME 生产库的团目录：已发布版本表 tour_catalog_published 的 2 行都含旧名**（工作区、出发日、别名表里没有）。改它要走团目录自己的发布流程，不能直接改库。
- src/lib/crm/note-parser.ts 第 502 行：CRM 备注里识别团名的关键词表含「shanghai & surroundings」，新名字不加就识别不出。
- src/lib/messenger-agent/verifier/policies/cts.ts：Messenger 助手的核对规则里把 shanghai-surroundings 当作需要精确匹配的团页网址，改名后要重新核。
- src/app/dashboard/factory 的测试 reviewCardMeta.test.ts：视频工厂里「Shanghai & Surroundings #10：water towns」这类系列命名，有没有要跟着改，归工厂负责人。
- public/campaigns/cts-china-2027.html：一张还写着「Shanghai & Surroundings … from $3,399pp (Oct 2026)」的落地页（价格和日期都已过期），是否还在对外使用要查。
- docs/clients/cts 下约 56 份历史文档提到旧名，是历史记录，不需要改。

## 五、没做 / 没核实
- 没看 Facebook / Instagram 帖子、Meta 广告素材、GBP 帖子、每日计划里的文案是否写着旧名（归社媒 / 广告 / 口碑各窗口）。
- 没逐封打开 Mailchimp 里的 N1–N5、SP2，看它们的具体承诺是否与新路线冲突，要等新路线资料。
- Mailchimp 里的标签和分群名（例如 tour_shanghai_surroundings_oct2026）是内部名称，没动，也不用改。

## 六、下一步
1. PM 给新名字下的价格 / 出发日 / 路线 / 网址，或说「等官网改完再读」。
2. 官网改完后，我按新页面重新核对，再改：欢迎信 v2、电话后跟进、上海周边 N1–N5 与 SP2；每日批次底稿要在 8:01 前换成新版（PM 说「开」）。
3. 其它窗口的那一份（官网仓库、ME 团目录、助手规则、工厂）由我整理成清单交给对应窗口，PM 点头后再发。
