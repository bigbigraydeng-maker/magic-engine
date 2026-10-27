# 迁移对账表（MIGRATION-MAP）

> **负责人**：苏东坡（`sudongpo`）（维护人，无改正文权；升进正文须子牙签字+PM 合并）· [苏东坡档案](../../agents/14-sudongpo.md)
> **范围**：迁移对账表：原文要点编号 → 去向
> **状态**：迁移稿，待 PM 审批（不新增规则、不改含义）
> **日期**：2026-10-28
> **最后核实**：2026-10-28（对照迁移源逐条核对）
> **风险**：A 级（经验手册正文，改正文须 PM 回「合」）；本次迁移为纯文档；迁入内容不等于获批的新规则
> **代码依据**：无（纯文档，不涉及代码；规则来源为开发侧记忆原文）

> 作用：让人核对「没有漏迁、没有改义」。原文每个要点一个编号，一行一条，写明去向。迁移日期 2026-10-28；迁移稿只搬运、不新增规则、不改含义。

> 编号前缀：**S** = `playbook-social-general.md`（通用手册）· **R** = `feedback-viral-reel-recipe-over-montage.md` · **C** = `feedback-video-caption-short-big.md` · **F** = `feedback-first-frame-must-differ-and-worth-posting.md` · **B** = `feedback-cts-feed-repetitive-bgm-price-screen-mix-2026-10-15.md` · **V** = `reference-video-first-frame-cover-chrome-facts-2026-10-27.md`。均在开发侧记忆目录 `~/.claude/projects/-Users-raydeng-Projects-magic-engine/memory/`（仓库外）。

> 带 `x` 后缀的编号（如 S14.1x）是同一原文要点被拆开后「客户层那一半」；带 `a/b/c` 后缀的是原文一个段落里的并列小点。去向里写「平台层 §x」指 platform-general.md 的第 x 节。

## 统计

- 原文要点总数：**231** 条（含元数据与指针行）。
- 去向：平台层 **186** · 行业层（旅游，候选）**5**（B4 第二轮移入客户层，行业层只留指针）· 客户层 **31**（含 S23.2x、B4） · README 吸收 **1** · 留在记忆不迁 **2** · 丢弃 **6**。
- 说明：有些要点被拆成两半（规则放平台层、事故/数字放客户层），拆分的以 `x` 后缀另立一行，不在上面重复计数；同时进两处的（S13.5 规则与实例、S14.1/S17.1/S19.1/S20.1/S21.1 去项目名后的规则）按主去向计一次。
- **新增归属指针，非迁移内容**：README.md 的「归属说明」一行（视频工厂相关内容归 ME Video 维护，正文以 `docs/sops/video-factory-index.md` 为准）不来自任何原文要点，不在上面 231 条之内，也不计入任何去向数。
- 「拿不准归层」的见文末「待判清单」。

## 丢弃项及原因

| 编号 | 内容 | 原因 |
|---|---|---|
| S-FM / R-FM / C-FM / F-FM / B-FM / V-FM | 六份记忆文件头部的 frontmatter（name、description、metadata、originSessionId、modified 等） | 记忆系统的元数据，含会话编号，不属于内容；description 的信息已被 README 与各节标题吸收 |
| S13.6（只丢数字） | NM Medspa 接入例子里两个具体的 Facebook 页面编号（14 位与 16 位数字） | 含页面编号，迁移规则不带客户页面编号入仓库；规则本身保留（见 S13.5） |

**含密钥已丢弃**：本次六份源文件逐字读完，**没有发现 token、密钥、账号密码、个人邮箱、手机号、广告账户编号**；唯一含编号的是上面的页面编号。`platform_oauth_connections` 查询里的 `<客户ID>` 是占位符。

## A. playbook-social-general.md（通用手册，S；43 KB，约 352 行）

