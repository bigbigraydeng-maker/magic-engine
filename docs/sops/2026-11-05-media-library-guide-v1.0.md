# 素材库功能介绍 v1.0（2026-11-05）

> 给谁看：PM（前四节）+ 任何要用素材的 agent / 开发窗口（第五节起）。
> 负责人：马良（`docs/agents/60-maliang.md`）。本文所有数字为 2026-11-05 实查，过期请重查，不要照抄。

---

## 一、先说结论：现在 ME 里有三个地方叫「素材库」，彼此不通

| | ① Dropbox 素材库（马良管） | ② ME 后台「素材库」标签 | ③ 新系统素材库 |
|---|---|---|---|
| 入口 | Dropbox `MagicLab_Studio` 文件夹，没有网页 | 后台客户页 → 「素材库」标签，路径 `/dashboard/clients/<客户ID>/assets` | `portal.magicengine.com.au/portal/media`（要登录） |
| 主要放什么 | 视频为主（免费图库视频、实拍片段、音乐） | 图片为主（FDE / 客户上传的照片） | 图片为主（客户官网、社媒、Unsplash、上传） |
| 谁在用 | 出片机（做 reel） | 每日计划图文帖、批量出 reel、价格说法检查 | 客户自己、新系统的内容工厂 |
| 有没有「能不能用」审核 | **有**：使用权 + AI 看图（品牌 / 小孩 / 人脸 / 水印）+ 画质 | 有 AI 打标签和来源标记，没有使用权审核 | 没有 |
| 现在有多少 | 登记 500 条，**放行 40 条**，待人工 460 条 | CTS 70、Oztop 38、NM Medspa 25、Magic Picks 10、East 7、其他 3 | HBay 0 张（另有 13 张 AI 推荐图待收下） |

**以哪套为准还没定**，是 PM 待拍板项。没定之前三套各管各的：不要把一套里的素材手抄进另一套，也不要说「素材库里有」却不说是哪一个。

---

## 二、① Dropbox 素材库：一条素材从进来到能用

```
放进 00_Inbox  →  登记（算指纹、记来源、传一份到私有存储）  →  审核  →  放行清单 / 待人工清单
                                                                        ↓
                                                         出片和广告只从放行清单里挑
```

- **文件夹**（详见 Dropbox 里的 `00_START_HERE.txt`）：
  - `00_Inbox` 新素材待入库
  - `01_Platform` 全平台通用（音乐、通用品牌资源）
  - `02_Industry` 行业图库（如旅游）
  - `03_Enterprise` 各客户专属
  - `99_Catalog` 全部登记和审核记录
- **放进 Inbox 不会自动入库**：自动入库那个后台任务从 10-22 起就没在跑，现在要有人手动登记（命令见第五节）。
- **审核怎么判**（规则写在 `scripts/media-library/review-policy.json`）：
  - **使用权**：Pexels / Unsplash / Pixabay 的免费素材按政策自动认可（PM 11-04 同意）。付费素材、搜索结果页来源、登记时写着「待审核」的，一律转人工。
  - **画面**：AI 看图，检查别家品牌、能认出的人脸、小孩、水印。用的是 Haiku 5.5，放行的那批再请 Sonnet 5.5 复看一遍（PM 11-04 同意让 AI 查）。
  - **画质**：短边至少 1080 像素，视频至少 3 秒。
- **放行 ≠ 发布授权**。放行只说明「这条素材本身可以被自动挑来用」。成片发不发，仍走原来的审查和 PM 授权。

### 现在的数字（2026-11-05）

- **放行 40 条**：
  - 全部属于 Magic Lab Class 这个客户，主题是新西兰日常生活和北岛自驾。
  - 37 条竖版，3 条横版。
  - **CTS 和旅游行业目前 0 条登记**，所以出片机给 CTS 用的片段还都没过这套审核。
