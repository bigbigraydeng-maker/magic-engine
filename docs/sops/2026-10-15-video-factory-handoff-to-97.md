# 视频工厂交接单（106 → 97）· 2026-10-15

> 106 号（CTS 专职出片）交给 97 号（社媒统筹）。以后 Reel 向视频工厂下单由 97 负责。本文是现状，不是计划；每条都带出处，读不懂的地方先看「出处」列。

## 1. 现状（一句话）

出片线能用：出片机（一台 Mac）每 30 秒领一次工单，用 Remotion 渲 1080×1920 竖屏片，传到存储桶，工单到 `in_review`，由苏东坡（文案/事实）+马良（画面/声音）审，PM 授权后才发布；**出片人不发布、不自己点接受**。10-15 当天已出：丝路 / Panorama / 3 月团三条的「无价格版」，均到待审。

## 2. 怎么下单（最短路径）

1. 用官网当天的团页核事实（WebFetch 团页，逐句记原话；价格、日期、含项、酒店写法都以当天为准）。
2. 写一份 `postcard` 工单 JSON（样例：`docs/clients/cts/2026-10-15-silk-panorama-reel-orders/*.order.json`），先用引擎校验：在出片机检出目录里 `node` 直接 import `scripts/factory-worker/engines/remotion/src/templates.ts` 的 `loadTemplate('postcard', props)`，不报错再下单。
3. 把工单插入 `content_work_orders`（`status='queued'`，`budget_cap_usd=0.5`，字段照已有工单抄；近期工单 id 见各 README）。
4. 出片机 30 秒内领单，一条约 1–2 分钟；成片在存储桶 `content-factory/renders/<client_id>/<工单号>/final.mp4`。
5. 自检：抽 9 宫格（逐镜看图/字/logo/安全区）+ `volumedetect` 或 ebur128 看有声音；自检图和说明写进 README，再回统筹派审。
6. 下单前先查 `content_work_orders` 没有 `queued/claimed/producing`（尤其升级出片机前）。

## 3. 模板能力与限制

| 模板 | 用途 | 限制 |
|---|---|---|
| `list`（清单） | 旧版：钩子 + 3 个条目（带 N/N 计数、对勾方块、进度条）+ 价格页 | 价格页必填；钩子逐行弹出，第 0 帧不完整；版式固定，**CTS 所有旧片都是它，PM 说「雷同」** |
| `postcard`（明信片，PR 2672/2674） | 一句话一景：钩子（第 0 帧完整）+ 2–4 景（地点小字 + 一句话，下半部半透明卡）+ 片尾（价格卡**或**纯标题卡） | 最短约 11 秒；每景 ≥3 秒；钩子每行 ≤8.7 字宽单位（约 9 个大写字母）；一句话 ≤25 单位；**价格不上屏时用 `price: null` + `end{backdropClip,title}`**；见 `scripts/factory-worker/engines/remotion/README.md` 明信片一节 |
| `montage`、`datacard` | 蒙太奇 / 纯数字卡（东际用） | 蒙太奇快切，对中老年不友好 |
| Story 变体（**未做**） | 6 秒单景 + Story 安全区 | 设计稿见 `docs/specs/2026-10-15-postcard-story-variant-design.md` |

postcard 的机器闸（`src/postcard.ts`）：字宽限长；禁词（限时/截止/早鸟/倒计时/仅剩/名额/limited places/last chance… 英文整词匹配）；**画面文字里不许出现价格**（`priceMentionHits`）；每景必须带 `sourceUrl` + `sourceQuote`（官网原句）+ `placeSourceQuote`，且原句要含这句话至少一半的主要词。**这只证明「填了且相关」，不证明官网真有这句话**——事实核对仍靠人工与苏东坡。已知仍能绕过的写法：`Prices from 1999`、`just 1999 dollars`、`Under 2000`、`Ends tonight`、`Almost sold out`（无货币符号/未收词）。

## 4. 曲库与近期用曲（避免撞曲）

目录：出片机素材目录 `~/Dropbox/MagicLab_Studio/CTS/remotion-assets/music/`（目录目录表 `engines/remotion/catalog/music.json`，原始库 `~/Dropbox/MagicLab_Studio/01_Platform/music/` 与 `…/shared/music/`）。

| 曲 | 近期用在（2026-10） |
|---|---|
| founders-at-dawn | 大量旧片（BoC/Tale/Natural China 等，已发布版也用）——**不要再用** |
| momentum / momentum_q | Tale#2 旧版、丝路 A、Silk 早期 |
| jade_river_journey / _q | Shanghai#2 旧版、Panorama 早期 |
| road-afar（远方的路） | 丝路 A/A2（559e801c/41f64daa） |
| feel-good-travel | Panorama A/A2 |
| horizons-breath | 丝路 postcard v1/v2（cd43bb66/4bd78644） |
| horizons-call | Panorama postcard v2/v3（94edbe0f/00f23d78） |
| second-hand-sunrise(_n) | BoC#2 v1/v2 |
| analytical-scholar(_n) | Tale#2 v1/v2 |
| sunlit-kitchen-window(_n) | Shanghai#2 v1/v2 |
| 未用过 | celadon-echo（青瓷回声，高能量中国乐器）、dragon-banner、vinyl-groove、building-momentum 等（多数偏高能量，不适合中老年） |