| 编号 | 原文位置与要点 | 去向 | 备注 |
|---|---|---|---|
| S-FM | 文件头 frontmatter（行 1-11：name/description/metadata/originSessionId/modified 等） | 丢弃 | 记忆文件元数据，含会话编号，不属于内容 |
| S0.1 | 范围声明（行 13）：这份文件装"怎么做出一条能被人看完的社媒内容"的通用方法论；写新条目前先问"换个客户、换个行业还成立吗"；客户专属进 project-* 文件 | README.md「重要声明」「三层各放什么」 | 口径保留为分层判据，未逐字搬 |
| S1.1 | §一 数据配方 · 开场钩子：空镜最差，赢的是视觉冲击/文字悬念/UGC/声音钩子；第一帧禁用纯风景空镜 | platform-general §一 | 逐字 |
| S1.2 | §一 数据配方 · 技法：满屏文字、问题-解决方案、快切、延时靠前；航拍靠后 | platform-general §一 | 逐字 |
| S1.3 | §一 数据配方 · 风格：幽默/真实代入/UGC 靠前；要真实粗糙感；logo 开场+尾卡是低分特征 | platform-general §一 | 逐字；样本是否限旅游「待判」，已在正文标注 |
| S1.4 | §一 来源：连续两次同类事故（相隔 6 周）、library 几百条样本被绕开 | platform-general §一（去客户化）；事故细节见 R1.2/R2.1/R2.2 | 拆分：原文未点名客户，但 R 文件点名 CTS，细节放客户层 |
| S1.5 | §一 根因教训：只抄"改数字就能满足"的列，没动需换素材形态的列，结果是卡得很准的幻灯片 | platform-general §一 | 逐字 |
| S1.6 | §一 怎么用 1：排 Reel 前先查该行业高播放样本抽配方 | platform-general §一 | 逐字 |
| S1.7 | §一 怎么用 2：逐列自检，尤其需换素材形态的列；做不到诚实标缺口 | platform-general §一 | 逐字 |
| S1.8 | §一 怎么用 3：只满足节奏参数 = 没照配方做 | platform-general §一 | 逐字 |
| S2.1 | §二 来源：文字/CTA 被 FB/IG 界面遮挡的多次事故 | platform-general §二 | 逐字；事故指向客户层 C2.5、C3.1 |
| S2.2 | §二 顶部死区 y=0~270 | platform-general §二 | 逐字 |
| S2.3 | §二 底部死区 y=1248~1920 | platform-general §二 | 逐字 |
| S2.4 | §二 右侧约 120px 互动栏，关键文字居中 | platform-general §二 | 逐字 |
| S2.5 | §二 CTA 不烧进画面，放 caption/首评 | platform-general §二 | 逐字 |
| S2.6 | §二 vmin 换算（1 vmin≈10.8px；大标题 8-10、品牌名 3-4） | platform-general §二 | 逐字 |
| S2.7 | §二 导出前逐帧看/叠 y=270/y=1248 参考线 | platform-general §二 | 逐字 |
| S2.8 | §二 IG Reels 同规则；Stories 底部死区约 250px，拿不准按 Reels | platform-general §二 | 逐字 |
| S3.1 | §三 来源：整段产品介绍当字幕被压成小字 | platform-general §三 | 逐字；事故指向 C1.3（Oztop） |
| S3.2 | §三 怎么用 1：屏幕字幕一律短句，一行≤6 词 | platform-general §三 | 逐字 |
| S3.3 | §三 怎么用 2：模板兜底不许用完整业务句 | platform-general §三 | 逐字 |
| S3.4 | §三 怎么用 3：能不能一眼读完 | platform-general §三 | 逐字 |
| S3.5 | §三 怎么用 4：超长截断+最小字号双保险 | platform-general §三 | 逐字 |
| S4.1 | §四 来源：换新模板漏 logo，PM 要求所有视频统一加 | platform-general §四 | 逐字（去客户事故） |
| S4.2 | §四 怎么用：logo 水印是硬标准，挑/建模板先确认有图层 | platform-general §四 | 逐字 |
| S4.3 | §四 补法参考 CTS Golden China 模板 Watermark 图层；客户 logo 去 VI 包取 | clients/cts.md §二 | 含客户名，拆出 |
| S4.4 | §四 原独立记忆并入说明与事故：CTS 2027 早鸟换 Storytelling 模板漏 logo | clients/cts.md §二 | 含客户名，拆出 |
| S5.1 | §五 来源：用文件名后缀判真实素材导致 AI 输出被误判 | platform-general §五 | 逐字；事故指向 R4.2（Oztop） |
| S5.2 | §五 只有客户实拍才能当产品/展厅承诺 | platform-general §五 | 逐字 |
| S5.3 | §五 判定字段是来源事实记录，不是文件名 | platform-general §五 | 逐字 |
| S5.4 | §五 素材供给现实：客户不定期批量投喂 | platform-general §五 | 逐字 |
| S5.5 | §五 Premium 层 | platform-general §五 | 逐字 |
| S5.6 | §五 Ambient 层 | platform-general §五 | 逐字 |
| S6.1 | §六 来源：抓图-AI 洗版权管线会抹掉署名 | platform-general §六 | 逐字 |
| S6.2 | §六 怎么用 1：授权素材走原样使用的独立路径+署名环节 | platform-general §六 | 逐字 |
| S6.3 | §六 怎么用 2：优先 CC0/公有领域+客户自拍 | platform-general §六 | 逐字 |
| S7.1 | §七 两条技术路线对照表 | platform-general §七 | 逐字 |
| S7.2 | §七 关键限制：进 AI 路线必被重绘，无"只加运动"中间选项 | platform-general §七 | 逐字 |
| S7.3 | §七 i2v 通病：复杂场景失真（三家模型都如此） | platform-general §七 | 逐字 |
| S7.4 | §七 AI 静默删增画面元素 | platform-general §七 | 逐字 |
| S7.5 | §七 排镜头：主体放大放前景，密集人脸/小字别用 i2v | platform-general §七 | 逐字 |
| S7.6 | §七 提示词避免"浅景深" | platform-general §七 | 逐字 |
| S7.7 | §七 验证看成片实际用到的剪辑区间 | platform-general §七 | 逐字 |
| S8.1 | §八 来源：Reel 正文链接不可点击、带链接正文被压触达 | platform-general §八 | 逐字 |
| S8.2 | §八 怎么用 1：一律用 Reel，IG 同理 | platform-general §八 | 逐字；第二轮加「已过期/待核」标注，保留原文 |
| S8.3 | §八 怎么用 2：CTA 链接放首评 | platform-general §八 | 逐字 |
| S8.4 | §八 怎么用 3：首评链接必须带追踪参数 | platform-general §八 | 逐字 |
| S9.1 | §九 来源：多轮复刻流行剪辑风格仍不满意，瓶颈其实是素材形态 | platform-general §九 | 逐字 |
| S9.2 | §九 怎么用 1：先分清是参数问题还是素材形态问题 | platform-general §九 | 逐字 |
| S9.3 | §九 怎么用 2：确属执行层技能就优先买现成 | platform-general §九 | 逐字 |
| S9.4 | §九 2026-09-22 新增确认实例：大瑞打码自写 FFmpeg 滤镜链屡败，改用已买的 Creatomate 原生元素一次做对 | clients/darui.md §二 | 含客户名，拆出 |
| S9.5 | §九 实例结论句：连技术实现类底层操作也先查已买工具；指向 feedback-use-established-paid-vendor-not-self-built | platform-general §九 | 结论句逐字；被指向的记忆未迁（见 S-REL） |
| S10.1a | §十 基础权限可拿：点赞/评论/分享 | platform-general §十 | 逐字 |
| S10.1b | §十 需洞察权限：播放量/时长/触达/独立观看人数 | platform-general §十 | 逐字 |
| S10.2 | §十 怎么用：先确认账号权限档位再写验收标准 | platform-general §十 | 逐字 |
| S10.3a | §十 三个数字 1：开头几秒留存 | platform-general §十 | 逐字 |
| S10.3b | §十 三个数字 2：播放进度曲线跳水点 | platform-general §十 | 逐字 |
| S10.3c | §十 三个数字 3：平均播放时长÷总长 | platform-general §十 | 逐字 |
| S10.4 | §十 2026-10-14 CTS 主页 Story 实测：没洞察权限读不到观看/回复/贴纸数，换指标名仍 #3 | clients/cts.md §四 | 含客户名；归层待判 |
| S10.5 | §十 当时决定（74 号）：不改授权范围，改用 20:00 私信 Story 发出后 12 小时新开私信会话数当效果量，连续两周再下结论 | clients/cts.md §四 | 含客户决定；归层待判 |
| S10.6 | §十 核对「发出去的＝批准的」：逐像素比对（同尺寸差个位数＝同一张） | platform-general §十 | 通用方法，原文放在 CTS 实测段内；归层待判 |
| S11.1 | §十一 来源：为钩子编造官网没有的细节（清晨出发登长城写成日出） | platform-general §十一 | 逐字（原文未点名客户） |
| S11.2 | §十一 1：运营细节先查官网当下页面 | platform-general §十一 | 逐字 |
| S11.3 | §十一 2：品牌简报只给方向，不是事实来源 | platform-general §十一 | 逐字 |
| S11.4 | §十一 3：四者打架永远以官网当下为准 | platform-general §十一 | 逐字 |
| S11.5 | §十一 4：发布前逐句标来源（官网可溯/内部文档可溯/未经证实） | platform-general §十一 | 逐字 |
| S12.1 | §十二 来源：图库搜索词命中≠内容属实 | platform-general §十二 | 逐字 |
| S12.2 | §十二 怎么用：核对来源自己的原始描述/元数据，找不到证据就标"未验证" | platform-general §十二 | 逐字 |
| S13.1 | §十三 来源与"这个授权是什么"：让 ME 代发 Reel/帖子；与广告账户授权独立 | platform-general §十三 | 去客户名（原文点名 NM Medspa 接入） |
| S13.2 | §十三 在哪操作：客户设置→平台连接→"重新授权 Meta 发布权限"；需有主页管理权限的人亲点 | platform-general §十三 | 逐字 |
| S13.3 | §十三 令牌寿命约 60 天，提前两周设日历提醒 | platform-general §十三 | 逐字（此处"令牌"指授权概念，不含任何令牌值） |
| S13.4 | §十三 令牌存储位置 platform_oauth_connections 及查连通 SQL | platform-general §十三 | 逐字（SQL 用占位符 <客户ID>） |
| S13.5 | §十三 主页 ID 的坑：URL 里的 id 与 Graph API 真实 ID 可能不同，用 /me?fields=id,name 确认 | platform-general §十三 + clients/nm-medspa.md §二 | 规则逐字；两处具体编号丢弃 |
| S13.6 | §十三 NM Medspa 实例：URL 里的 14 位编号 vs Graph API 真实 16 位编号（两个具体数字） | clients/nm-medspa.md §二 | **含页面编号，数字已丢弃**，只留"二者不同"的事实 |
| S13.7 | §十三 完整四步接入清单表 | platform-general §十三 | 逐字 |
| S13.8 | §十三 指向 playbook-ads-meta-general 第十条 | platform-general §十三 | 仅保留指针；被指向的广告手册不在迁移范围 |
| S14.1 | §十四 来源：封面文字三轮被打回，根因 shrink-to-fit | platform-general §十四；项目归属 clients/darui.md S14.1x | 去项目名，规则逐字 |
| S14.1x | §十四 来源的项目归属（大瑞，2026-09-23） | clients/darui.md §一 | 含客户名，拆出 |
| S14.2 | §十四 怎么用 1：按画布比例定死字号（15%~19%）允许换行 | platform-general §十四 | 逐字 |
| S14.3 | §十四 怎么用 2：中文粗体字重要实际加载字体查真实字重 | platform-general §十四 | 逐字 |
| S14.4 | §十四 怎么用 3：标题居中、卡在上三分之一，顶部对齐 | platform-general §十四 | 逐字 |
| S15.1 | §十五 来源：关注按钮全片只出现一次易被错过 | platform-general §十五 | 逐字 |
| S15.2 | §十五 怎么用：在时长正中再弹一次，完整弹入-停留-淡出窗口 | platform-general §十五 | 逐字 |
| S16.1 | §十六 来源：纯文字水印在真实素材上对比度靠运气 | platform-general §十六 | 逐字 |
| S16.2 | §十六 怎么用：账号水印一律加半透明/实色背景色块垫底 | platform-general §十六 | 逐字 |
| S17.1 | §十七 来源：按内容情绪分段配 BGM（2026-09-23） | platform-general §十七；项目归属 clients/darui.md S17.1x | 去项目名 |
| S17.1x | §十七 来源的项目归属（大瑞） | clients/darui.md §一 | 含客户名，拆出 |
| S17.2 | §十七 1：分段依据是情绪转折点，不是固定时间 | platform-general §十七 | 逐字 |
| S17.3 | §十七 2：切换用渲染引擎原生音频淡入淡出 | platform-general §十七 | 逐字 |
| S17.4 | §十七 3：音乐音量压低于人声（人声 100% 时 20%~25%） | platform-general §十七 | 逐字 |
| S18.1 | §十八 来源：别用平台"自动转写高亮"，会推翻已校对字幕 | platform-general §十八 | 逐字 |
| S18.2 | §十八 怎么用：保留自有字幕，仅对挑中句覆盖颜色/字号 | platform-general §十八 | 逐字 |
| S19.1 | §十九 来源：Whisper 把"AI 味很重"听成"ARWord"（2026-09-23） | platform-general §十九；项目归属 clients/darui.md S19.1x | 去项目名 |
| S19.1x | §十九 来源的项目归属（大瑞） | clients/darui.md §一 | 含客户名，拆出 |
| S19.2 | §十九 怎么用：上屏前人工通读转写稿，更正要标注"转写更正不是编内容" | platform-general §十九 | 逐字 |
| S20.1 | §二十 来源：收尾杂音被转写成孤立中文碎片（2026-09-23） | platform-general §二十；项目归属 clients/darui.md S20.1x | 去项目名 |
| S20.1x | §二十 来源的项目归属（大瑞） | clients/darui.md §一 | 含客户名，拆出 |
| S20.2 | §二十 怎么用：找到语义完整的最后一句，其后一律剪掉 | platform-general §二十 | 逐字 |
| S21.1 | §二十一 来源：Dropbox 连接器绑的是另一个账号，本机同步客户端才是真实账号 | platform-general §二十一；项目归属 clients/darui.md S21.1x | 归层待判（开发环境经验）；第二轮条前加「环境问题，非社媒规则」标注 |
| S21.1x | §二十一 来源的项目归属（大瑞） | clients/darui.md §一 | 含客户名，拆出 |
| S21.2 | §二十一 怎么用：复制进已分享文件夹等同步，找分享链接，用完删临时文件 | platform-general §二十一 | 逐字；同上 |
| S22.0 | §二十二 来源与前言（2026-10-06 两条 Reel 五轮；客户私有数字不在这里） | platform-general §二十二 | 去客户名 |
| S22.1a | §二十二 1：审核「字幕疑似内部标签冒充文案」是 AI 打分；先看送审整段字幕，itemLabel 重复是强信号 | platform-general §二十二 | 逐字；content-quality-guard.ts 核实仍在 |
| S22.1b | §二十二 1：换词方法：本机各打 3 次分对比；本机分≠线上分 | platform-general §二十二 | 逐字 |
| S22.1c | §二十二 1：换的词必须能从官网原话溯源；查「标签词+条目文字」重复 | platform-general §二十二 | 逐字 |
| S22.2 | §二十二 2：能改 props 就不改模板；beats 只有少数下标被用到；缺省行为必须不变 | platform-general §二十二 | 逐字；analyze-music.py 路径已核实并加注 |
| S22.3 | §二十二 3：「默认不变」要有证据（单测+新旧渲染 SSIM=1.000000+与出片机成片对比） | platform-general §二十二 | 逐字 |
| S22.4 | §二十二 4：两版拿不准让审查类 agent 判，要数字让他们给，不一致取更保守 | platform-general §二十二 | 逐字 |
| S22.5a | §二十二 5：面向中老年观众的字幕节奏（两位审查给的数，CTS 先用，同类客户可参考）全部数字 | clients/cts.md §五 | 按任务要求放客户层 |
| S22.5b | §二十二 5 末句：受众特性进客户 props，不进共享模板默认值 | platform-general §二十二 | 逐字；第二轮补「示例客户 = clients/cts.md」 |
| S22.6 | §二十二 6：出片机更新流程（detached 检出、先 fetch 再 checkout、launchctl kickstart、读日志、记回退办法） | platform-general §二十二 | 逐字；第二轮 launchctl 后加「有副作用，须有任务授权」 |
| S22.7 | §二十二 7：建单与取回成片自检（SQL 插入、花费上限 0.5、9 宫格、volumedetect） | platform-general §二十二 | 逐字；第二轮加「写生产库须已获授权」，「服务密钥」改注为「授权方式（原文写为服务密钥）」 |
| S22.8 | §二十二 8：素材来源核对（SHA-256 比对；Dropbox 素材 PM 已说多次有授权） | platform-general §二十二 | 逐字；第二轮加适用范围限定 |
| S22.9 | §二十二 9：工具小坑 | platform-general §二十二 | 逐字；第二轮加「待审」标注，原文保留 |
| S22.10 | §二十二 末：相关证据文件（审计文档 + 台账卡） | platform-general §二十二 | 两个文件均核实存在 |
| S23.0 | §二十三 来源与前言（2026-10-09 三轮重做，6 条必改） | platform-general §二十三 | 去客户名 |
| S23.1a | §二十三 1：地名字幕要硬证据（Unsplash location 字段/官网出处） | platform-general §二十三 | 逐字 |
| S23.1b | §二十三 1：画面里可识别文字（招牌/灯笼/路牌）＝硬否决证据 | platform-general §二十三 | 逐字 |
| S23.1c | §二十三 1：拿不到画面的站点用文字在正文里提 | platform-general §二十三 | 逐字 |
| S23.2 | §二十三 2：单复数要对着官网数一遍 | platform-general §二十三（例子改为通用说明「某旅游客户的一条团文案」）| 规则句逐字；例子拆到 S23.2x |
| S23.2x | §二十三 2 的原文例子：`ANCIENT WATER TOWNS` 写成复数、官网行程只有一个水乡古镇 | clients/cts.md §六 | 含客户行程文案，第二轮拆出 |
| S23.3a | §二十三 3：先量素材底部亮度（0.7/2.2）再判渐变还是取景 | platform-general §二十三 | 逐字 |
| S23.3b | §二十三 3：改取景不动共享渐变系数；改后 13.4/7.3 | platform-general §二十三 | 逐字 |
| S23.3c | §二十三 3：ffmpeg 量底部 15% 亮度的判据命令 | platform-general §二十三 | 逐字 |
| S23.4a | §二十三 4：一个符号不能有两个意思；买家会怀疑价格耍花样 | platform-general §二十三 | 规则逐字，具体字样拆出 |
| S23.4x | §二十三 4 的具体字样：+FLIGHTS vs SINGLE SUPPLEMENT +NZ$400 | clients/cts.md §六 | 含客户价格数字，拆出 |
| S23.4b | §二十三 4：推广到一般——钩子里的符号/缩写要对一遍片尾价格/条款区 | platform-general §二十三 | 逐字 |
| S23.5a | §二十三 5：「取更保守的」是兜底不是好理由；问清在优化哪两个指标、内容目的是什么；读完>完播 | platform-general §二十三 | 规则逐字，具体秒数拆出 |
| S23.5x | §二十三 5 的具体结果：4 秒 vs 7.8 秒，主张砍时长者复核时撤回 | clients/cts.md §六 | 含客户受众事实，拆出 |
| S23.5b | §二十三 5：被否决的建议里常裹着真问题（末段静止占 24% → 加极慢推镜） | platform-general §二十三 | 逐字 |
| S23.6a | §二十三 6：brief 里的已核实事实要和画面文字同颗粒度 | platform-general §二十三 | 逐字 |
| S23.6b | §二十三 6：审查意见里基于 PM 已拍板之事要当场顶回，转述前先过滤 | platform-general §二十三 | 逐字；第二轮加适用范围限定 |
| S23.7 | §二十三 配套做法：改动送回原审查 agent 复核，写清改前改后的数 | platform-general §二十三 | 逐字 |
| S-IND.1 | 文末「行业层现状说明」：目前没有跟行业绑定的独立方法论；旅游类样本是数据资产不是方法论结论 | industry-travel.md §三 | 逐字 |
| S-REL | 文末「关联」一行：feedback-viral-reel-recipe-over-montage、feedback-video-caption-short-big、project-me-video-two-line-strategy、project-social-video-i2v-muapi、reference-meta-reel-measurable-metrics-without-read-insights、reference-thruplay-video-creative-metrics、feedback-client-content-ground-in-website、feedback-search-hit-is-not-content-match、project-video-editing-style-buy-not-build、feedback-two-window-content-coordination、playbook-ads-meta-general | 留在记忆不迁 | 指针列表；其中前两条、feedback-client-content-ground-in-website/feedback-search-hit 内容已被 S3/S11/S12 等覆盖；其余不在本次指定迁移源 |
| S24.0 | §二十四 前言：四次失败四个不同的闸，一次只报一个 | platform-general §二十四 | 逐字 |
| S24.1 | §二十四 坑 1：出片机读 Application Support 下的 remotion-assets，不是 Dropbox；下单前 test -f | platform-general §二十四 | 规则逐字 |
| S24.1x | §二十四 坑 1 括号：Dropbox 98 个 vs 出片机 92 个，两个只在 Dropbox 的 nc2_* 片段名 | clients/cts.md §七 | 客户素材细节，拆出 |
| S24.2 | §二十四 坑 2：配乐暂存名＝曲库 id+扩展名，不许空格（SAFE_REL_PATH） | platform-general §二十四 | 逐字 |
| S24.3 | §二十四 坑 3：曲库 folder 分 _shared/music 与 Music，只有前者铺了暂存副本 | platform-general §二十四 | 逐字 |
| S24.4a | §二十四 坑 4：人声登记闸规则（按 sha256；present 拒；none+cleanUntilSec 要余量；none 无 cleanUntilSec 不限长） | platform-general §二十四 | 逐字；文件路径已核实并加注 |
| S24.4b | §二十四 坑 4：2026-10-25 现状快照（登记 9 条/6 条无人声/5 条 cleanUntilSec 仅 17–21 秒）；先查再排片长 | platform-general §二十四 | 逐字；标「快照可能已变」 |
| S24.4x | §二十四 坑 4：24 秒片子只有 founders-at-dawn（27 秒）能用，而 PM 说它雷同不要再用 | clients/cts.md §七 | 含曲名+PM 评价；归层待判 |
| S24.5a | §二十四 登记新曲 1：analyze-music.py 取 durationSec/bpmDetected/offsetSec/barPhase 写 music.json | platform-general §二十四 | 逐字 |
| S24.5b | §二十四 登记新曲 2：whisper 双模型转写当证据 | platform-general §二十四 | 逐字 |
| S24.5c | §二十四 登记新曲 3：music-vocals.json 加一条 sha256+verdict none+signedBy+evidence，不写 cleanUntilSec | platform-general §二十四 | 逐字 |
| S24.5d | §二十四 登记新曲 4：backfill-music-vocals.mjs 只读，不能给新曲登记 | platform-general §二十四 | 逐字 |
| S24.5e | §二十四 登记新曲 5：动安全闸配置，走审查再合 | platform-general §二十四 | 逐字 |
| S24.6 | §二十四 生成新 BGM 的要求：纯器乐一丝人声都不能有，≥40 秒 | platform-general §二十四 | 逐字 |
| S24.7 | §二十四 方法层：失败日志会原样打出绝对路径；一次只报一个闸 | platform-general §二十四 | 逐字 |

