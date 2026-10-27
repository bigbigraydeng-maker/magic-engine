# 社媒六平台内容规格表（平台层 · 整合稿）

> **负责人**：苏东坡（`sudongpo`）（维护人，无改正文权；升进正文须子牙签字+PM 合并）· [苏东坡档案](../../agents/14-sudongpo.md)
> **范围**：Facebook、Instagram、Threads、TikTok、YouTube（Shorts）、X 六个平台的内容形态、画幅/时长/文件大小/字数、标签与话题、首评/CTA、发布时间、禁忌/政策、ME 现状。**只收有出处的事实，没有来源的格子一律写「待核」**
> **状态**：整合稿，待三视角审查与 PM 回「合」（不新增规则、不改含义）
> **日期**：2026-10-28
> **最后核实**：2026-10-28（外部事实读取日期见各条与文末 URL 表；仓库引用对照 origin/main `fe6f3f566`）
> **风险**：A 级（经验手册正文，改正文须 PM 回「合」）；纯文档
> **代码依据**：只引用既有代码与文档，不改代码；引用格式 `文件:行号`

## 0. 读法与事实来源规则

- **三类来源，每格必居其一**：①仓库内已成文（写 `文件:行号`；手册条目写〔S/R/C/F/V 编号〕）；②**平台官方帮助页/开发者文档**，标 `[U编号]`，URL 与读取日期 2026-10-28 见文末「URL 表」；③读不到/页面没写/来源不明 = **待核**。**不使用第三方博客，不凭记忆填数字。**
- **外部事实使用前须复核**：所有 `[U]` 标注的事实都是「外部事实，读取于 2026-10-28，使用前须复核」。读取方式是网页抽取工具对官方页面的摘要，不是人工逐字核对原文；平台文档会改版。
- **读不到的页面**也列在文末，不当作「没有限制」。页面没写某项，只记「该页未说明」并列入待核清单，不等于平台没有限制。
- **发布时间**：设计稿规定是**客户配置项**，不写进平台层默认值（`docs/specs/2026-10-13-social-daily-agent-design.md:184`）；各平台通用最佳时间无可核来源，一律待核。
- 「ME 现状」只写仓库里能查到的接入状态；能力矩阵的完整版在能力地图设计稿 §5.5（`docs/specs/2026-10-19-social-agent-capability-map-v0.3.md`，PR 2906，截至 `fe6f3f566` **未合并**，其状态为 2026-10-19 快照）。Codex 连接线 PR 状态（2026-10-28 用 `gh pr view` 核对）：2895（Meta 授权回调身份绑定）已合并 2026-10-19；2897（Instagram 仅身份接入）已合并 2026-10-19；2905（客户自助连接已验证 YouTube 频道）已合并 2026-10-19。
- 竖版安全区（1080×1920，关键内容落在 y=270~1248，右侧约 120px 留给互动栏）适用于 Facebook、Instagram、TikTok、YouTube Shorts 的竖版视频与静图创意，出处〔S2.2〕〔S2.3〕〔S2.4〕〔C2.1〕，详见 [creative-spec.md](./creative-spec.md) CS3.4；Threads、X 以文字为主，不适用。

---

## 1. Facebook