- **待人工 460 条**。一条可能同时卡在好几个原因上，主要原因有：
  - 登记时标了「待审核」：374 条
  - 有别家品牌：287 条
  - 能认出人脸：182 条
  - 来源是搜索结果页：91 条
  - 可能是裁过的版本：63 条
  - 有小孩：54 条
- **AI 看图花费**：累计 2.23 美元，总上限 10 美元。到上限后工具会自己停，不会超支。

---

## 三、PM 日常怎么管

| 频率 | 做什么 | 怎么做 |
|---|---|---|
| 每天 | **什么都不用做** | 每天早上 8 点，本机会自动把 Dropbox 里各客户的出片素材补给出片机。日志在 `~/Library/Logs/magicengine-studio-mirror-sync.log`，看最后一行 `failed` 是 0 就是正常。 |
| 有新素材时 | 放进 Dropbox `00_Inbox` 对应的子文件夹，然后跟马良 / 开发窗口说一句「入库」 | 放进去不会自动登记，必须有人跑登记和审核。 |
| 每周一次（建议） | 问一句「放行清单多了几条、待人工还剩几条」 | 数字就在 `99_Catalog/approved-selection.json` 和 `review-queue.json` 里，窗口能直接读出来。 |
| 要花钱时 | 只在 AI 看图会花钱 | 每次跑都带金额上限，累计上限 10 美元；要提高上限，需要 PM 本人同意。 |

**还没定、等 PM 拍板的两件事**：
1. 待人工的 460 条由谁来看（台账卡 `docs/ledger/2026-11-04-media-library-review-queue-460.md`，负责人目前写的是 PM）。
2. 三套素材库以哪套为准。

---

## 四、② 和 ③ 两个网页版素材库怎么进

- **② ME 后台**：进后台，打开某个客户，左边栏点「素材库」，路径是 `/dashboard/clients/<客户ID>/assets`。
  - 能上传图片，AI 会自动打标签。
  - 每日计划图文帖、批量出 reel 都从这里取图。
  - 来源分类写在 `src/lib/assets/provenance.ts`：客户自有 / 图库 / AI 生成等。
- **③ 新系统**：`portal.magicengine.com.au/portal/media`，按客户分开。
  - 能从客户官网、Facebook、Instagram 导入，也能搜 Unsplash，还有 AI 推荐图。
  - 只能改标题和标签。删除算高风险操作，要客户确认。
  - 代码不在本仓库里，本仓库的窗口只能通过新系统的连接口读写，改不了它的代码。

---

## 五、其他 agent 怎么用（① Dropbox 素材库）

以下 `<库>` 指 `~/Dropbox/MagicLab_Studio`，命令都在仓库根目录跑。

### 1. 挑素材（只读，最常用）

- **只从 `<库>/99_Catalog/approved-selection.json` 里挑。**
  - 不在这张清单上的素材，不许被自动选用。要用就先走审核，或者转人工。
- 每条记录里能直接用的字段：
  - **能不能用、怎么用**：`eligible_portrait` / `eligible_landscape`（能不能竖用 / 横用）、`restrictions`（使用限制，如 `no_resale_as_is`）。
  - **署名和出处**：`source_url`、`author_or_rightsholder`。
  - **内容和画面**：`tags`（主体、镜头、动作、季节、有没有人）、`duration_seconds`、`width` / `height`。
  - **归属**：`scope` / `scope_key`（属于哪层、哪个客户）。
  - **找原件**：`bucket` / `object_path`（私有存储里的位置）。
- **别跨客户用**：`scope: enterprise` 的素材只给 `scope_key` 对应的那个客户用。platform / industry 层的才能跨客户。
- `location` 是 `unverified` 的，不许在文案里说「这是某某地」。
- 清单最上面的 `note` 写着：放行不等于发布授权。成片照常走审查和发布授权。
- **现状**：主干上还没有任何代码自动读这张清单（2026-11-05 查过）。现在是 agent 读清单后，自己把文件放进出片目录。