## B. feedback-viral-reel-recipe-over-montage.md（R；58 行）

| 编号 | 原文位置与要点 | 去向 | 备注 |
|---|---|---|---|
| R-FM | frontmatter（行 1-9） | 丢弃 | 记忆元数据，含会话编号 |
| R1.1 | 行 11：做 reel 前必须先查 viral_reference_library（606 条/250 旅游）并走 getViralStyleHint | platform-general §一 | 逐字；函数与文件已核实仍在 |
| R1.2 | 行 13 Why：2026-07-20 CTS 圣诞 reel，PM 连批"雷同/还有长城/歌不对"，make_promo 蒙太奇绕开 style-advisor | clients/cts.md §一 | 含客户事故 |
| R1.3 | 行 16 钩子数字：scenic_beauty 最差 3.8M；visual_shock 15.7M；ugc_selfie 12.4M 等 | industry-travel.md §一 | 旅游类样本数字，候选单客户证据 |
| R1.4 | 行 17 技法数字：text-overlay 67M / problem-solution 51M / fast-cut 29M / time-lapse 35M / drone 18M | industry-travel.md §一 | 同上 |
| R1.5 | 行 18 风格数字：humorous 59M / relatable 52M / ugc 31M / fast-paced 20M；要真实感 | industry-travel.md §一 | 同上 |
| R2.1 | 行 20-22 二次事故（2026-09-03）：同一客户同一圣诞团隔 6 周又踩一遍，摘要就在上下文里 | clients/cts.md §一 | 含客户事故 |
| R2.2 | 行 24 第一版 CTS reel：开场长城空镜+每帧压 logo+尾卡；PM 批"太平静/一堆照片的串联" | clients/cts.md §一 | 含客户事故 |
| R2.3 | 行 26 根因+数字：58 条旅游爆款镜长中位 2.14s、首切 2.83s、镜头数 14；ugc-selfie 16 次、drone 11 次、真实感 6.35/10 | industry-travel.md §一（通用根因在 S1.5） | 旅游样本数字 |
| R2.4 | 行 28："节奏抄满，内容形态一条没抄 = 卡得很准的幻灯片" | platform-general §一 | 逐字 |
| R2.5 | 行 30 加一条硬前置：动手前把本条与 i2v 记忆重读全文 | platform-general §一 | 逐字；被指向的 i2v 记忆未迁；第二轮加「完整记忆文件未迁入」标注 |
| R3.0 | 行 33 How 0：先重读本文全文+i2v 全文 | platform-general §一 | 逐字；同上 |
| R3.1 | 行 34 How 1：query 该行业 top-by-views，抽 opening_hook/key_techniques/style_tags | platform-general §一 | 逐字 |
| R3.1b | 行 35 How 1b：逐列自检，需换素材形态的列 | platform-general §一 | 逐字 |
| R3.2 | 行 36 How 2：frame-1 文字钩子→快切→problem-solution/listicle→弱化 logo/尾卡；音乐要卡点 | platform-general §一 | 逐字 |
| R3.3 | 行 37 How 3：AI 蒙太奇够不着的要素（真人出镜/好旁白/航拍/trending 原声）诚实标缺口 | platform-general §一 | 逐字 |
| R3.4 | 行 38 How 4：关联 reference-video-factory-backend 等 | platform-general §一 | 仅保留关联说明，指针记忆未迁 |
| R4.1 | 行 40-42 isRealFootage 并入说明：2026-07-13 隔壁 Oztop 窗口对齐，必须按 provenance | platform-general §五（去客户名）+ clients/oztop.md §二 | 拆分 |
| R4.2 | 行 44-48 踩坑现场：PR #576 用 scene_tag 后缀判；Oztop 26 条 a_real 全是 i2v 输出 | clients/oztop.md §二 | 含客户事故 |
| R4.3 | 行 50-52 共享契约 1：仅 isRealFootage=true 才准当产品/展厅承诺；stock/Pinterest/Pixabay/AI 一律 false | platform-general §五 | 逐字 |
| R4.4 | 行 53-55 共享契约 2：判据＝provenance，i2v_out/_px/_pb/pin-id＝非真实 | platform-general §五 | 逐字 |
| R4.5 | 行 56 存储：Supabase content-factory 唯一权威，Dropbox 单向灌入（PM 2026-07-12） | platform-general §五 | 逐字 |
| R4.6 | 行 58 How to apply：先查 source_meta.origin，real = provenance own | platform-general §五 | 逐字 |

