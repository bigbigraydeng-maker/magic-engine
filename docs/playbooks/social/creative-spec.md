# 社媒创意规范（平台层 · 整合稿）

> **负责人**：苏东坡（`sudongpo`）（维护人，无改正文权；升进正文须子牙签字+PM 合并）· [苏东坡档案](../../agents/14-sudongpo.md)
> **范围**：平台层创意规范：短视频的结构、钩子、脚本与字幕、BGM、转场，图片风格，配的文字（标题/正文/首评），图文与短视频的分工。**只整合已有规则，不新增规则**
> **状态**：整合稿，待三视角审查与 PM 回「合」（不新增规则、不改含义）
> **日期**：2026-10-28
> **最后核实**：2026-10-28（出处逐条登记在 [creative-spec-SOURCES.md](./creative-spec-SOURCES.md)；代码行号对照 origin/main `fe6f3f566`）
> **风险**：A 级（经验手册正文是所有窗口必读规则书，改正文须 PM 回「合」）；本次为纯文档
> **代码依据**：只引用既有代码里的机器闸，不改代码；引用格式为 `文件:行号`，见各条「出处」

## 0. 范围与读法

- **这份文件是什么**：把散在手册、交接单、模板手册、设计稿、代码闸里的创意层规则，放到一处并逐条标出处。**没有出处的内容一律不写**；缺的写在第 10 节「空白清单」，注明谁来补。
- **编号**：本文件的每条规则编号为〔CS章.条〕。**前缀用 CS 而不是单个 C**：手册里已有〔C1.1〕〔C2.1〕等（「字幕短句大字」「Meta 安全区」两份原记忆的编号），单个 C 会撞号，故改用 CS。每个编号在 [creative-spec-SOURCES.md](./creative-spec-SOURCES.md) 登记出处，反向也成立（可用脚本对账，见 PR 正文）。
- **出处写法**：〔S/R/C/F/B/V 编号〕= [platform-general.md](./platform-general.md) 里的原文要点编号；`文件:行号` = 仓库文档或代码；〔库〕= 对生产库 `viral_reference_library` 的只读统计（2026-10-28）；〔卡〕= 外部学习卡，**只出现在第 9 节候选区，不混入规则**。
- **三类状态**：规则（有出处，来自已迁入手册、成文文档或机器闸）／ 快照（库统计，只说明覆盖面，**不是规则，单条样本不写成规则**）／ 候选（第 9 节，**候选，未验证**）。
- **与创意层、视频工厂的分工**：创意层负责「想」（开头、结构、脚本、BGM、转场、图片风格、文字），视频工厂负责「做」，苏东坡/马良负责「审」；创意层不调生图/生视频接口、不发布，生产方与检查方分开。创意需求单的字段草案在能力地图设计稿 v0.3 §3.4（`docs/specs/2026-10-19-social-agent-capability-map-v0.3.md`，PR 2906，**截至 origin/main `fe6f3f566` 尚未合并**，仅在分支 `docs/social-agent-capability-map` 上），本文件**引用不复述**。
- **平台层边界**：行业层见 [industry-travel.md](./industry-travel.md)（候选，单客户证据）；客户私有事实、事故细节与客户数字在 `clients/` 目录，**不进本文件**。本文件任何规则都不是授权：生产授权仍以仓库根 CLAUDE.md、发布治理 v0.2 为准。
- **各平台的画幅/时长/字数等规格**不在本文件，见 [platform-specs.md](./platform-specs.md)。
- **本文件与上位规则的关系**：与 CLAUDE.md §8「客户数据红线」冲突时以 CLAUDE.md 为准。

## 1. 短视频结构（时长、节奏、镜头数、片头片尾）

- 〔CS1.1〕Reel 成片的机器体检线：竖版 9:16（宽高比误差 ≤0.015）、不低于 540×960、时长 3–90 秒；不在线内自动判 FAIL。　**出处**：`src/lib/social/reel-media-checks.ts:44-52`
- 〔CS1.2〕模板出片的上传前体检：分辨率 1080×1920、时长误差 0.5 秒内、配了乐就必须有音轨；成片 48MB 以内。　**出处**：`docs/sops/2026-10-27-video-factory-template-playbook-v1.0.md:56,58`
- 〔CS1.3〕明信片模板的结构参数：场景数 2–4；开场 2–4 秒；每景 3–6 秒；价格/片尾段 3–8 秒（带价格卡时至少 5 秒）；总长不超过 25 秒。　**出处**：`scripts/factory-worker/engines/remotion/src/postcard.ts:6-10,281-292,589,615`
- 〔CS1.4〕日常蒙太奇成片时长落在 14.5–18 秒，剪点用节拍网格计算。　**出处**：`src/lib/factory/remotion-daily-plan/music.ts:10-12`
- 〔CS1.5〕配方把一条片拆成 hook / middle / cta 三类段，每段有时长提示、转场、运镜；结构以配方为准。　**出处**：`src/lib/factory/recipe.ts:26`；`src/lib/factory/shot-recipes.ts:33-41`
- 〔CS1.6〕结构照配方：第一帧文字钩子（问题/数字/反差）→ 快切 → problem-solution 或 listicle 框架 → 弱化 logo 与尾卡。　**出处**：〔R3.2〕
- 〔CS1.7〕AI 蒙太奇够不着的爆款要素要诚实标缺口：真人出镜（UGC）、好旁白、无人机航拍、trending 原声；不要假装能靠纯 AI 空镜补。　**出处**：〔R3.3〕
- 〔CS1.8〕视频供给两条路线按场景用：真实感路线（蒙太奇，真图零重绘）适合需要「真实产品/真实场景」承诺的内容；AI 动感路线（图生视频）只做概念/氛围。目前没有「真图只加运动、不被重绘」的中间选项。　**出处**：〔S7.1〕〔S7.2〕
- 〔CS1.9〕片尾落版（模板默认）：居中 logo、名称、一个行动引导，都摆在安全区内；缺引导时用「了解更多 / Learn more」。带价格的结尾默认仍是价格卡。　**出处**：`docs/sops/2026-10-27-video-factory-template-playbook-v1.0.md:63`
- 〔CS1.10〕账号水印一律带背景色块垫底（圆角矩形即可），不让纯文字水印直接浮在真实素材上。　**出处**：〔S16.2〕
- 〔CS1.11〕所有对外交付的视频成片，不论用哪个模板，统一带 logo 水印；挑选或新建模板时先确认有无 logo/水印图层。　**出处**：〔S4.2〕；`src/lib/social/content-review.ts:10`
- 〔CS1.12〕「关注我」这类提醒卡片只在开头出现一次容易被划走，可在整条视频时长的正中间再弹一次（完整弹入-停留-淡出窗口，两次之间留明显间隔）。　**出处**：〔S15.2〕
- 〔CS1.13〕TikTok 日常视频建议 15–30 秒是行业经验，不是官方要求（模板手册自己的标注）。　**出处**：`docs/sops/2026-10-27-video-factory-template-playbook-v1.0.md:117`
- 〔CS1.14〕场景覆盖表给出各场景的建议比例/时长/前 3 秒/结尾（广告 Reels/Stories、FB 动态、TikTok、日常动态、Shorts、长视频等）；表内「缺口」列（如缺 4:5 导出、缺口播风格模板）是现状，不是已有能力。　**出处**：`docs/sops/2026-10-27-video-factory-template-playbook-v1.0.md:105-114`
- 〔CS1.15〕模板各有用途与限制：postcard（一景一句话）、list（清单，含价格页，易被判雷同）、montage（需要 8 个以上镜头）、datacard（纯数字卡）；Story 变体只有设计稿未实现。　**出处**：`docs/sops/2026-10-15-video-factory-handoff-to-97.md:22-25`；`docs/sops/2026-10-27-video-factory-template-playbook-v1.0.md:134-143`

