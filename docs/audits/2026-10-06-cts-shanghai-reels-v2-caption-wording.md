# CTS 上海周边团两条 Reel v2：换掉被判成「内部标签」的屏上字（2026-10-06）

风险级：B（客户私有参数 + 生产库建两张草稿工单；无代码改动、不发布、不排期、不碰广告、不动 `FACTORY_PUBLISH_LIVE`）。
授权：沿用 PM 2026-10-06 对这两条的「建单」授权范围，花费 0。层级门（Inline）：L4 客户配置，复用已有 remotion `list` 模板与审核自动检查，无新增能力。
前置：[首版交付说明](./2026-10-06-cts-shanghai-reels-factory-orders.md)（旧两张工单 `a0773341…` / `e2f92d54…` 保持原样未删）。

## 一、到底是哪些词被判到

提醒「字幕疑似内部标签冒充文案」**不是词表**：`src/lib/factory/content-quality-guard.ts` 把成片整段字幕（出片机拼的聚合串 + 各段）交给 AI 判断（Jev，`placeholder_leak` 题，分数 ≥ 0.5 报）。生产库里两张旧单实际送审的字幕：

`10 DAYS SHANGHAI +3 CITIES · THE TRIP 1/6 FLIGHTS INCLUDED · THE TRIP 2/6 … · THE TRIP 6/6 ENGLISH-SPEAKING GUIDE · SHANGHAI + 3 CITIES. FROM NZ$2,699 …`

- 被判的是 **`THE TRIP`**：模板把 `itemLabel` 每条都拼进字幕，同一个泛词重复 6 次，正是那条题目点名的强信号。
- 其余屏上字（`10 DAYS` `SHANGHAI` `+3 CITIES` 六个条目 `SHANGHAI + 3 CITIES.` `FROM NZ$2,699` `PER PERSON · TWIN SHARE` `FREE CHANGES UP TO 60 DAYS PRE-DEPARTURE` / `DEPARTS 25 MARCH 2027` `VISA: …`）都是具体事实，没有单独被判到的证据。
- 如实说明：生产库里只有冲刺款（`e2f92d54…`）带这个标记，常年款（`a0773341…`）没有——分数在 0.5 线附近波动。

## 二、换了什么（旧 → 新，出处）

| 屏上位置 | 旧 | 新 | 出处 |
|---|---|---|---|
| 每个条目上方小字（`itemLabel`） | `THE TRIP` | `INCLUDED` | 官网行程页「What's Included」/ 导航「Inclusions」；官网 Included 列表 = 机票、酒店、英语导游、门票与行程内餐食、地面交通 |
| 条目 1 | `FLIGHTS INCLUDED` | `FLIGHTS FROM AUCKLAND` | 官网「International and domestic airfares」+ 第 1 天「Auckland — Shanghai」；换它只是避免新标签读成「INCLUDED 1/6 FLIGHTS INCLUDED」 |

价格、日期、行程、正文 caption、尾卡均未改。

## 三、候选与选择依据（用同一个 AI 接口、同样的字幕结构本机复算，每个 3 次，只是对比用）

| 标签 | 分数 | 说明 |
|---|---|---|
| `THE TRIP`（旧） | 0.37–0.45 | 本机复算压不到线上 ≥0.5 的结果，说明线上送审的原文比我重建的略不同，**不能把本机分数当线上分数** |
| `WHAT'S INCLUDED`（官网原标题） | 0.39–0.45 | 与旧的差不多，没有实质改善 |
| `YOUR ROUTE` / `YOUR JOURNEY`（官网原话） | 0.45–0.46 | 同上 |
| **`INCLUDED`（选）** | **0.23–0.30**（连同条目 1 改动） | 明显最低；是官网「What's Included」的短写，且是对客人有意义的话 |

**已知口径折中**：官网 Included 列表里没有单列外滩、水乡、南京路这三处——它们是行程停靠点（门票按行程含）。放在 `INCLUDED` 下读作「行程包含」，南京路官网写明「晚餐自理」，所以南京路只表示「行程含到访」。若 PM 觉得不稳，备选是 `ITINERARY`（官网「Day by day」，分数 0.39–0.42，没有明显改善）。

## 四、新工单与结果（当场试跑）

| 项 | 常年款 E3 v2 | 冲刺款 S3 v2 |
|---|---|---|
| 工单号 | `09e26e9e-8396-4583-a3b1-87eed6e34133` | `770ab18a-46c5-43ec-b56c-1ce66814291e` |
| 建单 | 2026-10-06 03:36:42 UTC，SQL 直插，`queued`，`budget_cap_usd=0.5`，只挂目标 `287dc046…`（草稿态，没动） | 同左 |
| 出片机领单 | 03:36:59 UTC 领走（常驻出片机，`--loop`） | 03:38:16 UTC 领走 |
| 渲完 | 03:37:44 UTC（约 45 秒） | 03:39:00 UTC（约 44 秒） |
| 终态 | `in_review`，`actual_cost_usd=0`，`redline_hits=[]` | 同左 |
| 体检 | 7 项自动检查全 PASS（音轨、1080×1920 / 14.549 秒、字幕 8 条时序、封面非空白、Reel 格式、CTA 在首评、首评链接带追踪参数） | 同左 |
| 质量标记 | 只剩 `narrator_voice_mismatch`（口吻，PM 2026-10-05 已书面接受第三人称，未改口吻） | 同左；**`placeholder_caption`（内部标签）已消失** |