## C. feedback-video-caption-short-big.md（C；52 行）

| 编号 | 原文位置与要点 | 去向 | 备注 |
|---|---|---|---|
| C-FM | frontmatter（行 1-8） | 丢弃 | 记忆元数据，含会话编号 |
| C1.1 | 行 10：广告成片屏幕字幕＝短句大字，一行≤6 词，绝不把长句当字幕 | platform-general §三 | 逐字 |
| C1.2 | 行 12 禁：core_proposition/角度全名/整句当屏幕字幕，会被 make_promo 压成小字 | platform-general §三 | 逐字 |
| C1.3 | 行 14 Why：2026-07-15 Oztop 草稿 Reel「中间字幕太小」，core_proposition 太长被压成小字 | clients/oztop.md §一 | 含客户事故 |
| C1.4 | 行 17 How 1：屏幕字幕一律短句，长句进 caption | platform-general §三 | 逐字 |
| C1.5 | 行 18 How 2：模板兜底不用整句 angle/core_proposition | platform-general §三 | 逐字 |
| C1.6 | 行 19 How 3：装配层加超长截断+最小字号 | platform-general §三 | 逐字 |
| C1.7 | 行 20 How 4：能不能一眼读完 | platform-general §三 | 逐字 |
| C1.8 | 行 22 相关：字幕价值取决于文案质量的延伸，要短到能看清 | platform-general §三 | 逐字（链接记忆名略） |
| C2.1 | 行 25 Meta Reel 安全区：关键内容必须落在 y=270~1248 | platform-general §二 | 逐字 |
| C2.2 | 行 26 顶部死区 0~270（状态栏/返回箭头/搜索/三点菜单） | platform-general §二 | 逐字 |
| C2.3 | 行 27-28 底部死区 1248~1920（672px）：caption/互动栏/View insights/评论输入框/home indicator | platform-general §二 | 逐字 |
| C2.3b | 行 29 右侧栏约 120px | platform-general §二 | 逐字 |
| C2.5 | 行 31-32 事故：2026-06-24 CTS spot-the-lie 拼图（PR #78→#80/#81）横幅 y=0~220、CTA y=1720~1920 被 FB UI 全遮 | clients/cts.md §三 | 含客户事故 |
| C2.6.1 | 行 35-36 每次做 Reel 1：安全带 y270~1248（978×1080） | platform-general §二 | 逐字 |
| C2.6.2 | 行 37 2：关键文字水平居中，中间 840px | platform-general §二 | 逐字 |
| C2.6.3 | 行 38 3：别把 CTA 放进画面 | platform-general §二 | 逐字 |
| C2.6.4 | 行 39 4：标题+副标题放安全带顶部，留约 150–180px | platform-general §二 | 逐字 |
| C2.6.5 | 行 40 5：面板网格填剩下的（2×3 约 800px，每格约 258×510） | platform-general §二 | 逐字 |
| C2.6.6 | 行 41 6：字母角标+短说明做进面板图本身 | platform-general §二 | 逐字 |
| C2.6.7 | 行 42 7：导出前叠 y=270/y=1248 参考线自检 | platform-general §二 | 逐字 |
| C2.7 | 行 44 IG Reels 同规则；Stories 底部约 250px，拿不准按 Reels | platform-general §二 | 逐字 |
| C3.1 | 行 46-47 并入说明与事故：2026-09-21 NM Medspa Reel 小样文字全压死区（标语 y=83%、CTA y=90%、品牌名 y=5%） | clients/nm-medspa.md §一 | 含客户事故 |
| C3.2 | 行 48 叠字清单 1：每个 text element 的 y 在 270～1248（14%～65%） | platform-general §二 | 逐字 |
| C3.3 | 行 49 2：CTA 不放进画面 | platform-general §二 | 逐字 |
| C3.4 | 行 50 3：右侧约 120px 互动栏，居中不贴右 | platform-general §二 | 逐字 |
| C3.5 | 行 51 4：vmin 换算（86-108px / 32-43px） | platform-general §二 | 逐字 |
| C3.6 | 行 52 5：渲小样后先自己逐帧看一遍再发 PM | platform-general §二 | 逐字 |

