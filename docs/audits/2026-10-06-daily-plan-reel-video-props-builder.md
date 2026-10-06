# 每日计划 Reel 出片 · PR1：服务端生成蒙太奇参数（R2b）（2026-10-06）

依据 `docs/specs/2026-10-06-daily-plan-reel-video-outlet.md`。风险级别 **B**（纯新增文件、无 IO、不碰数据库/鉴权/钱/发布，不在受保护路径）。基线 `origin/main` = `358e4a3da`（本地快照，未刷新远端）。PR1 **不接任何运行中的流程**：没有路由、没有事件、没有建工单；R3（PR2）在本 PR 合并后另开。

## 做了什么（`src/lib/factory/remotion-daily-plan/`）
- `types.ts`：窄接口 `ProductFactInput`（形状对齐官网事实快照 PR 2270 的 `ProductFact`，合并后一行适配）、`AssetPoolClip`、`MusicTrack`、`IndustryWordProfile`、`MontageBuildResult`（成功带回执，失败带「原因 + 怎么办」）。
- `music.ts`：`beatGrid` / `stagedFileName` 与引擎同算法的纯函数拷贝（引擎目录被 tsc 排除，不能直接 import），`pickMusic`（确定性选曲 + 选总拍数，使成片 14.5–18 秒）。
- `montage-props.ts`：`buildMontageProps`。顺序卡口：事实状态/新鲜度（≤14 天）→ 必填字段 → 镜头池（≥8 条、≥3 种类型、不重复）→ 行业词串 → 词数 10–30 → **数字回显**（词里每个数字必须出现在事实里）→ 选曲 → 拼参数。**不用大模型**；任何一环失败 = 不出参数，不兜底。
- `profiles/travel.ts`：**L2 旅游行业档案**——「27 DAYS / FLIGHTS / 4-5 STAR / NZ$… / DEPARTS 8 MAY 2027」这套词串；数字只从事实取，固定短语只在包含项里有证据时才出；过期团期不出。换地产只需再写一个 profile，构建器不改（合同测试里用一个虚构地产 profile 证明）。
- 测试支撑 `catalog-fixture.ts`、`engine-loader.ts`（仅测试用，运行时代码不引用）。
- 写代码：DeepSeek 三轮约 US$0.014（r1 音乐、r2 构建器+测试、r2b 旅游档案）；我改了 4 处：音乐扩展名多写了 `.aac`（引擎不认，已删）、测试精度、数字回显把 `08` 与 `8` 当同一个数、合同测试与加载器（因为 tsc 不允许静态 import `.ts`）。

## 验证
| 命令 | 退出码 | 结果 |
|---|---|---|
| `npx vitest run src/lib/factory/remotion-daily-plan` | 0 | 3 个文件 26 条全过 |
| `npx tsc --noEmit -p tsconfig.json`（筛本目录） | — | 本目录 0 条错误（整仓基线已知有红，未逐条比对） |
| eslint（根配置 `root:true` 探针，本目录） | 0 | 无输出 |
| 5 个变异（关新鲜度闸 / 关镜头类型闸 / 数字回显放行一切 / 不认去零数字 / 币种闸改原因）| — | 全部被测试抓住（按失败测试名比对） |
| 共享代码客户名扫描（CTS/官网域名/地名/价格） | — | 0 命中 |
未运行：仓库根 `npm test` / `npm run build`（只新增独立目录，无人引用）。

## 当场试跑（本机，真代码路径，不碰生产库、不发布）
1. **CTS 事实 + 真素材**：事实取 PM 2026-10-05 核对过的官网值（`Grand Tour`：27 天、NZ$10,899 每人双人间、出发 2027-05-08 / 2027-10-16、含机票/4–5 星/游轮/英语导游，与 PR 2270 试跑对账一致）；镜头池 = Dropbox 里 CTS `remotion-assets/clips` 的 12 条库存镜头（**标签/类型是我按文件名手标的，相当于将来 `factory_config.remotion_asset_pool`**）；曲子 `bass-drop`。`buildMontageProps` 通过 → 参数交给真引擎 `render.mjs --template montage` 渲：**退出码 0，449 帧，15.0 秒，55 秒**（改完背景交替后重跑，最终代码）；1080×1920 h264+aac，音轨在，−21.2 LUFS（原始渲染，未经出片机响度处理）。
2. **非旅游**：虚构地产事实 + 引擎自带占位素材 + 虚构地产词串档案 → 同一构建器同一引擎：**退出码 0，453 帧，15.1 秒，47 秒**。
3. **9 宫格自检（CTS 成片）**：第 1 帧是「27 DAYS」大字压长城航拍（文字钩子 ✓，非空镜起手）；词串 27 DAYS · FLIGHTS · INCLUDED · 4-5 STAR · HOTELS · CRUISE · ENGLISH · GUIDE · FROM · NZ$10,899 · PER PERSON · TWIN SHARE · DEPARTS · 8 MAY 2027 · 16 OCT 2027 · NZ$10,899 · 27 DAYS，逐字与事实对得上；logo 只在最后两拍出现（✓ 弱化 logo）；**没有地名词，所以不存在「张冠李戴」风险**（代价：成片不点出目的地，见下）。
4. **配方对账（montage 列）**：文字钩子首帧 ✓；满屏大字 ✓；快切 ✓（是假设）；真人出镜/自拍感 **未满足**（池里有 `person` 库存镜头但不是真人出镜）；真实感 **未满足**（回执 `recipe_gaps` 写出「镜头池里没有自有素材」）；音乐卡点 ✓、trending 不适用；素材真实性：全是库存，只当氛围，不当客户真实产品。
5. 成片留在本机临时目录，**未上传、未入审片队列、未发布**；任何对外使用前仍须马良/苏东坡审 + PM 授权。

## 已知局限（如实）
- 曲子目前 28/29 首是 `beats_unverified`（节拍未人工核对），回执里写出，对外前由马良抽听；`beats_unverified` 的曲子在 PR1 里**允许**使用（见方案 §4 第 3 条，待 PM 确认）。
- v1 词串**不点名目的地**（要点名必须同时绑镜头标签，等镜头池有可靠的地点标签再加）。
- 服务端不能用引擎校验（引擎目录被 tsc 排除），所以「引擎认不认」靠合同测试保证；真正的最后一道仍是出片机 `loadTemplate`，不合格会非重试拒收。

## Reuse Statement
- **复用**：引擎注册表/模板/校验（只读，合同测试对拍）、音乐目录 `catalog/music.json`、包 C 出片机、PR 2270 的 `ProductFact` 形状、平台层级门（Inline：L3 引擎适配器已有；构建器 + 回执 = platform-shared；旅游词串 = L2；事实/镜头池/品牌 = L4）。
- **新增 platform-shared**：构建器、选曲、数字回显闸、回执。**industry-specific**：`profiles/travel.ts`。**client-specific**：无（事实、镜头池、品牌色都是调用时传入）。
- 共享运行时里没有客户名/ID/行业判断；换成悉尼地产客户，构建器代码不用改，只补一个行业档案 + 事实适配器 + 镜头池配置。
- 与决策时分类是否一致：一致（未新增能力线、未动 Kernel）。学习：无。