旧两张工单仍在审核队列，审核人请只看新两张。**没有发布、没有排期、没有动广告。**

## 五、分镜自检（逐镜看的是从存储里取回的上传成片本身，14.549 秒、有音轨，9 个时间点 0.4/3.1/4.3/5.5/6.7/7.9/9.1/11.0/14.0 秒）

| 格 | 图 | 字 | logo |
|---|---|---|---|
| 0.4s | 外滩天际线 + 客人团照（压 y1248 线，沿用旧版已知问题） | `10 DAYS / SHANGHAI`（`+3 CITIES` 此刻还在入场动画，后面帧出现） | 无（设计如此） |
| 3.1s | 上海日景天际线 | `INCLUDED 1/6 FLIGHTS FROM AUCKLAND` ✅ | 无 |
| 4.3s | 江南水乡运河 | `INCLUDED 2/6 ANCIENT WATER TOWNS` ✅ | 无 |
| 5.5s | 外滩夜景、东方明珠 | `INCLUDED 3/6 THE BUND, SHANGHAI` ✅ | 无 |
| 6.7s | 虚化夜景（刻意虚化） | `INCLUDED 4/6 7 NIGHTS OF HOTELS` ✅ | 无 |
| 7.9s | 夜间步行街（素材库名「南京路」，地点无独立证据，沿用旧版已知问题） | `INCLUDED 5/6 NANJING ROAD` ✅ | 无 |
| 9.1s | 客人走在巷子里，画面看不出有导游（沿用旧版问题） | `INCLUDED 6/6 ENGLISH-SPEAKING GUIDE` ✅ | 无 |
| 11.0s | 价格页，上海日景底 | `FROM NZ$2,699 / PER PERSON · TWIN SHARE` + E3 `FREE CHANGES UP TO 60 DAYS PRE-DEPARTURE` / S3 `DEPARTS 25 MARCH 2027` + `VISA: …` ✅ | 无 |
| 14.0s | 同上 | 同上 | 完整清晰（右上偏左的大药丸） |

没有新增问题；首版交付说明里列的模板问题（下半屏偏暗、价格出现太晚、价格框边距、logo 偏大、没人听过音乐）**这次没动，仍然存在**，仍不能当可直接发布的成片。

## 六、没做 / 没证实

- 没有改模板、审核规则或口吻（按任务范围）。
- 本机 AI 打分只是相对比较，**不能证明线上这个标记绝不会再出现**；线上这次实际结果是已消失（上表），但它在 0.5 线附近波动，审核人看到再出现请不要当事故。
- 参数文件：`E3v2.*` / `S3v2.*`（本目录）；旧文件原样保留。

## 六之一、素材来源核对（PM 2026-10-06：Dropbox 里的素材都有授权，不再写授权待补）

| 素材 | 来源 | 说明 |
|---|---|---|
| 条目 1/3/5 与价格页之外的库存视频：`shanghai_35473020.mp4`、`v_watertown_27958758.mp4`、`v_bund_36546365.mp4`、`v_nanjingroad_35646223.mp4` | Dropbox `MagicLab_Studio/CTS/footage/stock/` | 见 `build-clips.sh` |
| 配乐 `momentum.mp3` | Dropbox `MagicLab_Studio/Music/Building Momentum.m4a` | 同上 |
| `item2_aerialnight.mp4`（= `s1_shanghai_aerial_night.mp4`） | 本机 `cts-remotion/public/clips/`；**SHA-256 `b227bbb4…0e012e` 与 Dropbox `MagicLab_Studio/CTS/remotion-assets/clips/s1_shanghai_aerial_night.mp4`、`CTS/output/christmas-sample-20261004/clips/s1_shanghai_aerial_night.mp4` 字节完全相同** | 文件在 Dropbox 里；它最早从哪来我没有更上游的记录，但按 PM 口径 Dropbox 内即视为已授权 |
| 价格页底 `price_shanghaiday.mp4`（= `s7b_shanghai_day.mp4` 循环） | 同上，SHA-256 `bb9424dc…369285`，Dropbox `CTS/remotion-assets/clips/s7b_shanghai_day.mp4`、`CTS/output/christmas-sample-20261004/clips/s7b_shanghai_day.mp4` 字节相同 | 同上 |
| 团照 `group-shanghai-bund-skyline.jpg`、`group-walking-shanghai-lane.jpg` | CTS 自己官网图（`chinatravel/public/blog`） | 非 Dropbox，客户自有，统筹窗口确认不用管 |