## 2. 钩子（开场前 3 秒、首帧、封面、配方库）

- 〔CS2.1〕漂亮的地标/风景空镜开场是最差的钩子类型；第一帧禁用纯风景空镜，用文字钩子（问题/数字/反差）。赢的是视觉冲击、文字悬念/数字清单、UGC 自拍感、声音钩子。　**出处**：〔S1.1〕
- 〔CS2.2〕风格要真实粗糙感，不要精致广告感；logo 开场 + 结尾尾卡是低分特征；满屏文字叠加、问题-解决方案叙事、快切排名靠前，航拍相对靠后。　**出处**：〔S1.2〕〔S1.3〕
- 〔CS2.3〕排 Reel 前先查该行业在 `viral_reference_library` 的高播放样本，抽出开场钩子、关键技法、风格标签当配方（代码入口 `getViralStyleHint(industry, contentGoal)`）。　**出处**：〔S1.6〕〔R1.1〕〔R3.1〕
- 〔CS2.4〕拿到配方后逐列自检「这一列我打算怎么满足」，并输出配方对账表；只满足节奏参数、不满足素材形态（真人出镜/航拍/真实质感）= 没照配方做；做不到就诚实标缺口。　**出处**：〔S1.5〕〔S1.7〕〔S1.8〕；`CLAUDE.md:251`
- 〔CS2.5〕明信片模板默认前 2 秒用共享钩子：大字逐行滑入、数字弹出或问句，字宽约占画面 70%，关键词用品牌色；缺文案时用「先看这里」（有中文）或 Watch this。其它模板默认关，工单 `frame.hook` 才打开。　**出处**：`docs/sops/2026-10-27-video-factory-template-playbook-v1.0.md:62`
- 〔CS2.6〕明信片钩子最多 3 行，每行宽度不超过 8.7 个字宽单位（约 9 个大写字母）。　**出处**：`scripts/factory-worker/engines/remotion/src/postcard.ts:12-14`
- 〔CS2.7〕首帧不撞脸：Reel 封面和每条 Story 的第一帧必须不一样；同一套版式只换一行字也算撞脸；纯文字卡原则上不做。　**出处**：〔F1〕；`docs/specs/2026-10-13-social-daily-agent-design.md:203-211`
- 〔CS2.8〕排期时同图、同版式、同主体不连续出现；每周把所有 Reel 封面和 Story 图拼成一张总览图，逐对比较，由画面审查员判「首帧相似度」，不过就换图。　**出处**：〔F5〕；`docs/specs/2026-10-13-social-daily-agent-design.md:203-211`
- 〔CS2.9〕「事实没错」不等于「值得发」：每条先答「读者看完得到什么」；干巴巴的纯文字事实卡不单独成条；要像真人运营的账号会发的；与角色匹配。判定由苏东坡做，生产方不得自己填。　**出处**：〔F2〕；`docs/specs/2026-10-13-social-daily-agent-design.md:193-201`
- 〔CS2.10〕封面取成片第 0 帧：第 0 帧本身就是成品画面（钩子字幕 + logo），和第 1 秒差别很小。　**出处**：〔V2〕
- 〔CS2.11〕封面/缩略图大字：字号按画布宽度比例定死（如 15%~19%）并允许换行，不要用 shrink-to-fit 让标题长度反向决定字号；中文粗体字重要实际加载字体查真实字重名。　**出处**：〔S14.2〕〔S14.3〕
- 〔CS2.12〕审核清单里与钩子相关的键：`viral_recipe_hook_matched`（人工判，钩子是否对上配方）、`cover_frame_not_blank_or_placeholder`（机器判，封面非空白/占位）。　**出处**：`src/lib/social/content-review.ts:5,8`
- 〔CS2.13〕配方库字段 `opening_hook` 是 JSON，键为 `type`（开场类型）、`feel`、`script`；创意需求单里的 OpeningType 词表应取自 `opening_hook.type` 的实际值，不自编。　**出处**：〔库〕；`docs/specs/2026-10-19-social-agent-capability-map-v0.3.md` §3.4（分支 docs/social-agent-capability-map）
- 〔CS2.14〕【快照】配方库共 4001 行；`opening_hook` 有值 2651 行；`shot_recipe` 有值 141 行（全部在 travel 行业，其中 youtube 133、tiktok 8）；`style_tags` 非空 2968 行。覆盖面说明，不是规则。　**出处**：〔库〕
- 〔CS2.15〕【快照】按平台：youtube 3783、xiaohongshu 195、facebook 14、tiktok 8、upload 1；**instagram、threads、x、shorts 专属行为 0**。配方库对 Facebook/Instagram/Threads/X 的迁移有效性无样本支撑。　**出处**：〔库〕
- 〔CS2.16〕【快照】按行业（行数）：beauty 577、travel 573、fashion 567、tech 557、fitness 483、real_estate 398、flooring 330、food 321、ai_education 99（opening_hook 0 行）、digital_marketing 96。只有 travel 有 `shot_recipe`。　**出处**：〔库〕
- 〔CS2.17〕【快照】`opening_hook.type` 出现次数：text_overlay_question 1070、ugc_selfie 436、product_reveal 384、visual_shock 232、sound_cue 161、problem_statement 141、scenic_beauty 139、text_overlay_statement 53、testimonial_start 23，其余均不超过 2 次。这是「样本里出现得多」，**不等于效果好**。　**出处**：〔库〕；`docs/specs/2026-10-19-social-agent-capability-map-v0.3.md` §4.3
- 〔CS2.18〕【快照】`style_tags` 出现次数前列：informational 552、fast-cut 443、educational 395、product-showcase 259、ugc-style 231、informative 229、product-demonstration 184、how-to 172、aspirational 164、direct-to-camera 161、instructional 139、humorous 134。　**出处**：〔库〕