## D. feedback-first-frame-must-differ-and-worth-posting.md（F；23 行）

| 编号 | 原文位置与要点 | 去向 | 备注 |
|---|---|---|---|
| F-FM | frontmatter（行 1-9） | 丢弃 | 记忆元数据，含会话编号 |
| F0 | 行 11 前言：PM 2026-10-13 看完 CTS Story 预览页后的三条纠正 | clients/cts.md §九 | 含客户事故 |
| F1 | 行 13 第一帧必须不一样（Reel 封面和每条 Story；同版式只换一行字也算撞脸，纯文字卡原则上不做） | platform-general §二十六 | 逐字 |
| F2 | 行 14 事实没错不等于值得发（清单式文字卡过了事实和画面审查 PM 仍不接受） | platform-general §二十六 | 规则逐字，例子拆出 |
| F2x | 行 14 具体例子「13 meals included / 22 meals included」 | clients/cts.md §九 | 含客户行程事实，拆出 |
| F3 | 行 15 组合计划的家是「每日计划」，当时排期散在 markdown 周包/Story 表页/视频工厂三处 | platform-general §二十六 | 逐字 |
| F4 | 行 17 Why：账号要像真人在运营；PM 要在一个地方看和批；"又一次建之前没查平台" | platform-general §二十六 | 逐字（链接记忆名略） |
| F5 | 行 19 How to apply：每周拼总览图判首帧相似度；发前加「真人运营的账号会不会发这条」；先看 daily-plan.ts；"这是平台层规则，不只 CTS" | platform-general §二十六 | 逐字；daily-plan.ts 已核实仍在 |