**响度坑**：出片后成片响度≈曲子前 15 秒响度 −1~1.5dB。`_n` 结尾的是做过响度归一的副本（前 15 秒约 −16 LUFS，目标成片约 −17）；原曲 analytical-scholar 前 15 秒只有 −22.5 LUFS，直接用会偏低 6dB。新曲先用 `ffmpeg -t 15 -af ebur128` 量前 15 秒再决定增益。曲子目前没做节拍对齐（`beats_unverified`），剪点与鼓点不一定对上。

## 5. 素材与授权状态

- **CTS 目前没有任何确认过授权的实拍**（10-13 盘点；10-15 74 号复核）。结论：**画面里不出价格**（价格只放首评）；景点画面只用 Unsplash/Pexels 免费授权图，不冒充团友实拍，不当作客户真实产品/价格画面。
- 素材目录 `~/Dropbox/MagicLab_Studio/CTS/remotion-assets/clips/`（成片片段）与 `…/footage/photos/`（原图）。来源登记：`clips/credits-v6.json`（早期）、`credits-v7.json`（丝路丹霞/嘉峪关）、`credits-v8.json`（莫高窟/月牙泉/天池，Pexels），原图与 `SOURCES.json` 在 `footage/photos/silk-road-2026-10-15/`。
- 可用且地点已核对：长城（金山岭/怀柔/航拍）、故宫航拍、天坛/天安门/故宫俯瞰（本地 Unsplash 照片）、兵马俑（两张不同）、大雁塔、嘉峪关要塞、张掖丹霞、莫高窟、月牙泉、天山天池、熊猫基地、西湖亭子、外滩（白天/夜）。
- **认不准地点**：`c4_westlake_boats`（实为白墙民居+乌篷船小河道，已不当西湖用）、`v2b_suzhou_garden`（只能写「A garden in Suzhou」）、`c3_xiancitywall_a`（看着是南京城门，不是西安城墙，别用）。
- 缺：火焰山（吐鲁番）、乌鲁木齐市集、鸣沙山骆驼队等——等 74 号向 CTS 要实拍，到了会放进 `Dropbox/Magic Engine/by-client/01_CTS_Tours/` 新目录。
- 下载任何新图要 PM 本人在聊天里点头（不能靠别的窗口转述）。工厂自带的图库线 `stock-harvest` 是 Apify 抓 Pinterest（付费、许可与地点不可靠，9/08 PM 已暂停），**不要用**。

## 6. 出片机运维坑（都踩过）

1. **运行方式**：开机自启 `~/Library/LaunchAgents/com.magicengine.factory-worker.plist`（`node --env-file=…/scripts/factory-worker/.env worker.mjs`），代码在 `~/Projects/magic-engine-worker`（脱离分支的检出）。日志 `~/Library/Logs/magicengine-factory-worker.log`；活着的证据：线上 `cron_run_logs` 里 `factory-worker-alive` 每 30 秒更新，`client_ids` 应含 CTS、Oztop、东际。
2. **环境变量被自启文件盖住**：`--env-file` 不覆盖已存在的环境变量，所以 plist 里写死的 `FACTORY_WORKER_TARGET_CLIENT_ID` / `FACTORY_REMOTION_CLIENT_IDS` 会让 `.env` 失效。现在 plist 里没有这两项，由 `.env` 管（`FACTORY_REMOTION_CLIENT_IDS` = CTS+东际；TARGET 行已删）。线上还有白名单 `FACTORY_WORKER_CLIENT_IDS`（Render 上，改完要**手动重新部署**才生效）。
3. **升级出片机**：等 PR 合并 → 查库没有 `queued/claimed/producing` → `git fetch` 后 `git checkout --detach <合并提交>` → `launchctl kickstart -k gui/$(id -u)/com.magicengine.factory-worker` → 读日志「worker 启动…」+ 每 30 秒轮询 + 心跳。回滚=换回旧提交再重启。改 `.env` 前先 `cp -p .env .env.bak-<时间>`。
4. **新模板要先升级出片机再建单**：旧版出片机不认识 `postcard`，会拒收。
5. **Dropbox 仅云端（最大的坑，PR 2679 只解决了一半）**：素材目录里的大文件会被 Dropbox 转成「仅云端」（`ls -lO` 显示 `dataless`），回收很快（几分钟到不到 1 小时，一次 42 个）。出片机是开机自启的后台程序，**没有权限唤醒这类文件**（读取报「Unknown system error -11」/Operation not permitted，用同样启动方式实测过）。PR 2679（2026-10-15 合并，提交 ccddfee15）的作用是：把「缺少素材文件」和「素材在目录里但读不出来」分开报，**不是**自动唤醒成功。**实用办法**：下单前先在交互窗口把目录读回本机：`find ~/Dropbox/MagicLab_Studio/CTS/remotion-assets -type f -flags +dataless -print | while read f; do cat "$f" >/dev/null; done`，并尽快下单；已因此进过死信的工单：1f2b1f3b、e5665cce、83ecbf77、def49e91、7e403846（都已用相同内容重提）。**根治三选一（需决定）**：①在 Dropbox 里把 `CTS/remotion-assets` 设成「始终保留在本机」（界面里点一下）；②把出片机的素材目录换到不在 Dropbox 的本机目录并同步；③研究让后台程序拿到唤醒权限（没把握）。台账卡 `docs/ledger/2026-10-15-factory-worker-dropbox-dataless-assets.md`、`2026-10-15-factory-worker-wake-cloud-assets.md`。