## 3. 脚本与字幕（短句大字、安全区、字数闸、禁词闸）

- 〔CS3.1〕屏幕字幕 = 短句、大字、一行不超过 6 个词；长句只能放发帖正文，不烧进画面。判断标准：任何要烧进画面的文字，先问「这行能不能一眼读完」，读不完就是错的。　**出处**：〔S3.2〕〔S3.4〕〔C1.1〕〔C1.7〕
- 〔CS3.2〕禁止把整段业务介绍、角度全名、完整句子直接当屏幕字幕；模板兜底也不许用整句，宁可用品牌名/价格/短角度。　**出处**：〔C1.2〕〔C1.5〕〔S3.3〕
- 〔CS3.3〕生产/装配层加「字幕超长自动截断 + 保底最小字号」双保险。　**出处**：〔S3.5〕〔C1.6〕
- 〔CS3.4〕竖版 1080×1920 关键文字必须落在 y=270~1248 的安全带内；顶部死区 y=0~270，底部死区 y=1248~1920；右侧约 120px 是互动栏，关键文字水平居中、不贴右。　**出处**：〔S2.2〕〔S2.3〕〔S2.4〕〔C2.1〕〔C2.3b〕
- 〔CS3.5〕模板代码里的安全区常量：左 60、上 270、下 1248、右 960（1080 宽）；开场钩子与片尾落版画在该矩形内；其它模板的正文位置未改，安全区不是出片前自动闸。　**出处**：`scripts/factory-worker/engines/remotion/src/safeZone.ts:3-6`；`docs/sops/2026-10-27-video-factory-template-playbook-v1.0.md:61`
- 〔CS3.6〕CTA 不要烧进画面，交给发帖 caption 与首评。　**出处**：〔S2.5〕〔C2.6.3〕〔C3.3〕
- 〔CS3.7〕导出前必须自己逐帧看一遍，或叠 y=270 / y=1248 两条参考线自检；越线的等于观众看不见。写叠字代码时每个 text 的 y 换算成像素后必须在 270~1248。　**出处**：〔S2.7〕〔C2.6.7〕〔C3.2〕〔C3.6〕
- 〔CS3.8〕字号用 vmin 时：1080×1920 里 1 vmin ≈ 10.8px；大标题约 8-10 vmin，品牌名/标语约 3-4 vmin。　**出处**：〔S2.6〕〔C3.5〕
- 〔CS3.9〕Instagram Reels 同规格同规则；Stories 底部死区略小（约 250px），拿不准按 Reels 标准做。　**出处**：〔S2.8〕〔C2.7〕
- 〔CS3.10〕ASR 自动转写会把没听清的内容编成看起来合理的英文词，字幕上屏前必须人工通读全文；更正要在归档记录里写明「转写错误更正，不是编内容」。　**出处**：〔S19.2〕
- 〔CS3.11〕剪辑结束点要人工听到源素材最后一秒，讲者说完收尾话之后的杂音/碎念转写出的孤立短句一律剪掉，不照抄转写时间轴。　**出处**：〔S20.2〕
- 〔CS3.12〕字幕高亮「犀利观点」：保留自己已校对的字幕文本，只对挑中的句子单独覆盖颜色/字号；不要接渲染引擎的自动转写高亮（会推翻已做的校对）。　**出处**：〔S18.2〕
- 〔CS3.13〕审核页「字幕疑似内部标签冒充文案」是 AI 打分不是词表：先看真正送审的整段字幕，清单模板会把标签词拼进每个条目，同一泛词重复 N 次是强信号；换的词必须能从官网原话溯源。　**出处**：〔S22.1a〕〔S22.1c〕
- 〔CS3.14〕明信片模板的画面文字机器闸：英文/中文禁词表（含 deadline、limited time、early bird、countdown、last chance、hurry、book now 等，英文整词匹配）；画面文字里不许出现价格（货币符号、币种代码、「仅需/只要/低至」+数字、「N 折」等）。　**出处**：`scripts/factory-worker/engines/remotion/src/postcard.ts:23-166,216-232`
- 〔CS3.15〕明信片每景必须带 `sourceUrl` + `sourceQuote`（官网原句）+ `placeSourceQuote`，且原句要含这句话至少一半的主要词；这只证明「填了且相关」，不证明官网真有这句话，事实核对仍靠人工与苏东坡。已知绕过写法（如 Prices from…、just … dollars、Ends tonight）见原文。　**出处**：`docs/sops/2026-10-15-video-factory-handoff-to-97.md:27`
- 〔CS3.16〕字幕时间轴体检：字幕条目须有序、不重叠、非空、不超出成片时长，否则自动 FAIL。　**出处**：`src/lib/social/reel-media-checks.ts:56-67`
- 〔CS3.17〕地名字幕必须有「这张图确实拍于该地」的硬证据（图库图看 metadata 的 location，官网图看官网出处）；拿不到就改通用说法；画面里出现可识别文字（招牌、灯笼、路牌）与目的地不符，是硬否决证据。　**出处**：〔S23.1a〕〔S23.1b〕
- 〔CS3.18〕数量暗示词（复数、「多个」、「一路」）写之前回官网数一遍；同一条片子里一个符号不能有两个意思（钩子里的 `+` 与价格页的 `+`）。　**出处**：〔S23.2〕〔S23.4a〕〔S23.4b〕
- 〔CS3.19〕面向特定受众的字幕节奏属于客户 props，不进共享模板默认值（具体数字在客户层）。　**出处**：〔S22.5b〕
- 〔CS3.20〕审核清单里与脚本/字幕/画面相关的键：`subtitle_short_and_large`、`safe_zone_text_in_bounds`、`subtitle_timing_aligned`、`standalone_understandable`（这条 Reel 单独看也能说明它讲什么）。　**出处**：`src/lib/social/content-review.ts:4,9,11,16`