## E. feedback-cts-feed-repetitive-bgm-price-screen-mix-2026-10-15.md（B；约 15 行）

| 编号 | 原文位置与要点 | 去向 | 备注 |
|---|---|---|---|
| B-FM | frontmatter（行 1-9） | 丢弃 | 记忆元数据，含会话编号 |
| B1 | 行 11 PM 10-15：CTS 主页视频同一首 BGM、清一色 Remotion 价格屏，刷新很重复 | clients/cts.md §八 | 含客户观察 |
| B2 | 行 13 Why：内容单一显得像硬广，影响主页观感 | clients/cts.md §八 | 含客户观察 |
| B3 | 行 14 How（BGM 部分）：相邻不同曲、7 天最多复用一次 | clients/cts.md §八 | 归层待判（不依赖行业，可能上提平台层）；第二轮：B3、B4 同出一句 PM 原话，同放本文件 |
| B4 | 行 14 How（内容配比部分）：连续 4 条里清单/价格卡至多 1 条，其余景点氛围/行程故事/贴士/图文/Story | **clients/cts.md §八**（第二轮由行业层移入）；industry-travel.md §二只留指针 | 候选，单客户证据；去向变化：industry-travel → clients/cts.md |
| B5 | 行 14 末：交 97 号做放行规则，106 管曲库与模板；相关记忆（中老年字幕放慢、P0 优先级） | clients/cts.md §八 | 相关记忆名未迁 |