## 六之二、价格口径与「3,399 划掉」评估（本轮不做）

- 两张新工单片内价格 = NZ$2,699，片内与正文不含 3,399。
- 本 PR 把 `config/clients/cts/offerings.yaml:170` 的 `price_nzd` 3399 改为 2699（该文件当前无生产调用方，见 `docs/clients/cts/2026-10-06-shanghai-surroundings-price-bot-sync.md`，`offerings-loader` 43 项测试本机通过）。
- 生产库 `clients.factory_config.render.creatomate.offers['shanghai-surroundings'].price_line` 仍是「7 Nights · From NZD $3,399 pp」：由统筹窗口改，本窗口不动库。历史文档与测试夹具里的 3,399 是历史记录，不改。
- 「3,399 划掉」样式（PM 说「可以」非「必须」）：需要出片机仓库 `engines/remotion/src/schema.ts` 的 `price` 加可选旧价字段 + `ListReel.tsx` 价格块加划线样式 + 校验（旧价必须大于现价、必须有官网出处）+ 测试，**中等改动**，且「划掉旧价」属于价格声明，发布前须逐字核官网当时价。这一轮不做，PM 要再说。

## 六之四、出片机更新与「logo 常驻」两张新工单（统筹窗口授权，2026-10-06）

出片机更新（`magic-engine-worker` 检出，常驻进程 `com.magicengine.factory-worker`）：
- 更新前：`7b3cc092f`（分离头，进程 03:40 起）。更新后：`12ffc388e`（= PR #2313 合并提交；与旧版相比 `scripts/factory-worker` 另带入 `bb1bc7658` 蒙太奇补丁，只影响 montage 模板）。
- 时机：更新前查过库，没有 `queued/claimed/producing` 工单（没打断在渲的单）。
- 做法：`git checkout --detach 12ffc388e` + `launchctl kickstart -k gui/<uid>/com.magicengine.factory-worker`（第一次检出因提交未拉取失败，进程只是按原版本重启了一次，随后拉取成功再换版本重启）。
- **回退**：在该检出里 `git checkout --detach 7b3cc092f6e8e83e173d811c7227539440b7f0a2`，再 `launchctl kickstart -k gui/$(id -u)/com.magicengine.factory-worker`。
- 重启后读回：日志 03:54:31 `worker 启动 … loop=true`，之后每 30 秒 `无 queued 工单,等待…`，并成功领走并渲完下面两张单；`FACTORY_REMOTION_CLIENT_IDS` 已配置（CTS 之前的 4 张 remotion 单都被领走即证明），本窗口没有读 `.env`。

四张「v2」工单现状（全部草稿，`in_review`，花费 0，只剩已被 PM 接受的 `narrator_voice_mismatch`）：

| 工单号 | 款 | logo | 7 项自动检查 |
|---|---|---|---|
| `09e26e9e-8396-4583-a3b1-87eed6e34133` | 常年款 E3 v2 | 最后 2 拍 | 7/7 PASS |
| `770ab18a-46c5-43ec-b56c-1ce66814291e` | 冲刺款 S3 v2 | 最后 2 拍 | 7/7 PASS |
| `a13cbd09-7c7b-4f07-bf4d-97b78094e8fd` | 常年款 E3 v2 | **常驻**（`logoMode: always`） | 7/7 PASS |
| `e01c44d6-2080-4da1-b132-1297e8396ac3` | 冲刺款 S3 v2 | **常驻** | 7/7 PASS |

旧两张（`a0773341-6cad-4ce8-bcd8-a7f0c310aa8d` / `e2f92d54-68c2-4d58-8c27-6c464483c972`，`THE TRIP` 版）原样保留。常驻版工单是 03:55:35 / 03:56:49 UTC 被更新后的出片机领走，03:56:17 / 03:57:29 渲完（约 41 / 40 秒）；从存储取回 `a13cbd09…` 的成片，14.549 秒，第 0.4 秒起 logo 就在画面（已看图）。

**判定更优的「常驻」版就是上表后两张**（参数文件 `E3v2-logo-always.order.json` / `S3v2-logo-always.order.json`）；审核时请把常驻版放前面，最后 2 拍版留作对照。logo 缩小 / 变淡 / 下移的后续见台账卡 `2026-10-06-cts-reel-logo-shrink-fade-lower-followup`（决定权在 PM，到 2026-10-13）。

## Reuse Statement

- 复用：remotion `list` 模板与 `parseListReelProps` 校验（两份新 props 本机通过）、出片机 `--loop` 常驻进程、既有审核自动检查与 `content-quality-guard`；无新增代码。
- platform-shared：无新增。industry-specific：无。client-specific：两份 v2 props / 订单参数、两张工单（全部在客户私有目录与生产库工单表）。
- 没有把客户名、价格、行程写进任何 shared runtime。
- 实现落点与 tier-gate 决策时分类（L4）一致。