## 4. BGM（曲库、响度、近期用曲、授权状态）

- 〔CS4.1〕配乐必须已登记且无人声：`music-vocals.json` 按文件 sha256 登记；未登记拒绝；`verdict: present`（有人声）拒绝；`verdict: none` 且带 `cleanUntilSec` 须 开始秒 + 片长 + 1 秒余量 ≤ cleanUntilSec；`none` 且不带 `cleanUntilSec` 任意长度可用。　**出处**：〔S24.4a〕；`scripts/factory-worker/music-vocal-gate.mjs`；`docs/sops/2026-10-27-video-factory-template-playbook-v1.0.md:55`
- 〔CS4.2〕排片长之前先查 `music-vocals.json`，别等渲染被拒才发现。　**出处**：〔S24.4b〕
- 〔CS4.3〕新曲登记流程：`tools/analyze-music.py` 量时长/BPM/偏移 → 写 `catalog/music.json`；whisper 双模型转写当证据（纯器乐应转不出有意义的词）；往 `music-vocals.json` 加 sha256 + `verdict:none` + signedBy + evidence；这是动安全闸的配置，按仓库规矩走审查再合。　**出处**：〔S24.5a〕〔S24.5b〕〔S24.5c〕〔S24.5e〕
- 〔CS4.4〕生成新 BGM 的要求：纯器乐，一丝人声都不能有（哼唱、和声、人声采样都算），长度 ≥40 秒。　**出处**：〔S24.6〕
- 〔CS4.5〕配乐文件名必须是「暂存名」= 曲库 id + 扩展名，且不许有空格；曲库里 `folder` 是 `_shared/music` 的才铺了暂存副本，`folder` 是 `Music` 的没铺。　**出处**：〔S24.2〕〔S24.3〕
- 〔CS4.6〕响度：成片响度 ≈ 曲子前 15 秒响度 −1~1.5dB；`_n` 结尾是做过响度归一的副本（前 15 秒约 −16 LUFS，目标成片约 −17 LUFS）；新曲先用 `ffmpeg -t 15 -af ebur128` 量前 15 秒再决定增益。　**出处**：`docs/sops/2026-10-15-video-factory-handoff-to-97.md:47,72`
- 〔CS4.7〕自动检查要求成片有音轨且综合响度高于 −55 LUFS（防静音）；审批时人工要带声音听一遍确认 BGM 无人声。　**出处**：`src/lib/social/reel-media-checks.ts:34-38`；`src/lib/social/content-review.ts:15`
- 〔CS4.8〕音乐要卡点/有 trending 感，别默认库里的史诗乐。　**出处**：〔R3.2〕
- 〔CS4.9〕剪点可以对到所选配乐的拍线上（拍长 = 60/BPM）；配乐用 `analyze-music.py` 重新量，目录 BPM 常常是错的；曲子目前没做节拍对齐（`beats_unverified`），剪点与鼓点不一定对上。　**出处**：〔S22.2〕；`docs/sops/2026-10-15-video-factory-handoff-to-97.md:47`
- 〔CS4.10〕多段视频按内容情绪弧线分 2-4 段选曲，分段依据是内容本身的情绪转折点而非固定时间；段间切换用渲染引擎原生音频淡入淡出；音乐音量明显低于人声（人声 100% 时音乐约 20%~25%，按曲子响度再微调）。　**出处**：〔S17.1〕〔S17.2〕〔S17.3〕〔S17.4〕
- 〔CS4.11〕发布前审核清单有两项 BGM 相关键：`bgm_segmented_with_fades`、`bgm_listened_no_vocals`。　**出处**：`src/lib/social/content-review.ts:14,15`
- 〔CS4.12〕YouTube 公开前的服务器闸里包含 `bgm_not_repeated_in_7_days`（7 天内不重复用同一首）；任一闸不是显式 pass 就不能公开。　**出处**：`src/lib/youtube-publish/gates.ts:7-15`
- 〔CS4.13〕素材授权：Dropbox 素材库里的素材 PM 已多次确认有授权，不再写「授权待补/来源不明」；但不含需署名的第三方素材，也不得据此压住审查警告。　**出处**：〔S22.8〕