## F. reference-video-first-frame-cover-chrome-facts-2026-10-27.md（V；约 23 行）

| 编号 | 原文位置与要点 | 去向 | 备注 |
|---|---|---|---|
| V-FM | frontmatter（行 1-9） | 丢弃 | 记忆元数据，含会话编号 |
| V1 | 行 11 事实（CTS 30 条工厂视频）：公开桶 content-factory，路径 renders/…/final.mp4，17~47MB，1080×1920，≈19 秒，≈18Mbps，faststart，支持 Range，cache-control private,no-cache | platform-general §二十五 | 逐字（去客户名，是基础设施事实） |
| V2 | 行 13 直接放 video 标签很费流量：15 条整页实测 95MB；第 0 帧约 0.5MB，#t=1 约 4.5MB，取第 0 帧 | platform-general §二十五 | 逐字 |
| V3 | 行 15 正确做法（PR 3252，useFirstFrameStill）：页面外创建 video→快滚到眼前才开始→rVFC 等真帧再 drawImage→停下载；15 条约 10.8MB | platform-general §二十五 | 逐字；PR 3252 与函数已核实 |
| V4.1 | 行 17 加固 ①：最多 6 个同时加载，其余排队；24 条压测 10 次全成功（约 15MB） | platform-general §二十五 | 逐字 |
| V4.2 | 行 17 加固 ②：rVFC 要在设 src 之前登记 | platform-general §二十五 | 逐字 |
| V4.3 | 行 17 加固 ③：10 秒放弃计时；无 rVFC 就不开始下载 | platform-general §二十五 | 逐字 |
| V4.4 | 行 17 加固 ④：队列在一批卸载全部完成之后（微任务）才启动 | platform-general §二十五 | 逐字 |
| V4.5 | 行 17 加固 ⑤：压测脚本要多轮并记录每行状态，单次全绿不算数 | platform-general §二十五 | 逐字 |
| V5.1 | 行 19 本机验 ①：headless-shell 解不了 H.264，用真 Chrome 无界面 | platform-general §二十五 | 逐字 |
| V5.2 | 行 19 ②：下载量用 CDP Network.dataReceived 累加 | platform-general §二十五 | 逐字 |
| V5.3 | 行 19 ③：跨域视频画到 canvas 后画布被污染，读不了像素 | platform-general §二十五 | 逐字 |
| V5.4 | 行 19 ④：jsdom 没有 canvas/媒体/rVFC，要替身（cover-stubs.ts） | platform-general §二十五 | 逐字；文件已核实 |
| V5.5 | 行 19 ⑤：vitest afterEach 后定义先跑，cleanup() 在还原替身之前 | platform-general §二十五 | 逐字 |
| V6 | 行 21 更省的路（没做）：工厂出片时顺手存封面小图 | platform-general §二十五 | 逐字 |
| V-REL | 行 23 相关：project-social-daily-three-tabs-ui-redesign-2026-10-27、reference-local-before-after-preview-harness-2026-10-27 | 留在记忆不迁 | 指针，非社媒规则本体 |