| 维度 | 内容 | 来源 |
|---|---|---|
| 内容形态 | Reel；图文 Post；Story（9:16 图片） | `docs/specs/2026-10-19-social-agent-capability-map-v0.3.md` §4.2（未合并）；`src/lib/social/social-plan-templates.ts:174` |
| Reel 画幅/分辨率 | 9:16；推荐 1080×1920，最小 540×960；mp4（推荐） | 外部事实 [U1] |
| Reel 时长 | 3–90 秒；以 Page 故事形式发布的 Reel 不能超过 60 秒 | 外部事实 [U1]；ME 自动检查线同为 3–90 秒：`src/lib/social/reel-media-checks.ts:44-52` |
| Reel 帧率/编码/音频 | 24–60 fps（需固定帧率）；H.264 或 H.265（也支持 VP9、AV1）；AAC-LC、48kHz、立体声、128kbps 以上 | 外部事实 [U1] |
| Reel 文件大小 | 该页未说明 | 待核 |
| Reel 文案长度 | 该页未说明（`description` 字段支持话题标签，另有 `title` 字段） | 待核（长度）；[U1]（字段） |
| 图文 Post 画幅 | ME 只用 `1:1` 与 `4:5` | `src/lib/social/social-plan-templates.ts:174`（ME 内部规格，非平台官方） |
| 图文 Post 文案长度 | 该页未说明 | 待核 [U9] |
| 发帖频率上限 | API 发布 30 条 / 24 小时滚动；每页每 24 小时最多 10 个合作者邀请 | 外部事实 [U1] |
| 定时发布 | `scheduled_publish_time` 须在请求时间之后 10 分钟到 30 天之间；ME 代码已用该字段 | 外部事实 [U9]；`src/lib/meta/page-posts.ts:491` |
| 标签/话题 | Reel 的 `description` 支持话题标签；个数上限、位置、是否影响分发 | 待核 |
| 首评/CTA | 链接放首评不放正文，首评链接带追踪参数；原因是「自然 Reel 正文链接不可点击、带链接正文被压低触达」——这是手册里的踩坑经验，**未经官方文档核实** | 〔S8.1〕〔S8.3〕〔S8.4〕；官方核实：待核 |
| 发布时间规律 | 客户配置项；平台通用规律 | `docs/specs/2026-10-13-social-daily-agent-design.md:184`；通用规律：待核 |
| 禁忌/政策 | 平台社区规范、广告政策、对 Page 内容的限制：未读；ME 自有禁忌：价格不得编、画面不出现编造的承诺、AI/虚拟角色须披露 | 平台政策：待核；ME：〔S5.2〕、CS7.7、`docs/skill-cards/ME-SOCIAL-RULES-DIGEST.md`（SO-04） |
| **ME 现状** | **Reel：能发**（视频工厂成片，PM 授权后发布；转公开靠人手）；**Story（图片）：小量能发**；**图文 Post：代码在，从未真发（能力地图 2026-10-19 快照，之后是否变化未核）**；首评：能写（含幂等）；读评论：能；自动回复评论：冻结；定时：代码在。**谁在做**：Codex 连接线 PR 2895 已合并（授权回调绑定身份与主页）。 | 能力地图 §5.5（2026-10-19 快照，未合并）；`src/lib/meta/first-comment.ts:3-8`；`src/lib/platform-oauth/social-onboarding.ts:111`；`docs/sops/2026-10-27-video-factory-template-playbook-v1.0.md:72` |

## 2. Instagram

| 维度 | 内容 | 来源 |
|---|---|---|
| 内容形态 | Reels；Stories；单图；视频；轮播（API 支持的 `media_type`：图片、视频、REELS、STORIES、CAROUSEL） | 外部事实 [U2] |
| Reels 画幅/时长/文件大小/编码 | 该页未说明（只说用 `media_type=REELS` 与 `video_url` 建容器）；另试读帮助中心 Reels 页，抽取结果为空 | 待核 |
| 图片 | API 仅支持 JPEG（MPO、JPS 不支持）；尺寸与画幅（单图）该页未说明 | 外部事实 [U2]；画幅：待核 |
| 轮播 | 最多 20 项（图片、视频或混合）；图片按第一张的画幅裁切，默认 1:1 | 外部事实 [U2] |
| 媒体来源 | 发布时媒体须在公开可访问的服务器上；支持大视频的可续传上传；不支持购物标签与滤镜 | 外部事实 [U2] |
| 文案长度 | 该页未说明 | 待核 [U2] |
| 发帖频率上限 | **该页前后矛盾**：限流小节写「100 条 API 发布 / 24 小时滚动」，轮播小节写「50 条 / 24 小时」；以哪个为准须复核 | 外部事实 [U2]（矛盾待核） |
| 标签/话题 | 个数上限、位置、是否影响分发 | 待核（该页未说明） |
| 首评/CTA | ME 设计稿判断「正文链接不可点」，首评能力第一期不做；官方是否支持 API 写首评：未核 | `docs/specs/2026-10-20-instagram-native-publish.md:77`（ME 设计判断）；官方：待核 |
| 发布时间规律 | 客户配置项；通用规律 | 同上；通用规律：待核 |
| 禁忌/政策 | 平台社区规范与内容政策：未读 | 待核 |
| 安全区 | Reels 同 Facebook 规格；Stories 底部死区约 250px，拿不准按 Reels 做 | 〔S2.8〕〔C2.7〕 |
| **ME 现状** | **只有账号身份连接**（只请求 `instagram_business_basic`，不请求发布权限，不宣称能自动发布）；**发布：不能发**（原生发布设计稿 v3 为设计阶段、未写代码；`src/lib/instagram-publish/` 目录下仅有 `token.ts`）；Story 的 Graph 层函数存在，调用方与授权未验。**谁在做**：Codex 连接线 PR 2897（仅身份）已合并；发布设计稿由 Claude Code 会话起草，待复审。 | `docs/specs/2026-10-19-social-channel-onboarding.md:7`；`docs/specs/2026-10-20-instagram-native-publish.md:3`；`ls src/lib/instagram-publish`（2026-10-28）；能力地图 §5.5 |