## 5. 转场与节奏

- 〔CS5.1〕转场名必须来自 `XFADE_TRANSITIONS` 白名单（20 个，取自本机 `ffmpeg -h filter=xfade` 实测）；传白名单外的名字会让装配当场失败、整单报废。　**出处**：`src/lib/factory/shot-recipes.ts:10-27`
- 〔CS5.2〕走配方路径时，转场由配方定义，工单 brief 不可覆盖。　**出处**：`src/lib/factory/recipe.ts:44,572`
- 〔CS5.3〕目前配方白名单只有 3 个，全是图生视频类：single_image_i2v_pullback_12s、single_image_i2v_multicut_9s、multi_image_i2v_multicut_9s。　**出处**：`src/lib/factory/recipe.ts:20-24`
- 〔CS5.4〕节奏抄满、内容形态一条没抄，结果就是「卡得很准的幻灯片」；节奏参数（镜长、切点、镜头数）不能代替素材形态。　**出处**：〔R2.4〕〔S1.5〕
- 〔CS5.5〕能改 props 就不改模板：`beats` 只有少数下标被用到，中间值只要严格递增，条目数、每条时长、价格页时长、总时长都能靠 props 调；props 做不到才加可选开关，且缺省行为必须不变。　**出处**：〔S22.2〕〔S22.3〕
- 〔CS5.6〕遇到「剪辑不够有设计感」的反馈，先分清是节奏/转场参数问题还是素材形态撑不起效果；确认瓶颈是设计品味/剪辑手感本身时，优先买现成模板/工具，先查手边有没有已买好的工具。　**出处**：〔S9.2〕〔S9.3〕〔S9.5〕
- 〔CS5.7〕审查两位给相反的数时，正确问法是「他们在优化哪两个指标、这条内容存在的目的是什么」；取更保守的那个只是兜底规则；被否决的建议里常裹着真问题。　**出处**：〔S23.5a〕〔S23.5b〕

## 6. 图片风格（品牌 VI、真图优先、AI 生成限制）

- 〔CS6.1〕客户页面/物料的品牌色与 logo，必须先读 `master_briefs` 的 VI 再动手。　**出处**：`CLAUDE.md:244`；`docs/specs/2026-10-19-social-agent-capability-map-v0.3.md` §3.2
- 〔CS6.2〕只有「客户实拍」的素材才能当「产品/展厅承诺」对外发；图库图片和 AI 生成/图生视频输出只能做纯氛围内容，绝不冒充客户真实产品。　**出处**：〔S5.2〕〔R4.3〕
- 〔CS6.3〕判定素材是否真实只看来源事实（provenance：`source_meta.origin` / 显式 source），不看文件名或场景标签。　**出处**：〔S5.3〕〔R4.4〕〔R4.6〕
- 〔CS6.4〕内容生产分两层：Premium 层（真实素材驱动，用于价格/产品承诺，一条真实素材榨出多种变体）和 Ambient 层（图库素材撑频次，只做氛围/品类教育/生活方式，发布前过「是否冒充真实产品」闸）。　**出处**：〔S5.4〕〔S5.5〕〔S5.6〕
- 〔CS6.5〕要求署名的授权图（CC-BY 等）不能走「抓图 → AI 重绘去版权」管线，要走原样直接用的独立路径并在发布前有署名环节；自动化流水线优先只用 CC0/公有领域图和客户自己拍的素材。　**出处**：〔S6.2〕〔S6.3〕
- 〔CS6.6〕用搜索找配图时，搜索词命中不等于内容真是那件事；要核对来源自己写的原始描述（摄影师描述、地理元数据），找不到证据就诚实标「未验证」。　**出处**：〔S12.2〕
- 〔CS6.7〕下载任何新图要 PM 本人在聊天里点头（不能靠别的窗口转述）；工厂自带的 Apify 抓 Pinterest 图库线许可与地点不可靠，已暂停，不要用。　**出处**：`docs/sops/2026-10-15-video-factory-handoff-to-97.md:56`
- 〔CS6.8〕我们管理的 FB/IG 等社媒账户，所有要发布的视频一律只走视频工厂流程，禁止另写脚本直调生成接口加平台发布接口绕过工厂；生产方与质检方必须是两个不同角色。　**出处**：`CLAUDE.md:250`
- 〔CS6.9〕图生视频通病：复杂场景（人脸、地标建筑细节、密集文字）容易变形；AI 会静默增删画面元素；需要看清的主体放大放前景，密集人脸/小字题材别用；运镜提示词避免「浅景深」；验证时看成片实际用到的剪辑区间。　**出处**：〔S7.3〕〔S7.4〕〔S7.5〕〔S7.6〕〔S7.7〕
- 〔CS6.10〕画面下半幅死黑时，先量素材本身底部 15% 的平均亮度并与同片其他镜比，再决定调渐变还是改取景；素材自己就是黑的则改取景，不动共享模板的渐变系数。　**出处**：〔S23.3a〕〔S23.3b〕〔S23.3c〕
- 〔CS6.11〕明信片字卡默认改到安全区上沿或下沿（偶数场景靠下、奇数场景靠上）；仍没有主体检测，字卡可能挡主体。　**出处**：`docs/sops/2026-10-27-video-factory-template-playbook-v1.0.md:60`
- 〔CS6.12〕图文帖图片比例：`PostImageFormat` 只有 `1:1` 与 `4:5`；图片工厂把 `4:5` 映射到 1024×1024，属已核实的现状缺口。　**出处**：`src/lib/social/social-plan-templates.ts:174`；`docs/sops/2026-10-27-video-factory-template-playbook-v1.0.md:143`
- 〔CS6.13〕静图也按同一安全带做：1080×1920 竖版创意（静图或视频）的标题、标签、关键信息必须落在 y 270~1248；字母角标+短说明做进面板图本身。　**出处**：〔C2.1〕〔C2.6.6〕
- 〔CS6.14〕提示词库 `docs/agents/prompt-library/` 为 2026-06-02 的 v1.0（图片提示词按当时单一模型的写法），不作为本节依据；逐条与现行规矩的冲突待核。　**出处**：`docs/agents/prompt-library/image-generation.md:4-6`；`docs/audits/2026-10-28-social-handbook-index-and-gaps.md`（分支 docs/social-handbook-index-gaps）差距 5