## 待判清单（拿不准归层，已按「拿不准放客户层 / 在正文标注」处理）

- S1.1–S1.3：定性配方样本是否限于旅游类——放平台层并在正文标注「待判」；具体数字（R1.3–R1.5、R2.3）放行业层。
- S10.4、S10.5：Story 实测的权限事实与 74 号当时的决定——放客户层 CTS，待判（权限事实可能是平台通用）。
- S10.6：逐像素核对「发出去的＝批准的」的通用方法——原文写在 CTS 实测段里，放平台层，待判。
- S21.1、S21.2：Dropbox 连接器与本机客户端的环境经验——偏开发环境而非社媒内容规则，放平台层，待判。
- S24.4x：24 秒片子只有一首曲子可用且 PM 评价「雷同」——放客户层 CTS，待判。
- B3：BGM「相邻不同曲、7 天最多复用一次」——不依赖行业，放客户层 CTS，待判（可能上提平台层）。
- B4：连续 4 条里价格卡至多 1 条的内容配比——第二轮改放 clients/cts.md（与 B3 同出一句 PM 原话），行业层只留指针。
- S22.5a：中老年字幕节奏数字——按任务要求放客户层 CTS；原文写「同类客户可参考」，是否上提行业层待判。
- S11.1：官网为准的例子（清晨出发登长城）——来自旅游客户但原文未点名，留平台层。
- S23.2：「ANCIENT WATER TOWNS」复数例子——第二轮移到 clients/cts.md（S23.2x），平台层改为通用说明。

## 迁移时核实过期项（只加标注，未删改规则）

- `tools/analyze-music.py`、`music-vocal-gate.mjs`、`catalog/music*.json`：原文写相对路径；仓库内实际位于 `scripts/factory-worker/` 下，已在 S22.2、S24.4a 加「路径核实」标注。不是过期，规则不变。
- PR 3252 / `useFirstFrameStill` / `cover-stubs.ts`：均核实仍在，标注「核实」。
- `viral-style-advisor.ts` 的 `getViralStyleHint`、`daily-plan.ts`、`content-quality-guard.ts`、证据文档与台账卡（S22.10）：均核实存在。
- 「606 条/250 旅游类」「发布层当时只有 Post 接了线」等数字/状态是原文写作日的快照，现值未核，已在正文标注。
- 原手册没有提及 Publer；`docs/agents/14-sudongpo.md` 里的 Publer 过期内容不在本次迁移范围。
- `docs/playbooks` 目录此前不存在（14-sudongpo.md 引用的是空目录）：本次迁移建立。