## 3. Threads

| 维度 | 内容 | 来源 |
|---|---|---|
| 内容形态 | 文字、图片、视频（单帖）；轮播（图片/视频）；仅文字帖可附 GIF（GIPHY 为唯一来源） | 外部事实 [U4] |
| 文字长度 | 文字帖上限 500 个字符（emoji 按 UTF-8 字节计） | 外部事实 [U4] |
| 图片 | JPEG、PNG；≤8 MB；画幅上限 10:1；宽度 320–1440（会缩放到范围内）；sRGB | 外部事实 [U4] |
| 视频 | MOV 或 MP4（无 edit list、moov 在前）；HEVC 或 H.264；帧率 23–60；最大宽度 1920；画幅 0.01:1 至 10:1（文档推荐 9:16）；音频 AAC；时长大于 0 且不超过 300 秒；文件 ≤1 GB；视频码率 VBR ≤100 Mbps | 外部事实 [U4] |
| 轮播 | 2–20 项；整个轮播算 1 条发帖额度 | 外部事实 [U4] |
| 发帖频率上限 | 每个账号 24 小时内 250 条；其它具体请求限流：该页未说明 | 外部事实 [U4]；其它：待核 |
| 链接 | `link_attachment` 仅限文字帖，≤5 个链接（2025-12-22 起超过会在建媒体时失败，错误码 `THREADS_API__LINK_LIMIT_EXCEEDED`）；未设 `link_attachment` 时，文字帖里的第一个链接会成为附件 | 外部事实 [U4] |
| 标签/话题 | 用 `topic_tag` 参数：1–50 字符，不可含句点和 & 符号；正文内以 # 开头的标签只取第一个有效的，文档称「不推荐」，为向后兼容保留 | 外部事实 [U4] |
| 首评/CTA | 是否支持 API 写首评/回复作为 CTA：未核 | 待核 |
| 发布时间规律 | 客户配置项；通用规律 | 同上；通用规律：待核 |
| 禁忌/政策 | 平台社区规范与内容政策：未读 | 待核 |
| **ME 现状** | **全部不能做**：状态投影里 Threads 标 `not_available`，仓库内未找到原生连接与发布实现；数据回看流程只有候选学习卡。**谁在做**：Codex 连接线已把 Threads/X 列为「技术缺口」单列，未开工。 | `src/lib/platform-oauth/social-onboarding.ts:155`；`docs/specs/2026-10-19-social-channel-onboarding.md`（「Threads / X」行）；`docs/skill-cards/2026-10-19-social-threads-insights.md`（候选） |

## 4. TikTok