## 7. 配的文字（标题、正文、首评、CTA）

- 〔CS7.1〕CTA 链接放发布后自动追加的「第一条评论」里，不放正文；正文只写钩子 + 价值主张 + 一句引导去看评论。　**出处**：〔S8.3〕；`docs/specs/2026-10-13-social-daily-agent-design.md:217`
- 〔CS7.2〕首评里的链接必须带追踪参数（来源/渠道/campaign/内容标识）；每条内容必须标角色，角色写进首评追踪参数。　**出处**：〔S8.4〕；`docs/specs/2026-10-13-social-daily-agent-design.md:163,217`
- 〔CS7.3〕审核清单对应三键：`format_is_reel`、`cta_in_first_comment_not_body`、`first_comment_link_has_tracking_params`（前两键与首评键由服务器自动算）。　**出处**：`src/lib/social/content-review.ts:17-19,41-50`
- 〔CS7.4〕Facebook 首评写入器先扫已有评论找幂等标记、命中就不重复发；读失败一律抛错，不「读不到就当没有」然后盲发。　**出处**：`src/lib/meta/first-comment.ts:3-8`
- 〔CS7.5〕写任何客户对外内容前，具体运营细节（地点、时间、流程、含项）必须先查客户官网当下的真实页面；官网、内部文档、交接记录、记忆库打架时永远以官网当下数据为准。　**出处**：〔S11.2〕〔S11.4〕；`CLAUDE.md:249`
- 〔CS7.6〕客户方向性文档（品牌简报）只给方向和支柱配比，不含具体运营细节，不能当事实来源；发布前逐句标「官网可溯 / 内部文档可溯 / 未经证实」，未证实的删掉或找人确认。　**出处**：〔S11.3〕〔S11.5〕
- 〔CS7.7〕价格不得编；价格只写官网当前价。　**出处**：`docs/specs/2026-10-13-social-daily-agent-design.md:164,176`；`src/lib/social/outbound-claims-price.ts`
- 〔CS7.8〕内容只能取自已核实来源池（事实库 → 真实素材库 → 视频工厂产出），池里没有就不许编，记「缺口」；事实库外的新事实（价格/日期/行程细节）必须先对官网并由 PM 定。　**出处**：`docs/specs/2026-10-13-social-daily-agent-design.md:163,176`
- 〔CS7.9〕同一事实 N 天不重复（默认 7）；同一周内不得出现同图、同版式、同主体连续出现。　**出处**：`docs/specs/2026-10-13-social-daily-agent-design.md:163`
- 〔CS7.10〕Story 文字不超过 200 字、渠道只有 Story、见价格就拦、发送前用指纹重算。　**出处**：`docs/specs/2026-10-13-social-daily-agent-design.md:136`
- 〔CS7.11〕文案生成复用 `copy-generator.ts`（读 master_brief，按 hook/middle/cta 三段，含 `ctaIntentFor`）；创意层不再写第二套生成器。　**出处**：`src/lib/factory/copy-generator.ts:1-8`；`docs/specs/2026-10-19-social-agent-capability-map-v0.3.md` §3.6
- 〔CS7.12〕AI/虚拟角色、合成内容、虚构设定须透明披露，不编经历、不造成真人误认。　**出处**：`docs/skill-cards/ME-SOCIAL-RULES-DIGEST.md`（SO-04）
- 〔CS7.13〕YouTube 公开闸包括 `title_matches_footage`（标题与画面相符）和 `facts_have_website_evidence`。　**出处**：`src/lib/youtube-publish/gates.ts:9,14`
- 〔CS7.14〕指标写进验收/汇报前，先确认当前账号权限拿得到哪一档数据：基础权限只有点赞/评论/分享；播放量、观看时长、触达需要额外洞察权限；没有就不写「看播放量/完播率」。　**出处**：〔S10.1a〕〔S10.1b〕〔S10.2〕
- 〔CS7.15〕核对「发出去的＝批准的」：把平台返回的图下载下来与批准原图逐像素比，比目测可靠。　**出处**：〔S10.6〕

## 8. 图文、短视频、Story 的分工