5b. **已采用方案②：出片机读本机镜像（2026-10-16）**：出片机的素材目录现在是 `~/Library/Application Support/magicengine/studio/`（不在 Dropbox，不会被回收），含 `CTS/`、`East_Inter/`（各有 `brandkit`、`remotion-assets`）、`_shared/music` 与 `MIRROR-MANIFEST.json`；出片机 `.env` 里 `STUDIO_ROOT` 指向它。**铁规矩：新素材（新片段、新音乐、新 logo）入 Dropbox 后，下单前必须同步一次镜像**，否则出片机找不到文件。同步办法（在交互窗口跑）：先把 Dropbox 里新文件读回本机（上面第 5 条的 `cat` 办法），再 `rsync -a ~/Dropbox/MagicLab_Studio/CTS/remotion-assets/ "$HOME/Library/Application Support/magicengine/studio/CTS/remotion-assets/"`（音乐同理到 `_shared/music`），最后重建 `MIRROR-MANIFEST.json`。镜像文件清单样例：`docs/clients/cts/2026-10-15-silk-panorama-reel-orders/worker-mirror-manifest-2026-10-16.json`。
6. **同一台 Mac 睡着/合盖**：出片会停；心跳超 10 分钟工单会被收回；目前没有「队列空时挂了」的报警（只有队列有活没人领约 6 小时后的待办），设计见 `docs/ledger/2026-10-14-factory-worker-single-mac-unmonitored.md`。
7. **只有一台出片机**：东际和 CTS 同时排队时东际优先（18 号口径）。

## 7. 复审口径（苏东坡 / 马良 常挑的）

- 文案：每句必须能在官网指出来源；不写日期（官网与出发表有一天误差的团）、不写价格（画面/文案）、不写小费/免签/车次、不写具体酒店（只写 sample hotels or similar）、不暗示站点与行程日的绑定（不要写 Day N）、不用「Early Bird」。
- 画面：第 0 帧封面干净；对比度（白字压浅色天空）；文字卡不盖主体；安全区 y 270–1248、右侧 120px 不放字；片尾标题不折成一个孤字；同周三条之间素材/BGM 不重复。
- 声音：成片要有声音；响度约 −17 LUFS。
- 质检标记 `narrator_voice_mismatch` 是无旁白片的已知误报（简报要求第一人称 Baker Gu，本片无旁白，且不替真人编亲身经历）；要处理它得先把质检改成「无旁白清单/明信片跳过口吻检查」（未做）。

## 8. 在飞与欠账

| 项 | 状态 |
|---|---|
| 3 月团三条 v2：def49e91（BoC）/ abd7a705（Tale）/ 83ecbf77（Shanghai） | 已提交，出片/自检见各 README；首评草稿 `first-comments-march-tours-draft.md` 待苏东坡核价 |
| PR 2679（出片机素材唤醒 + 缺失/读不出来分开报） | 等自动合并；合并后升级出片机 |
| Story 变体 | 只有设计稿，未实现（`docs/specs/2026-10-15-postcard-story-variant-design.md`），要子牙+魏征复核后派 DeepSeek |
| 质检口吻误报 | 未改（见 7） |
| 出片机空队列挂了不报警 | 台账卡已记，暂不做 |
| 实拍图（火焰山/乌鲁木齐/鸣沙山） | 等 74 向 CTS 要 |

## 9. 文档位置

`docs/clients/cts/2026-10-15-silk-panorama-reel-orders/`（README 十六节自检记录、各工单 JSON、自检图、素材来源 JSON）· `docs/specs/2026-10-15-remotion-postcard-template-design.md`（设计 v3）· `scripts/factory-worker/engines/remotion/README.md`（模板说明）· 社媒手册 `playbook-social-general.md` 第二十二节（清单模板出片实战；其中「出片机更新流程」仍有效）。