| 维度 | 内容 | 来源 |
|---|---|---|
| 内容形态 | 竖版视频直发（ME 现有实现）；图文/照片帖：官方有独立「Photo」接口，规格本稿未读 | ME：能力地图 §4.2；照片帖：待核 |
| 视频格式 | MP4 优先，WebM、MOV 也接受；H.264 优先，H.265、VP8、VP9 也接受 | 外部事实 [U3] |
| 帧率/分辨率 | 23–60 fps；高、宽各 360–4096 像素 | 外部事实 [U3] |
| 时长 | 开发者通过「上传视频」初始化接口最长可发 10 分钟；创作者可在 App 内裁剪；**账号当前可发的最长时长由 creator_info 的 `max_video_post_duration_sec` 返回，是账号级、不是固定值**，ME 发布前据此拦截 | 外部事实 [U3]；`src/lib/tiktok/post-review.ts:40` |
| 文件大小 | 最大 4 GB；分块：每块 5–64 MB（最后一块可到 128 MB）；小于 5 MB 整传；大于 64 MB 必须分块；1–1000 块，顺序上传。ME 用 10 MB 块 | 外部事实 [U3]；`src/lib/factory/publish/tiktok-adapter.ts:18-19` |
| 画幅 | 该页未说明（ME 一律出 9:16） | 待核 |
| 文案长度 | 标题/文案最长 2200（UTF-16 字符单位）；可不填；ME 发布审核也按 ≤2200 拦截 | 外部事实 [U7]；`src/lib/tiktok/post-review.ts:39` |
| 隐私选项 | `PUBLIC_TO_EVERYONE`、`MUTUAL_FOLLOW_FRIENDS`、`FOLLOWER_OF_CREATOR`、`SELF_ONLY`，取值必须在该账号 `privacy_level_options` 内 | 外部事实 [U7] |
| 未过审应用 | 「未审核客户端发布的内容一律限制为私密查看」；对非私密账号会在初始化时被拦 | 外部事实 [U7] |
| 请求频率 | 每个用户令牌每分钟 6 次请求；每日发帖上限数字该页未给 | 外部事实 [U7]；每日上限：待核 |
| 标签/话题 | 个数上限、位置、是否影响分发 | 待核 |
| 首评/CTA | 是否支持 API 写首评：未核；ME 现有发布审核要求勾选音乐使用条款和确认发布内容，品牌合作内容不能用「仅自己可见」 | 待核；`src/lib/tiktok/post-review.ts:38,42` |
| 发布时间规律 | 客户配置项；通用规律 | 同上；通用规律：待核 |
| 禁忌/政策 | 平台社区规范、商业内容披露规则：未读 | 待核 |
| **ME 现状** | **能做（受限）**：授权连接、令牌刷新、直发代码都在，发布审核页要人确认；**应用未过审时发出的内容只自己可见**（设计稿记录 TikTok 主应用审核中，**当前是否已过审未核**）；效果读取只有主页抓取；回执落哪张表未验证；TikTok 账号治理（防同一账号挂两个客户）在设计稿阶段。**谁在做**：Codex 连接线（授权状态展示已做，应用审核是平台侧门槛）。 | `docs/specs/2026-10-19-social-channel-onboarding.md`（TikTok 行与 OAuth 现场条件段）；`docs/specs/2026-10-20-social-connection-governance.md`；能力地图 §5.5 |

## 5. YouTube（Shorts）