### 2. 交给出片机

- 把选中的文件放进 Dropbox `<库>/<客户>/remotion-assets/`。每天 8 点会自动同步到本机的出片机目录。急用可以手动同步一次，说明见 `scripts/factory-worker/launchd/README.md`。
- 模板参数里要写明用哪个文件名（`props.clip`），出片机不会自己挑。
- 出片机认哪些客户目录，由它的设置 `FACTORY_CLIENT_STUDIO` 决定（`scripts/factory-worker/worker.mjs`）。2026-11-04 查的时候只有 CTS 和 East_Inter 两个；新客户要先在这个设置里加一条，否则出片机会报错停下。

### 3. 登记新素材

```bash
node scripts/media-library/manage.mjs import <库> <钥匙文件路径> <scope> <key> <素材文件> <metadata.json>
```

- 登记表模板在 `<库>/99_Catalog/intake-templates`，填写规矩见 `<库>/99_Catalog/素材采集与入库规范.txt`。
- 单个文件上限 50 MiB，大原片留在 Dropbox。
- **不要随手跑** `automation-cli.mjs scan` / `watch`：它会重写整个 Dropbox 的总目录 `inventory.json`。详见 `scripts/media-library/AUTOMATION.md`。
- 钥匙文件只把路径传给命令，不许读出来、不许贴进对话。

### 4. 审核（会花钱，先问预算）

```bash
# AI 看图：只看还没看过的素材，花费有上限
node scripts/media-library/vision-check.mjs <库> --env-file <钥匙文件路径> --budget-usd 1 --limit 20
# 先预演：只打印结果，不写任何文件
node scripts/media-library/review.mjs <库>
# 确认无误再写：只写审核结果、放行清单、待人工清单和运行记录
node scripts/media-library/review.mjs <库> --apply
```

- 审核**不会改**原始登记记录（`asset-records`），只写四样派生文件：`asset-reviews/`、`approved-selection.json`、`review-queue.json`、`review-runs/`。
- 已经看过、而且看图要求没变的素材会自动跳过，重跑不会重复花钱。弱一档的模型也不会覆盖强一档模型的结论。
- 连续 3 次服务出错会自动停；累计花费到 10 美元也会停。
- 改了看图要求（`vision-prompt.mjs`）后，所有旧结论都会失效，必须重看。重看之前先跟 PM 讲清会花多少钱。
- 设计稿：`docs/specs/2026-11-04-media-library-auto-review-v0.3.md`。

### 5. 测试

```bash
npx vitest run scripts/media-library
```

---

## 六、还没做的（按设计稿顺序，每项开工前先跟 PM 讲清楚）

1. **CTS 那 90 段出片片段还没登记**，所以没经过审核。下一步打算先登记并审核它们，预计花费不超过 1 美元，等 PM 点头。
2. **出片机和 ME 后台还不会自动从放行清单里挑片**。
3. **用完不会回写「这条素材用在了哪条成片里」**：登记记录里有 `used_in` 字段，但目前是空的。
4. **三套素材库的来源分类各写各的。** 要统一时，以 `src/lib/assets/provenance.ts` 为准，不要再造第四套。

## 七、相关文件

- 工具和说明：`scripts/media-library/`（`AUTOMATION.md`）
- 审核规则：`scripts/media-library/review-policy.json`
- 每天同步给出片机：`scripts/factory-worker/tools/sync-studio-mirror.mjs`，定时说明在 `scripts/factory-worker/launchd/README.md`
- 台账卡：
  - `docs/ledger/2026-11-04-media-library-tool-into-repo-owned-by-maliang.md`
  - `docs/ledger/2026-11-04-media-library-auto-review-40-approved.md`
  - `docs/ledger/2026-11-04-media-library-review-queue-460.md`
  - `docs/ledger/2026-11-04-factory-studio-mirror-daily-sync.md`
