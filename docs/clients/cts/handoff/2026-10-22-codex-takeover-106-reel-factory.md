# Codex 接手 106 号窗口 · CTS 出片，只走视频工厂（2026-10-22 起，至 Claude 回来）

先完整读通用规则 `docs/codex-prompts/2026-10-22-claude-outage-codex-takeover-common.md`（红线、说话方式、交接日志、交还全部适用）。本文件只写 106 号这条线的内容。

## 一句话任务

做出一条合规的 Tale（兵马俑）新 Reel 候选，走完工厂流程到「待审」，自检表齐全，交给 74-Codex 接力；守住素材库现状别弄坏。不发布；不上传广告素材库，除非 PM 说「传」。

## 谁是谁

- 106 号（你接手的）：CTS 出片，客户社媒视频只走视频工厂。原窗口是 Claude，已停手。
- 74 号：CTS 广告总控，由另一个 Codex 窗口接手，见 `2026-10-22-codex-takeover-74-ad-control.md`。你们靠交接日志接力：你的日志里有 `VIDEO_READY` 段，它读。
- 苏东坡 / 马良：质检角色，是 Claude 的审查员，这几天不在（见第五条任务）。

## 快照（2026-10-22）

- 背景：PM 要换回最早那批爆款广告的写法。文案 75 号已写好，视频是卡点——旧兵马俑视频和 Kiwi 上海视频经 106 逐帧看过都不能用，所以要新做一条。
- 106 当天已完成：Natural China 免费素材补库。从 Pexels 下载 14 条，挑 10 条裁成竖版（1080×1920、无声）入库 `~/Dropbox/MagicLab_Studio/CTS/remotion-assets/clips/nc2_*.mp4`；来源 / 作者 / 授权在同目录 `credits-v11.json`；盘存表（只读，那是 Claude 的工作区）`/Users/raydeng/Projects/magic-engine/.claude/worktrees/magical-chatelet-25af10/docs/clients/cts/2026-10-22-natural-china-footage-inventory.md`。

| 景点 | 新入库 | 判定 |
|---|---|---|
| 西安兵马俑 | 头像侧面特写（清晰、无真人）、铠甲特写（无脸） | 可用，可作 Tale 开场 |
| 成都熊猫 | 熊猫趴木架（前 5 秒好用） | 可用 |
| 三峡 / 长江 | 峡谷小客船、峡谷彩色邮轮 | 只能当「长江风光」；船不是 CTS 的船，不能暗示行程用这条船 |
| 重庆 | 洪崖洞 + 大桥、江边大桥 + 码头、日落天际线 + 游船 | 可用（日落那条原片只有 1080p，略软） |
| 玻璃栈道 2 条 | — | 地点没证据，不许写张家界，只当「玻璃栈道」通用画面 |

- 仍缺（要 CTS 提供，74-Codex 在整理需求清单）：真人游客（免费素材没有肖像授权，一条都不能用）、CTS 真实的船 / 船舱、宽窄巷子、李子坝轻轨穿楼、上海黄浦江夜游、有地点证据的张家界玻璃桥。
- Tale 新片的要求（75 + 74 + 106 的结论）：开场 = 兵马俑头像微距特写；10-15 秒；无价格、无日期、无限时 / 限量、无 visa-free、无高铁、无 1928、无 small group；不放真人脸；文字引用 CTS 官网兵马俑指南页原文（"No two are the same… different hairstyles, different expressions"），出片前重新抓官网核对；字幕短句大字，放在安全区内（y 270-1248），节奏放慢（CTS 受众偏中老年）。
- 工厂怎么走：工单（写进生产库）→ 本机出片机（LaunchAgent `com.magicengine.factory-worker`）渲染 → 待审 → 苏东坡 / 马良审 → PM 授权发布。最近一次完整例子：`docs/clients/cts/2026-10-18-natural-china-v4/README.md`，在分支 `origin/docs/cts-video-factory-106-handoff` 上（`git show origin/docs/cts-video-factory-106-handoff:<路径>`）。Tale 的旧工单模板在 `docs/clients/cts/2026-10-11-spring-2027-reel-orders/`（`TALE-r1` 到 `TALE-r4`）。自检表的格式看 `docs/clients/cts/2026-10-10-shanghai-reel-v5-15s-brief-and-selfcheck.md`。
- 音乐：Tale 曾因 BGM 里有人声出过事故（`docs/clients/cts/2026-10-16-tale-music-vocals-incident.md`，同分支，含「整库人声转写表」）。只用音乐目录里已登记、人声闸通过的曲目，并且真播放听一遍。Dropbox 里的视频 / 图片 / 音乐 PM 已确认有授权，不用再问授权。
- 素材库（Codex 旧线）：106 已把 Codex 旧的常驻同步任务（LaunchAgent `com.magiclab.media-intake-local`，每 30 秒扫目录，从 10-16 起一直静默失败）停掉了，配置文件还在。旧代码和 4 张未提交的台账卡在 `/Users/raydeng/Projects/magic-engine-media-storage`（从来没提交过）。**不要重启那个任务，不要动那个目录，不要往里提交**；周六 Claude 按「统一素材库方案」并入。