| 维度 | 内容 | 来源 |
|---|---|---|
| 内容形态 | Shorts（竖版短视频）；长视频 | 外部事实 [U5]；`docs/sops/2026-10-27-video-factory-template-playbook-v1.0.md:112-113` |
| 时长 | Shorts 最长 3 分钟 | 外部事实 [U5] |
| 画幅 | 该页只说可上传竖版视频，未给比例；ME 要求 Shorts 缩略图为 9:16（ME 自有公开闸） | 待核（官方比例）；`src/lib/youtube-publish/gates.ts:8` |
| 分辨率 | 上传最大分辨率 1080p（该页对 Shorts 的描述） | 外部事实 [U5] |
| 文件大小/格式（API） | 上传接口最大 256GB；MIME 为 `video/*` 与 `application/octet-stream` | 外部事实 [U10] |
| 标题 | 最长 100 字符 | 外部事实 [U5] |
| 描述 | 长度：两页都未说明 | 待核 [U5][U10] |
| 观看数口径 | 自 2025-03-31 起，Shorts 每次开始播放或重播都算一次观看，无最短观看时长；原口径更名为「Engaged views」 | 外部事实 [U5] |
| 面向儿童 | 发布时必须选「是/否面向儿童」；13–17 岁创作者默认私密，18 岁以上默认公开 | 外部事实 [U5] |
| API 上传额度 | 一次上传在 Video Uploads 配额桶里计 1 单位；页内另写「100 calls per day」的影响说明 | 外部事实 [U10]（原文并存，含义待核） |
| 未验证 API 项目 | 该页写「未验证 API 项目上传的视频不限制为私密」；隐私字段不填则默认公开 | 外部事实 [U10]（与 ME 自设的「先私享暂存」是两件事，见 ME 现状） |
| 标签/话题 | 个数、位置、对 Shorts 分发的影响 | 待核 |
| 首评/CTA | 是否支持 API 写置顶评论：未核；ME 的 YouTube 公开闸要求标题与画面相符、事实有官网证据 | 待核；`src/lib/youtube-publish/gates.ts:9,14` |
| 发布时间规律 | 客户配置项；通用规律 | 同上；通用规律：待核 |
| 禁忌/政策 | 音乐资格（Shorts music eligibility）、版权规则：该页只给了链接未展开；超过 1 分钟慎用有版权的曲子是模板手册的说法，来源标为官方说明但**本稿未核** | 待核；`docs/sops/2026-10-27-video-factory-template-playbook-v1.0.md:112,117` |
| **ME 现状** | **能做（受限）**：已批准成片可私密上传并回读回执，公开前七道服务器闸全 pass 才可公开；**未获「无审核直接公开」授权**；ME 回执在能力地图记录时为 0 行；分析读取无权限。**谁在做**：Codex 连接线 PR 2905（客户自助连接已验证频道）已合并，授权仍由内部管理员执行。 | `docs/sops/2026-10-27-video-factory-template-playbook-v1.0.md:179`；`src/lib/youtube-publish/gates.ts:7-15`；`docs/specs/2026-10-19-social-channel-onboarding.md`（YouTube 行）；能力地图 §5.5 |

## 6. X

| 维度 | 内容 | 来源 |
|---|---|---|
| 内容形态 | 帖子（文字 + 媒体）；每帖最多 4 张照片，或 1 个动图 GIF，或 1 个视频（三者互斥）；投票 | 外部事实 [U6][U8] |
| 文字长度 | 该页未说明 | 待核 [U6] |
| 图片 | ≤5 MB；JPG、PNG、GIF、WEBP；画幅与分辨率该页未说明 | 外部事实 [U8]；画幅/分辨率：待核 |
| 动图 GIF | ≤15 MB | 外部事实 [U8] |
| 视频 | 普通账号：≤20 分钟、≤8 GB；X Premium/认证账号：≤125 分钟、≤16 GB；最短 0.5 秒；超时长返回 403「This user is not allowed to post a video longer than N minutes」 | 外部事实 [U6][U8] |
| 视频编码/分辨率/画幅/帧率 | 页面指向「最佳实践」页，未读到 | 待核 |
| 请求频率 | 该页未说明 | 待核 |
| 其它限制 | 自助档每帖最多 1 个 cashtag；回复仅限原作者 @ 了你的账号或引用了你的帖子 | 外部事实 [U6] |
| 标签/话题 | 个数、位置、对分发的影响 | 待核 |
| 首评/CTA | 是否支持 API 写自回复串作为 CTA：未核 | 待核 |
| 发布时间规律 | 客户配置项；通用规律 | 同上；通用规律：待核 |
| 禁忌/政策 | 平台规则与自动化账号政策：未读 | 待核 |
| **ME 现状** | **全部不能做**：状态投影标 `not_available`，仓库内未找到原生连接与发布实现。**谁在做**：Codex 连接线列为技术缺口，未开工。 | `src/lib/platform-oauth/social-onboarding.ts:155`；`docs/specs/2026-10-19-social-channel-onboarding.md`（「Threads / X」行） |

---

## 7. ME 对所有平台通用的发布前自动检查（现状）

