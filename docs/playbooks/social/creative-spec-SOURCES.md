# 社媒创意规范：出处对账表（SOURCES）

> **负责人**：苏东坡（`sudongpo`）（维护人，无改正文权；升进正文须子牙签字+PM 合并）· [苏东坡档案](../../agents/14-sudongpo.md)
> **范围**：登记 [creative-spec.md](./creative-spec.md) 每个〔CS编号〕的出处类型、出处、核对备注；用来核对「每条都有出处、反向也成立」
> **状态**：整合稿，待三视角审查与 PM 回「合」
> **日期**：2026-10-28
> **最后核实**：2026-10-28（代码行号对照 origin/main `fe6f3f566`）
> **风险**：A 级（经验手册正文，改正文须 PM 回「合」）；纯文档
> **代码依据**：只引用既有代码，不改代码

**出处类型**：手册条目 = 已迁入的 platform-general.md 等的〔编号〕；仓库文档 = 成文的 sops/specs/agents/audits/skill-cards 文件；代码机器闸 = 已在代码里执行的限制（注释或常量）；库只读统计 = 对生产库 `viral_reference_library` 的 SELECT（2026-10-28）；学习卡（候选）= `docs/skill-cards/` 外部学习卡，**候选，未验证**。

**行号说明**：行号是 2026-10-28 对照 origin/main `fe6f3f566` 的位置；文件之后改动会漂移，以条文内容为准。引用分支上未合并文件处已注明。

