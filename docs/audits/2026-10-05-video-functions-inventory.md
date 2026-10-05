# ME 里所有「出视频」功能盘点（2026-10-05，只读）

基线：worktree zen-herschel-6ed7a4（对照了 stoic-archimedes 里的 10-05 视频工厂审计，结论一致）。**只看了代码，没查生产数据库和调用日志**，「在用/不在用」以代码注释和 STATE.md 为准，使用频率未验证。

| 代号 | 功能 | 入口 | 引擎 | 读 Master Brief？ | 产出去向 | 状态 |
|---|---|---|---|---|---|---|
| A | 工厂线（广告成片工单） | cron `factory-order-scheduler`；Mac 出片机；审核 `/dashboard/factory` | Mac 本机 make_promo.py + ffmpeg；缺镜头调 Muapi Kling | 部分读：文案/红线/品牌名读；logo 读本机文件夹；配方路径文案、避讳词、品牌色不读 | 审核队列 → publish-worker 发 Facebook（默认只存草稿） | 在用 |
| B | 内容看板线 | `/dashboard/clients/[id]/content-factory`「确认选题」 | Creatomate 云端模板 + Inngest | 不读（渲染层） | `content_posts` → 看板；马良 9 宫格；发布走 Publer | 在用，仅限配了 `render.engine=creatomate` 的客户 |
| C | Reel 批量渲染（先小样后全渲） | `POST /api/reel-batch/start`、`approve`（无 UI） | Creatomate inline | 不读：品牌/口号/端卡/logo/音乐全靠请求体 | 存 Storage、写 `client_assets` | 状态不明，仓库内无调用方 |
| D | 讲课线 lecture-* | `/content-factory/lesson/[postId]` | 渲染已退役（410）；数字人口播 Muapi（未实测） | 脚本读 | 脚本、录像、发 Facebook/TikTok | 渲染已退役，脚本与发布代码仍在 |
| E | Reels Studio | ReelsStudio.tsx、SocialPlanSection、ContentStudioDrawer | Claude 脚本 + WaveSpeed/OpenAI 首帧 + Atlas Seedance | 读（只进提示词） | `reels_drafts` → `…/publish` **直接走 Publer 排期，无审核闸、无端卡、无 logo** | 在用，**与 CLAUDE.md「视频只走工厂」冲突** |
| F | 素材故事板 → Seedance | `…/assets/storyboard/[id]/generate-video` | Atlas Seedance | 读 | 新建 `reels_drafts` | 后端在，没找到页面调用 |
| G | Visual Studio 视频 | `/dashboard/visuals` → `/api/visual/video` | Atlas Seedance | 不读 | `visual_assets` | 在用？接口文件内无登录校验，中间件是否覆盖未验证 |
| H | Avatar Studio（HeyGen） | `/api/visual/avatar` | HeyGen v2 | 不读 | `visual_assets` | 半休眠；STATE.md 写「无直调封装」与代码不符 |
| I | 每日计划 Reel | `/api/clients/[id]/campaign-daily-plan` | 无渲染（外部 agent 写脚本） | 记录 `master_brief_ref` | 只存脚本；真正发的是图片帖；与工厂没连 | 在用 |
| J | winner-reel-sync | cron | 无渲染（把好 Reel 推成广告） | 读自己的配置表 | Meta 广告组 | 相邻功能 |
| K | Poster Studio | 已无入口（#693 已删） | 生图，不出视频 | — | — | 已删；STATE.md 仍写「已接调度」，是过期文档 |
| L | 遗留脚本 `scripts/video-pipeline/*` 与 `reviews-to-reels.ts` | 无引用 | Seedance + ffmpeg + CapCut | 不读 | 本地文件 | 遗留 |

## 重复点
- 「Video Studio」一名三指（Seedance / Muapi / Creatomate）。
- 出片引擎四套并行：make_promo（A）、Creatomate 模板（B）、Creatomate inline（C）、Atlas Seedance 原片（E/F/G）；另有 PIL+ffmpeg 旧管线。
- 字幕至少五套；配乐四种来源；端卡三套；文案/脚本生成至少七处；成本额度三套（MTC、`factory_balance_ledger`、`creatomate/cost.ts`）；品控口径不统一（马良 9 宫格只管 B）。
- **logo、品牌色、Slogan 三套各存各的**（A 本机文件夹、B 模板图层、C 请求体、Remotion `theme.ts` 写死），后台没有一处从 Master Brief 的 VI 字段取。
- Master Brief 序列化两套（`reels/generator.ts:280` 自写一套，其余用 `content/brief-injector`）。

## Remotion / Creatomate / Creator Mate
- Remotion：仓库 src/scripts/package.json 零代码零依赖，只出现在 10-05 的方案与审计文档。
- Creatomate 模板：仓库里没有模板文件；模板 ID 存在数据库 `clients.factory_config.render.creatomate.templateId`，模板在云端编辑器里画。
- 「Creator Mate」：仓库全文零命中，最接近的是 Creatomate。

## 最值得先统一的 3 处
1. 品牌包（logo、品牌色、Slogan、端卡）统一从 Master Brief 的 VI 字段取，再下发各引擎（Remotion 接入前不统一就会再多一套）。
2. 所有视频发布都过工厂的审核和发布闸；先收口 E 的 Publer 直发与 `reel-batch`。
3. 「Video Studio」命名 + 引擎登记表（哪个引擎对应哪种视频形态），再决定 Remotion 并存还是替换 Creatomate。

## 不确定、没验证
生产里哪些客户开了哪条线、B/C/E/F/G/H 是否仍被实际使用；`/api/visual/*` 是否被中间件挡住；`make_promo.py` 在仓库外没读；H、F 的「没有页面调用」只是 grep 结果；D″ 退役代码是否被 Creatomate 链路间接引用。