| 项 | 内容 | 来源 |
|---|---|---|
| Reel 机器体检 | 有音轨且综合响度高于 −55 LUFS；9:16、不低于 540×960、3–90 秒；字幕条目有序非空；封面非空白 | `src/lib/social/reel-media-checks.ts:34-67` |
| Reel 审核清单 | 共 18 键（机器判 + 人工判），含安全区、字幕短大、logo、BGM、首评链接带追踪参数 | `src/lib/social/content-review.ts:1-20` |
| 成片体积 | 上传前拒绝超过 48MB 的成片（存储上限 50MB） | `docs/sops/2026-10-27-video-factory-template-playbook-v1.0.md:58` |
| 比例 | 视频成片体检强制 1080×1920，视频只出 9:16；4:5/1:1 多比例导出没有 | `docs/sops/2026-10-27-video-factory-template-playbook-v1.0.md:64` |

## 8. 待核清单（本表所有「待核」，按平台）

| 平台 | 待核项 |
|---|---|
| Facebook | Reel 文件大小；Reel 与图文的文案长度上限；话题标签个数/位置/分发影响；「自然 Reel 正文链接不可点击、被压低触达」的官方依据；通用最佳发布时间；社区规范/政策 |
| Instagram | Reels 时长/文件大小/画幅/编码；单图画幅；文案长度；话题标签规则；每日发布上限 100 与 50 的矛盾；API 是否支持写首评；通用最佳发布时间；社区规范/政策 |
| Threads | API 是否支持写首评/回复串；通用最佳发布时间；社区规范/政策 |
| TikTok | 画幅要求；照片帖规格；每日发帖上限；话题标签规则；API 是否支持首评；通用最佳发布时间；社区规范/商业内容披露；ME 应用当前是否已过审 |
| YouTube | Shorts 官方画幅；描述长度上限；话题标签规则；API 是否支持置顶评论；Shorts 音乐资格与版权规则；「100 calls per day」的含义；通用最佳发布时间 |
| X | 文字长度上限；图片画幅/分辨率；视频编码/分辨率/画幅/帧率；请求频率；话题标签规则；API 自回复串作 CTA；平台规则与自动化账号政策；通用最佳发布时间 |

## 9. URL 表（外部事实出处）

读取日期统一为 **2026-10-28**。**外部事实，读取于该日，使用前须复核。**

| 编号 | URL | 用于 |
|---|---|---|
| U1 | https://developers.facebook.com/docs/video-api/guides/reels-publishing | Facebook Reel 规格与限流 |
| U2 | https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing | Instagram 发布形态、图片、轮播、限流 |
| U3 | https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide | TikTok 视频格式、分块、大小、时长 |
| U4 | https://developers.facebook.com/docs/threads/posts | Threads 字数、图片、视频、轮播、链接、话题标签、限流 |
| U5 | https://support.google.com/youtube/answer/10059070 | YouTube Shorts 时长、标题、观看口径、面向儿童 |
| U6 | https://docs.x.com/x-api/posts/manage-tweets/introduction | X 帖子媒体附件与视频时长 |
| U7 | https://developers.tiktok.com/doc/content-posting-api-reference-direct-post | TikTok 文案长度、隐私选项、未过审限制、请求频率 |
| U8 | https://docs.x.com/x-api/media/introduction | X 图片/GIF/视频大小与时长 |
| U9 | https://developers.facebook.com/docs/pages-api/posts | Facebook Page 图文发布与定时发布 |
| U10 | https://developers.google.com/youtube/v3/docs/videos/insert | YouTube 上传接口配额、大小、隐私默认 |

**尝试读取但没读到（不当作「无限制」）**：`https://docs.x.com/x-api/media/media-upload`（404）；Instagram 帮助中心 Reels 页（`help.instagram.com/<长数字编号>`，编号已省略；抽取结果为空）；Facebook 商业帮助中心视频页（`facebook.com/business/help/<长数字编号>`，编号已省略；404）；`https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing/reels`（404）。

---

*本文件结束。创意侧规则见 [creative-spec.md](./creative-spec.md)。*