- 〔CS8.1〕图文与短视频一起管：同一张创意需求单用 `format` 字段区分 reel / short / tiktok_video / story_image / story_video / post_image / carousel / short_text。（设计稿草案，未合并）　**出处**：`docs/specs/2026-10-19-social-agent-capability-map-v0.3.md` §3.1,§3.4（分支 docs/social-agent-capability-map，PR 2906）
- 〔CS8.2〕创意层只想不做，不调生图/生视频接口、不发布；创意层写需求单，工厂做，苏东坡/马良审，创意层不给自己的产出签字。　**出处**：`docs/specs/2026-10-19-social-agent-capability-map-v0.3.md` §3.1；`CLAUDE.md:250`
- 〔CS8.3〕旅游行业层默认分工：Reel = 拉新（钩子用文字不用空镜）；图文 Post = 讲清行程/价格含项/选择理由三选一，链接放首评；Story = 提醒与陪伴不卖货（早=灵感、午=事实、晚=邀请私信）。这是行业层写法，候选。　**出处**：`docs/specs/2026-10-13-social-daily-agent-design.md:164`
- 〔CS8.4〕Post、Reel、Story 的组合计划的家应是「每日计划」，不是三处互不相干（周包 markdown / Story 独立表页面 / Reel 在视频工厂）；PM 要在一个地方看和批。　**出处**：〔F3〕〔F4〕；`docs/specs/2026-10-13-social-daily-agent-design.md` §2A
- 〔CS8.5〕Story：无链接贴纸（接口限制）；Stories 底部死区约 250px，拿不准按 Reels 安全区设计。　**出处**：`docs/specs/2026-10-19-social-agent-capability-map-v0.3.md` §4.3；〔S2.8〕
- 〔CS8.6〕Story/Reel/Post 都要过 `worth_posting`；Story 效果量在没有洞察权限时不承诺观看数。　**出处**：`docs/specs/2026-10-13-social-daily-agent-design.md:193-201`；〔S10.2〕
- 〔CS8.7〕视频走哪个渠道队列：社媒（FB/IG/TikTok 日常）、YouTube、广告三条；入库闸过了才进队列；社媒 Agent 决定发什么、哪天、几点。　**出处**：`docs/sops/2026-10-27-video-factory-template-playbook-v1.0.md:40-44`
- 〔CS8.8〕「一律用 Reel 格式」与现状冲突：每日计划图文 Post 已有自动发 Facebook 的设计与上线，Post/Reel/Story 组合也已是定案方向；原条保留待 PM 审批。　**出处**：〔S8.2〕

## 9. 候选区（学习卡里的外部做法 · 全部「候选，未验证」，不是规则）

> 全部来自 `docs/skill-cards/2026-10-19-social-*.md`，卡状态均为 candidate/learning，无一验证成立（见 `docs/skill-cards/ME-SOCIAL-RULES-DIGEST.md`「外部候选」）。**候选，未验证**：不得当作规则执行，不得写进上面第 1–8 节；晋升需 ME 自有数据验证、苏东坡/子牙复核、PM 回「合」。

- 〔CS9.1〕开场方式可作为单变量测试（不同时改片长、音频、封面、发布时间）；不吸收未经核验的秒数/效果百分比。候选，未验证。　**出处**：[卡](../../skill-cards/2026-10-19-social-hook-first-frame.md)
- 〔CS9.2〕主题跑偏一次可能连累后面几条的试水数据，穿插≠换人群。候选，未验证。　**出处**：[卡](../../skill-cards/2026-10-19-social-algorithm-fit-score-kallaway.md)
- 〔CS9.3〕账号固定 3–4 个栏目；没有神奇发布时段。候选，未验证。　**出处**：[卡](../../skill-cards/2026-10-19-social-tiktok-algorithm-pillars-yanda.md)
- 〔CS9.4〕新账号头一个月不要为起量转给熟人/自家其他主页。候选，未验证。　**出处**：[卡](../../skill-cards/2026-10-19-social-cold-start-no-friend-promo-windy.md)
- 〔CS9.5〕做内容前先写清「这个账号图什么」，再据此定判好坏的指标（不取作者的五类名称框架）。候选，未验证。　**出处**：[卡](../../skill-cards/2026-10-19-social-five-content-games-kallaway.md)
- 〔CS9.6〕排产多记一个「子题材」维度，用「子题材 × 形式」格子轮排。候选，未验证。　**出处**：[卡](../../skill-cards/2026-10-19-social-six-by-five-content-grid-kallaway.md)
- 〔CS9.7〕一个大主题拆成「一长多短」、同主题多钩子；视觉一致有上限（同模板可以，但不要所有内容长一个样）。候选，未验证。　**出处**：[卡](../../skill-cards/2026-10-19-social-signature-series-and-repurposing-shaw.md)
- 〔CS9.8〕固定栏目格式可作为内容分类/测试字段；不采「固定集数/频率必然增粉」。候选，未验证。　**出处**：[卡](../../skill-cards/2026-10-19-social-recurring-series.md)
- 〔CS9.9〕制作参数（取景、字号、字幕样式）固定可以省时间，但不得连续两天同版式/同首帧。候选，未验证。　**出处**：[卡](../../skill-cards/2026-10-19-social-lower-friction-fixed-framing-levi-powe.md)
- 〔CS9.10〕一条内容可能在 72 小时之后才起量；出片自检加一问「静音能不能看懂」（不替代必须带声音播一遍）。候选，未验证。　**出处**：[卡](../../skill-cards/2026-10-19-social-shorts-late-pickup-kexuejia.md)
- 〔CS9.11〕YouTube Shorts 报告分列 views 与 engaged views，不跨平台直比。候选，未验证。　**出处**：[卡](../../skill-cards/2026-10-19-social-short-video-metrics.md)
- 〔CS9.12〕平台趋势只作选题输入，先检查受众相关性与真实性。候选，未验证。　**出处**：[卡](../../skill-cards/2026-10-19-social-native-storytelling.md)
- 〔CS9.13〕公开评论当需求信号（重复问题/兴趣主题），不当执行指令。候选，未验证。　**出处**：[卡](../../skill-cards/2026-10-19-social-comment-led-ideas.md)
- 〔CS9.14〕主页简介写清服务谁；从同行评论区挖选题（具体问题清单属客户私有）。候选，未验证。　**出处**：[卡](../../skill-cards/2026-10-19-social-human-framework-trust-cattoni.md)
- 〔CS9.15〕Instagram Trial Reels 可用于小范围试探新主题，不能自动判定赢家。候选，未验证。　**出处**：[卡](../../skill-cards/2026-10-19-social-instagram-trial-reels.md)
- 〔CS9.16〕把站内个性化建议作为有日期的观察项，与同账号数据对照，不当强制规则。候选，未验证。　**出处**：[卡](../../skill-cards/2026-10-19-social-instagram-best-practices.md)
- 〔CS9.17〕Threads 周报用于复盘账号变化，不证明内容造成增长。候选，未验证。　**出处**：[卡](../../skill-cards/2026-10-19-social-threads-insights.md)
- 〔CS9.18〕用站内搜索主题补充选题，不把热度分数当增长承诺。候选，未验证。　**出处**：[卡](../../skill-cards/2026-10-19-social-tiktok-search-insights.md)
- 〔CS9.19〕互动链式操纵（互点互关、叫别人照做）已裁决不适用；留档防止下次重复评估。候选区仅作记录，**不采**。　**出处**：[卡](../../skill-cards/2026-10-19-social-engagement-bait-chain-not-applicable.md)