| 编号 | 出处类型 | 出处 | 核对备注 |
|---|---|---|---|
| CS1.1 | 代码机器闸 | `src/lib/social/reel-media-checks.ts:44-52` | reel-media-checks.ts:44 宽高比与最小尺寸；:48/:52 时长 3–90 秒。 |
| CS1.2 | 仓库文档 | `docs/sops/2026-10-27-video-factory-template-playbook-v1.0.md:56,58` | 模板手册 §3 入库规则表「成片体检」「体积在上限内」两行。 |
| CS1.3 | 代码机器闸 | `scripts/factory-worker/engines/remotion/src/postcard.ts:6-10,281-292,589,615` | 常量 MIN_SCENES/MAX_SCENES/MAX_TOTAL_SEC 与 TIMING 校验；589 行带价格卡 priceSec<5 报错；615 行总长闸。 |
| CS1.4 | 代码机器闸 | `src/lib/factory/remotion-daily-plan/music.ts:10-12` | MIN_VIDEO_SEC=14.5、MAX_VIDEO_SEC=18。 |
| CS1.5 | 代码机器闸 | `src/lib/factory/recipe.ts:26`；`src/lib/factory/shot-recipes.ts:33-41` | RecipeSegmentRole 与 RecipeShot 的 role 字段。 |
| CS1.6 | 手册条目 | 〔R3.2〕 | platform-general.md 第一节。 |
| CS1.7 | 手册条目 | 〔R3.3〕 | platform-general.md 第一节。 |
| CS1.8 | 手册条目 | 〔S7.1〕〔S7.2〕 | platform-general.md 第七节。 |
| CS1.9 | 仓库文档 | `docs/sops/2026-10-27-video-factory-template-playbook-v1.0.md:63` | 模板手册 §3「片尾落版」。 |
| CS1.10 | 手册条目 | 〔S16.2〕 | platform-general.md 第十六节。 |
| CS1.11 | 手册条目 | 〔S4.2〕；`src/lib/social/content-review.ts:10` | 手册 S4.2；审核清单键 logo_watermark_present（人工判）。与〔S1.3〕〔R3.2〕「logo 开场+尾卡是低分特征」的张力见第 10 节。 |
| CS1.12 | 手册条目 | 〔S15.2〕 | platform-general.md 第十五节。 |
| CS1.13 | 仓库文档 | `docs/sops/2026-10-27-video-factory-template-playbook-v1.0.md:117` | 「平台规格来自 Meta、TikTok、YouTube 官方说明；TikTok 15–30 秒是行业经验，不是官方要求」；该文件其余官方规格本稿未核，见 platform-specs.md。 |
| CS1.14 | 仓库文档 | `docs/sops/2026-10-27-video-factory-template-playbook-v1.0.md:105-114` | 模板手册「场景覆盖」表。 |
| CS1.15 | 仓库文档 | `docs/sops/2026-10-15-video-factory-handoff-to-97.md:22-25`；`docs/sops/2026-10-27-video-factory-template-playbook-v1.0.md:134-143` | handoff §3 模板表；模板手册「现有模板问题」表（单数为 2026-10-27 数据快照，未复核）。 |
| CS2.1 | 手册条目 | 〔S1.1〕 | platform-general.md 第一节（按平均播放量加权的定性结论；样本是否限于旅游待判，具体数字见 industry-travel.md，候选）。 |
| CS2.2 | 手册条目 | 〔S1.2〕〔S1.3〕 | platform-general.md 第一节。 |
| CS2.3 | 手册条目 | 〔S1.6〕〔R1.1〕〔R3.1〕 | platform-general.md 第一节；函数所在 `src/lib/reels/viral-style-advisor.ts`（手册已核实仍在）。 |
| CS2.4 | 手册条目 | 〔S1.5〕〔S1.7〕〔S1.8〕；`CLAUDE.md:251` | 手册三条 + 仓库根 CLAUDE.md §8「对外画面必先跑配方对账」。 |
| CS2.5 | 仓库文档 | `docs/sops/2026-10-27-video-factory-template-playbook-v1.0.md:62` | 模板手册 §3「前 3 秒有钩子」。 |
| CS2.6 | 代码机器闸 | `scripts/factory-worker/engines/remotion/src/postcard.ts:12-14` | MAX_HOOK_LINES=3、HOOK_LINE_UNITS=8.7。 |
| CS2.7 | 手册条目 | 〔F1〕；`docs/specs/2026-10-13-social-daily-agent-design.md:203-211` | 手册 F1；日常设计 §3.5（平台层通用）。 |
| CS2.8 | 手册条目 | 〔F5〕；`docs/specs/2026-10-13-social-daily-agent-design.md:203-211` | 手册 F5；日常设计 §3.5 第 1、2 点（整周画面复核）。 |
| CS2.9 | 手册条目 | 〔F2〕；`docs/specs/2026-10-13-social-daily-agent-design.md:193-201` | 手册 F2；日常设计 §3.4 `worth_posting` 四条。 |
| CS2.10 | 手册条目 | 〔V2〕 | platform-general.md 第二十五节（旅游客户 2026-10-27 实测，规则本身与客户无关）。 |
| CS2.11 | 手册条目 | 〔S14.2〕〔S14.3〕 | platform-general.md 第十四节（一次批量剪辑的实测）。 |
| CS2.12 | 代码机器闸 | `src/lib/social/content-review.ts:5,8` | CONTENT_CHECK_KEYS。 |
| CS2.13 | 库只读统计 | 〔库〕；`docs/specs/2026-10-19-social-agent-capability-map-v0.3.md` §3.4（分支 docs/social-agent-capability-map） | 库查询：对 opening_hook 取键（2026-10-28）；能力地图 §3.4 OpeningType 注释。 |
| CS2.14 | 库只读统计 | 〔库〕 | SELECT count(*) / count(*) filter(where ... is not null)，2026-10-28。 |
| CS2.15 | 库只读统计 | 〔库〕 | SELECT platform, count(*) GROUP BY platform，2026-10-28。 |
| CS2.16 | 库只读统计 | 〔库〕 | SELECT industry, count(*)，2026-10-28。 |
| CS2.17 | 库只读统计 | 〔库〕；`docs/specs/2026-10-19-social-agent-capability-map-v0.3.md` §4.3 | SELECT opening_hook->>'type'，2026-10-28；能力地图 §4.3 已有同口径（当时 2623 行）。 |
| CS2.18 | 库只读统计 | 〔库〕 | SELECT unnest(style_tags) 统计，2026-10-28。 |
| CS3.1 | 手册条目 | 〔S3.2〕〔S3.4〕〔C1.1〕〔C1.7〕 | platform-general.md 第三节。 |
| CS3.2 | 手册条目 | 〔C1.2〕〔C1.5〕〔S3.3〕 | platform-general.md 第三节。 |
| CS3.3 | 手册条目 | 〔S3.5〕〔C1.6〕 | platform-general.md 第三节（手册表述为「最好加」）。 |
| CS3.4 | 手册条目 | 〔S2.2〕〔S2.3〕〔S2.4〕〔C2.1〕〔C2.3b〕 | platform-general.md 第二节。 |
| CS3.5 | 代码机器闸 | `scripts/factory-worker/engines/remotion/src/safeZone.ts:3-6`；`docs/sops/2026-10-27-video-factory-template-playbook-v1.0.md:61` | safeZone.ts 常量；模板手册 §3「平台安全区」标「部分」。 |
| CS3.6 | 手册条目 | 〔S2.5〕〔C2.6.3〕〔C3.3〕 | platform-general.md 第二节。 |
| CS3.7 | 手册条目 | 〔S2.7〕〔C2.6.7〕〔C3.2〕〔C3.6〕 | platform-general.md 第二节。 |
| CS3.8 | 手册条目 | 〔S2.6〕〔C3.5〕 | platform-general.md 第二节。 |
| CS3.9 | 手册条目 | 〔S2.8〕〔C2.7〕 | platform-general.md 第二节。 |
| CS3.10 | 手册条目 | 〔S19.2〕 | platform-general.md 第十九节。 |
| CS3.11 | 手册条目 | 〔S20.2〕 | platform-general.md 第二十节。 |
| CS3.12 | 手册条目 | 〔S18.2〕 | platform-general.md 第十八节。 |
| CS3.13 | 手册条目 | 〔S22.1a〕〔S22.1c〕 | platform-general.md 第二十二节（打分与线上分只能比相对高低）。 |
| CS3.14 | 代码机器闸 | `scripts/factory-worker/engines/remotion/src/postcard.ts:23-166,216-232` | ENGLISH_BANNED / CHINESE_BANNED 与 priceMentionHits。这张禁词表属平台默认还是客户配置，见第 10 节。 |
| CS3.15 | 仓库文档 | `docs/sops/2026-10-15-video-factory-handoff-to-97.md:27` | handoff §3 末段。 |
| CS3.16 | 代码机器闸 | `src/lib/social/reel-media-checks.ts:56-67` | buildReelMediaAutoChecks 字幕段。 |
| CS3.17 | 手册条目 | 〔S23.1a〕〔S23.1b〕 | platform-general.md 第二十三节。 |
| CS3.18 | 手册条目 | 〔S23.2〕〔S23.4a〕〔S23.4b〕 | platform-general.md 第二十三节。 |
| CS3.19 | 手册条目 | 〔S22.5b〕 | platform-general.md 第二十二节。 |
| CS3.20 | 代码机器闸 | `src/lib/social/content-review.ts:4,9,11,16` | CONTENT_CHECK_KEYS。 |
| CS4.1 | 手册条目 | 〔S24.4a〕；`scripts/factory-worker/music-vocal-gate.mjs`；`docs/sops/2026-10-27-video-factory-template-playbook-v1.0.md:55` | 手册 S24.4a；模板手册「配乐合规」自动闸。登记表现状是 2026-10-25 快照〔S24.4b〕。 |
| CS4.2 | 手册条目 | 〔S24.4b〕 | platform-general.md 第二十四节。 |
| CS4.3 | 手册条目 | 〔S24.5a〕〔S24.5b〕〔S24.5c〕〔S24.5e〕 | platform-general.md 第二十四节。 |
| CS4.4 | 手册条目 | 〔S24.6〕 | platform-general.md 第二十四节。 |
| CS4.5 | 手册条目 | 〔S24.2〕〔S24.3〕 | platform-general.md 第二十四节（出片机运维细节，快照可能已变）。 |
| CS4.6 | 仓库文档 | `docs/sops/2026-10-15-video-factory-handoff-to-97.md:47,72` | handoff §4「响度坑」与 §7「声音」。 |
| CS4.7 | 代码机器闸 | `src/lib/social/reel-media-checks.ts:34-38`；`src/lib/social/content-review.ts:15` | 音轨/响度机器闸；`bgm_listened_no_vocals` 人工项。 |
| CS4.8 | 手册条目 | 〔R3.2〕 | platform-general.md 第一节。 |
| CS4.9 | 手册条目 | 〔S22.2〕；`docs/sops/2026-10-15-video-factory-handoff-to-97.md:47` | 手册 S22.2；handoff §4 末句。 |
| CS4.10 | 手册条目 | 〔S17.1〕〔S17.2〕〔S17.3〕〔S17.4〕 | platform-general.md 第十七节（来自一次批量剪辑，单场景证据）。 |
| CS4.11 | 代码机器闸 | `src/lib/social/content-review.ts:14,15` | CONTENT_CHECK_KEYS。 |
| CS4.12 | 代码机器闸 | `src/lib/youtube-publish/gates.ts:7-15` | PUBLISH_GATE_IDS。其它渠道的相邻内容用曲规则只在客户层，见第 10 节。 |
| CS4.13 | 手册条目 | 〔S22.8〕 | platform-general.md 第二十二节第 8 点。音乐逐曲授权登记缺失，见第 10 节。 |
| CS5.1 | 代码机器闸 | `src/lib/factory/shot-recipes.ts:10-27` | 文件头注释与常量。 |
| CS5.2 | 代码机器闸 | `src/lib/factory/recipe.ts:44,572` | 注释 R8 与校验处。 |
| CS5.3 | 代码机器闸 | `src/lib/factory/recipe.ts:20-24` | WINNER_RECIPE_IDS。真实素材蒙太奇没有配方登记，见第 10 节。 |
| CS5.4 | 手册条目 | 〔R2.4〕〔S1.5〕 | platform-general.md 第一节。 |
| CS5.5 | 手册条目 | 〔S22.2〕〔S22.3〕 | platform-general.md 第二十二节。 |
| CS5.6 | 手册条目 | 〔S9.2〕〔S9.3〕〔S9.5〕 | platform-general.md 第九节。 |
| CS5.7 | 手册条目 | 〔S23.5a〕〔S23.5b〕 | platform-general.md 第二十三节。 |
| CS6.1 | 仓库文档 | `CLAUDE.md:244`；`docs/specs/2026-10-19-social-agent-capability-map-v0.3.md` §3.2 | 根 CLAUDE.md §7；能力地图图片风格行「VI（先读 master_briefs）」。 |
| CS6.2 | 手册条目 | 〔S5.2〕〔R4.3〕 | platform-general.md 第五节。 |
| CS6.3 | 手册条目 | 〔S5.3〕〔R4.4〕〔R4.6〕 | platform-general.md 第五节。 |
| CS6.4 | 手册条目 | 〔S5.4〕〔S5.5〕〔S5.6〕 | platform-general.md 第五节。 |
| CS6.5 | 手册条目 | 〔S6.2〕〔S6.3〕 | platform-general.md 第六节。 |
| CS6.6 | 手册条目 | 〔S12.2〕 | platform-general.md 第十二节。 |
| CS6.7 | 仓库文档 | `docs/sops/2026-10-15-video-factory-handoff-to-97.md:56` | handoff §5 末条（2026-10-15 状态）。 |
| CS6.8 | 仓库文档 | `CLAUDE.md:250` | 根 CLAUDE.md §8。 |
| CS6.9 | 手册条目 | 〔S7.3〕〔S7.4〕〔S7.5〕〔S7.6〕〔S7.7〕 | platform-general.md 第七节。 |
| CS6.10 | 手册条目 | 〔S23.3a〕〔S23.3b〕〔S23.3c〕 | platform-general.md 第二十三节。 |
| CS6.11 | 仓库文档 | `docs/sops/2026-10-27-video-factory-template-playbook-v1.0.md:60` | 模板手册 §3「字不压主体」标「部分」。 |
| CS6.12 | 代码机器闸 | `src/lib/social/social-plan-templates.ts:174`；`docs/sops/2026-10-27-video-factory-template-playbook-v1.0.md:143` | 类型定义；模板手册「图片工厂」行。 |
| CS6.13 | 手册条目 | 〔C2.1〕〔C2.6.6〕 | platform-general.md 第二节。 |
| CS6.14 | 仓库文档 | `docs/agents/prompt-library/image-generation.md:4-6`；`docs/audits/2026-10-28-social-handbook-index-and-gaps.md`（分支 docs/social-handbook-index-gaps）差距 5 | 文件头版本信息；审计文件差距 5 只凭文件头判断，未逐条核（审计 §4 自述）。 |
| CS7.1 | 手册条目 | 〔S8.3〕；`docs/specs/2026-10-13-social-daily-agent-design.md:217` | 手册 S8.3；日常设计 §4 平台层。 |
| CS7.2 | 手册条目 | 〔S8.4〕；`docs/specs/2026-10-13-social-daily-agent-design.md:163,217` | 手册 S8.4；日常设计 §3.1、§4 平台层。 |
| CS7.3 | 代码机器闸 | `src/lib/social/content-review.ts:17-19,41-50` | CONTENT_CHECK_KEYS 与 REEL_AUTO_CHECK_KEYS。 |
| CS7.4 | 代码机器闸 | `src/lib/meta/first-comment.ts:3-8` | 文件头注释。其它平台首评能力未验证，见 platform-specs.md。 |
| CS7.5 | 手册条目 | 〔S11.2〕〔S11.4〕；`CLAUDE.md:249` | 手册第十一节；根 CLAUDE.md §8。 |
| CS7.6 | 手册条目 | 〔S11.3〕〔S11.5〕 | platform-general.md 第十一节。 |
| CS7.7 | 仓库文档 | `docs/specs/2026-10-13-social-daily-agent-design.md:164,176`；`src/lib/social/outbound-claims-price.ts` | 日常设计 §3.1 旅游行业层行（第 164 行）；价格扫描器源文件。这是旅游行业层写法，是否平台默认见第 10 节。 |
| CS7.8 | 仓库文档 | `docs/specs/2026-10-13-social-daily-agent-design.md:163,176` | 日常设计 §3.1 平台层与审批矩阵。 |
| CS7.9 | 仓库文档 | `docs/specs/2026-10-13-social-daily-agent-design.md:163` | 日常设计 §3.1 平台层。 |
| CS7.10 | 仓库文档 | `docs/specs/2026-10-13-social-daily-agent-design.md:136` | 日常设计 §2A.4 对 story-lite 的描述。 |
| CS7.11 | 仓库文档 | `src/lib/factory/copy-generator.ts:1-8`；`docs/specs/2026-10-19-social-agent-capability-map-v0.3.md` §3.6 | 文件头注释；能力地图 §3.6（分支版本，未合并）。 |
| CS7.12 | 仓库文档 | `docs/skill-cards/ME-SOCIAL-RULES-DIGEST.md`（SO-04） | 规则摘要 [SO-04]；其来源 SOP 为 A 级草案、PM 未批，仅作索引。 |
| CS7.13 | 代码机器闸 | `src/lib/youtube-publish/gates.ts:9,14` | PUBLISH_GATE_IDS。 |
| CS7.14 | 手册条目 | 〔S10.1a〕〔S10.1b〕〔S10.2〕 | platform-general.md 第十节。 |
| CS7.15 | 手册条目 | 〔S10.6〕 | platform-general.md 第十节。 |
| CS8.1 | 仓库文档 | `docs/specs/2026-10-19-social-agent-capability-map-v0.3.md` §3.1,§3.4（分支 docs/social-agent-capability-map，PR 2906） | 草案；合并前不是现行契约。 |
| CS8.2 | 仓库文档 | `docs/specs/2026-10-19-social-agent-capability-map-v0.3.md` §3.1；`CLAUDE.md:250` | 能力地图 §3.1（草案）；根 CLAUDE.md §8。 |
| CS8.3 | 仓库文档 | `docs/specs/2026-10-13-social-daily-agent-design.md:164` | 日常设计 §3.1 旅游行业层行。 |
| CS8.4 | 手册条目 | 〔F3〕〔F4〕；`docs/specs/2026-10-13-social-daily-agent-design.md` §2A | 手册 F3、F4；日常设计 §2A。现状落地程度以日常设计为准。 |
| CS8.5 | 仓库文档 | `docs/specs/2026-10-19-social-agent-capability-map-v0.3.md` §4.3；〔S2.8〕 | 能力地图 §4.3「首评/CTA」行引用日常设计 §4；手册 S2.8。 |
| CS8.6 | 仓库文档 | `docs/specs/2026-10-13-social-daily-agent-design.md:193-201`；〔S10.2〕 | 日常设计 §3.4；手册 S10.2。 |
| CS8.7 | 仓库文档 | `docs/sops/2026-10-27-video-factory-template-playbook-v1.0.md:40-44` | 模板手册 §2；§6 结论：社媒 Agent 排期与工厂选片的接线「未找到」。 |
| CS8.8 | 手册条目 | 〔S8.2〕 | 手册 S8.2 自带「已过期/待核」标注。 |
| CS9.1 | 学习卡（候选） | [卡](../../skill-cards/2026-10-19-social-hook-first-frame.md) | 卡裁决：部分吸收（待验证）。 |
| CS9.2 | 学习卡（候选） | [卡](../../skill-cards/2026-10-19-social-algorithm-fit-score-kallaway.md) | 卡裁决：待验证（优先）；其中「前 200 人」等数字为作者举例，卡内标未核实。 |
| CS9.3 | 学习卡（候选） | [卡](../../skill-cards/2026-10-19-social-tiktok-algorithm-pillars-yanda.md) | 卡裁决：固定栏目「吸收（待验证，优先）」，发布时段「待验证」。 |
| CS9.4 | 学习卡（候选） | [卡](../../skill-cards/2026-10-19-social-cold-start-no-friend-promo-windy.md) | 卡裁决：待验证（优先）；作者讲的是长视频频道，时间刻度为个人观察。 |
| CS9.5 | 学习卡（候选） | [卡](../../skill-cards/2026-10-19-social-five-content-games-kallaway.md) | 卡裁决：①部分吸收（待验证，优先）；「照 outlier 临摹」已裁决忽略。 |
| CS9.6 | 学习卡（候选） | [卡](../../skill-cards/2026-10-19-social-six-by-five-content-grid-kallaway.md) | 卡裁决：待验证（流程类）。 |
| CS9.7 | 学习卡（候选） | [卡](../../skill-cards/2026-10-19-social-signature-series-and-repurposing-shaw.md) | 卡裁决：②吸收（待验证，优先）、④部分吸收并写明上限。 |
| CS9.8 | 学习卡（候选） | [卡](../../skill-cards/2026-10-19-social-recurring-series.md) | 卡裁决：部分吸收（待验证）。 |
| CS9.9 | 学习卡（候选） | [卡](../../skill-cards/2026-10-19-social-lower-friction-fixed-framing-levi-powe.md) | 卡裁决：部分吸收；ME 现有首帧规则为准。 |
| CS9.10 | 学习卡（候选） | [卡](../../skill-cards/2026-10-19-social-shorts-late-pickup-kexuejia.md) | 卡裁决：待验证（优先）/ 部分吸收（待验证）。 |
| CS9.11 | 学习卡（候选） | [卡](../../skill-cards/2026-10-19-social-short-video-metrics.md) | 卡裁决：部分吸收（待验证）。 |
| CS9.12 | 学习卡（候选） | [卡](../../skill-cards/2026-10-19-social-native-storytelling.md) | 卡裁决：部分吸收（待验证）。 |
| CS9.13 | 学习卡（候选） | [卡](../../skill-cards/2026-10-19-social-comment-led-ideas.md) | 卡裁决：部分吸收（待验证）。 |
| CS9.14 | 学习卡（候选） | [卡](../../skill-cards/2026-10-19-social-human-framework-trust-cattoni.md) | 卡裁决：①②吸收（待验证，优先）。 |
| CS9.15 | 学习卡（候选） | [卡](../../skill-cards/2026-10-19-social-instagram-trial-reels.md) | 卡裁决：部分吸收（待验证）。 |
| CS9.16 | 学习卡（候选） | [卡](../../skill-cards/2026-10-19-social-instagram-best-practices.md) | 卡裁决：部分吸收（待验证）。 |
| CS9.17 | 学习卡（候选） | [卡](../../skill-cards/2026-10-19-social-threads-insights.md) | 卡裁决：部分吸收（待验证）。 |
| CS9.18 | 学习卡（候选） | [卡](../../skill-cards/2026-10-19-social-tiktok-search-insights.md) | 卡裁决：部分吸收（待验证）。 |
| CS9.19 | 学习卡（候选） | [卡](../../skill-cards/2026-10-19-social-engagement-bait-chain-not-applicable.md) | 卡裁决：忽略（不适用）。 |

## 统计

共 129 条编号。手册条目 59 条　仓库文档 25 条　代码机器闸 20 条　库只读统计 6 条　学习卡（候选） 19 条。