## 你要做的事

1. **配方对账**：只读查生产库 `viral_reference_library` 里旅游行业配方，输出一张「配方对账表」（配方每一列 → 这次做了什么 → 满足 / 未满足 / 不适用）。只靠改数字能满足的列不算数；真人出镜、真实感这类要换素材的列，要如实标「未满足」并说原因（我们没有肖像授权的真人）。
2. **选镜写分镜**：只用 `nc2_` 里标「可用」的兵马俑头像 / 铠甲，加库里已有的合规兵马俑镜头；每一镜写清来源文件和授权。
3. **工单**：要往生产库插一条工单。插之前把「要插什么」摆给 PM（客户 CTS、模板和工单文件路径、状态到待审为止、不发布、预计花费 0），PM 回 `插` 才插。
4. **渲染后自检**：抽 9 宫格逐镜缩略图，自己逐镜过一遍：① 画面对不对（是不是兵马俑，有没有糊）② 文字对不对（错别字、与官网原文一致）③ logo 完整清晰 ④ 真播放确认有声音、音乐无人声 ⑤ 时长 / 安全区 / 封面。填「分镜自检表」。
5. **质检**：你不能给自己做的片子签字。把成片路径 + 配方对账表 + 分镜自检表放进交接日志，状态写「待审」。默认等周六 Claude 的苏东坡 / 马良审；PM 若在你的窗口明确指定别的窗口代审，按他的指定办。
6. **过了质检才上传广告账户媒体库**：需要 PM 说 `传`。拿到 video_id 后写进交接日志的 `VIDEO_READY` 段（video_id、时长、尺寸、审过的人、日期），再告诉 PM 一句；74-Codex 靠这一段接力。上传是写 Meta，先只读确认你有写授权；没有就写明缺什么，周六 Claude 传。

## 这两天不要做

- 不发布到任何社媒（Facebook / Instagram / YouTube）；不上传广告库（除非第 6 条）。
- 不批量跑看图（OpenAI 刚充值，106 原计划先拿 90 条出片素材试跑看漏检率；要花钱，周六再定）。
- 不调用任何要付费的生成接口，不另写脚本直调 Muapi / WaveSpeed / Seedance；只用现有真实镜头。
- 不写「出片机素材放行闸」「统一素材库」等代码——它们牵涉发布闸，是 A 级，需要 Claude 两审；有想法记进「后续事项」。
- 不升级或重启出片机；不动 Supabase 的素材桶；不批量下载素材。
- 不动 106 号的 Claude 工作区 `/Users/raydeng/Projects/magic-engine/.claude/worktrees/magical-chatelet-25af10`。

## 记忆里该读的几份（目录见通用规则第二节第 5 条）

`playbook-social-general.md` · `feedback-viral-reel-recipe-over-montage.md` · `feedback-video-caption-short-big.md` · `feedback-cts-audience-older-slow-captions.md` · `feedback-reel-selfcheck-missed-no-audio.md` · `feedback-disable-higgsfield-use-muapi.md` · `project-social-video-i2v-muapi.md` · `reference-cts-remotion-local-project.md` · `feedback-cts-stock-video-library-mislabeled.md` · `project-pm-dropbox-music-licensed-ok-2026-10-05.md`

## 等 PM 的事（只在合适时机提，一次一个，带回法）

- 工单摆给 PM → 回 `插`。
- 质检过了、要传广告库 → 回 `传`。