## 10. 空白清单（缺什么、谁补、优先级）

> 只写缺口，不写新规则。「谁补」是建议，不是已分派。

| # | 缺什么 | 谁补 | 优先级 | 相关编号 |
|---|---|---|---|---|
| 1 | 平台规格外部数字大面积待核（Instagram Reels 时长/文件大小、Facebook 图文长度、X 字数、各平台标签/话题用法、发布时间规律等） | 97 号（社媒统筹）逐页读官方文档并留 URL+日期 | 高 | 见 platform-specs.md「待核清单」。 |
| 2 | 配方库对 Facebook/Instagram/Threads/X 样本几乎为零（facebook 14 行、instagram/threads/x 0 行；youtube 占 94% 以上），钩子规律对这些平台的迁移有效性没有证据 | 苏东坡 + 97 号：先补样本再谈规则；效果用 ME 自有标签数据验 | 高 | CS2.15 快照。 |
| 3 | logo 水印规则互相拉扯：手册要求所有成片带 logo〔S4.2〕、审核清单有 `logo_watermark_present`；同一手册又写「logo 开场+尾卡是低分特征」〔S1.3〕；模板默认只在最后 60 帧出现（模板手册:190） | PM 裁决口径，苏东坡/马良落地 | 高 | CS1.2、CS1.11、CS2.2。 |
| 4 | 创意需求单（能力地图 §3.4）仍是未合并的草案，创意层输出没有结构化落点 | 97 号推动 PR 2906 审批；合并前本规范无结构化入口 | 高 | CS8.1。 |
| 5 | 转场只有「合法名字白名单」，没有任何「用哪种转场、快切还是慢切」的效果依据（行业快切/慢切偏好在设计稿里标「候选，无证据」） | 苏东坡/马良用 ME 自有数据验证后补 | 中 | 第 5 节。 |
| 6 | 标签（hashtag）用法没有任何可核来源 | 97 号读各平台官方说明；学习卡里 TikTok 标签基本不用的说法只是候选 | 中 | platform-specs.md；候选 CS9.3。 |
| 7 | 配乐授权：只有 PM 对 Dropbox 素材的口头确认，没有逐曲授权来源登记表；`music-vocals.json` 只管有没有人声，不管授权 | 106/曲库负责人补登记表；PM 确认口径 | 中 | CS4.1、CS4.13。 |
| 8 | 画面禁词/价格闸写在 postcard 模板代码里（含 early bird 等词），不清楚哪些属平台默认、哪些是客户政策；其它模板没有同样的闸；价格词表靠客户配置（模板手册:180） | 子牙判层，97 号整理 | 中 | CS3.14。 |
| 9 | 「价格只放首评、画面不出价格」目前依据来自某客户的素材授权现状，是否平台默认待判；手册 S22.8、S5.2 只管素材真实性 | 苏东坡判层后再写 | 中 | CS7.7。 |
| 10 | 提示词库 v1.0（2026-06-02）与现行规矩（真图不用 AI 生成、i2v 易幻觉、供应商封装名）冲突条款没有逐条核，也没标「部分作废」 | 李白（提示词库管理）逐条标注 | 中 | CS6.14；审计差距 5。 |
| 11 | 配方白名单只有图生视频三种；「真实素材蒙太奇」路线没有配方登记，真人出镜/航拍/UGC 素材形态靠人工 | 视频工厂负责人 | 中 | CS5.3、CS1.7。 |
| 12 | 图文 4:5 出图映射到 1024×1024，成片只出 9:16，多比例导出没有 | 视频工厂负责人 | 中 | CS6.12；模板手册 P0 第 5 条。 |
| 13 | Instagram/TikTok/Threads/X/YouTube 的首评与 CTA 能力未验证 | Codex 连接线 + 97 号 | 中 | platform-specs.md 各节。 |
| 14 | 发布时间规律：设计稿规定时间是客户配置项，平台层没有可核的通用规律（学习卡里「没有神奇发布时段」只是候选） | 97 号用 ME 回看数据验 | 低 | CS9.3。 |
| 15 | 手册 S8.2「一律用 Reel」与图文 Post 现状冲突，原条待 PM 审批 | PM | 低 | CS8.8。 |
| 16 | 「静音也能看懂」尚未进出片自检（学习卡候选） | 马良 + 苏东坡验证后补 | 低 | CS9.10。 |
| 17 | 相邻内容不同曲、7 天最多复用一次的排程规则目前只在客户层且标「待判」（YouTube 渠道有机器闸） | 97 号/子牙判是否上提平台层 | 低 | CS4.12。 |

---

*本文件结束。出处对账表：[creative-spec-SOURCES.md](./creative-spec-SOURCES.md)。*
