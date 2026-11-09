# Remotion 包 B：蒙太奇快切模板 `montage`（2026-10-06）

范围依据：`docs/specs/2026-10-06-remotion-template-catalog-and-selector.md` §1、§1.1、§6 WP-B；PM 2026-10-06 回「做 B」。风险级别 **B**（全在 `scripts/factory-worker/engines/remotion/` 下，不碰 `package.json`，不接出片机流程，不发布）。基线：`origin/main` = `dd48c153c`（含包 A）。

## 做了什么
- `src/montage.ts`：props 校验（含 §1.1 卡口）、帧换算、确定性的镜头分配（`buildMontageSegments`）。
- `src/MontageReel.tsx`：组件，从 PM 备份的 `PunkReel.tsx` 通用化（镜头池、词串、城市词绑镜头标签全部改成 props）；`src/Root.tsx` 注册第二个合成 `MontageReel`。
- `src/templates.ts` + `render.mjs --template list|montage`（默认 list，原行为不变；出片机 R2a 不传该参数）。这是后续「模板注册表」的雏形，包 C 在它上面接出片机。
- `src/schema.ts`：只给 `relFile` / `text` 两个已有函数加了 `export`。
- `examples/sydney-montage.props.json`（虚构）；README 加蒙太奇一节；`test/montage.test.mjs`（30 条）、`test/templates.test.mjs`（7 条）经 `schema.test.mjs` 末尾 import 并入 `npm test`（`package.json` 不动）。
- 写代码：DeepSeek 三轮（schema+纯函数+测试；组件+注册；模板表+命令行）约 US$0.045（其中第一轮 aider 在「反思循环」里多烧了一次 $0.02）；由 Claude Code 自己改的：第 0 拍恒为第 0 帧（1 行）、同步位移常量、示例 JSON、两条补强测试、README。

## 当场试跑发现并修掉的 3 个问题
1. **开头黑屏 25 帧**：音乐首拍在 0.842 秒，原实现让镜头和词从首拍才开始。第一版 9 宫格第 1 格全黑。改成第 0 拍恒为第 0 帧；DeepSeek 写的「连续覆盖」测试循环论证（用被测函数算起点），根本没抓到，已改成从 0 起算并做变异验证。
2. **音画偏差 −33 毫秒**：同步位移 1 帧→2 帧后 **+1 毫秒**（与 PM 备份里实测的 2 帧一致）。
3. **词与镜头张冠李戴**：CTS 版第一次把「YANGTZE / CRUISE」词叠在长城镜头上（没绑镜头标签，库里也没有长江镜头）。试跑内容改成只用有事实且不依赖特定画面的词，并在 README 写明「含地名/景点/产品名的词必须带 `clipTag`」，由后续选择器强制。

## 验证（目录 `scripts/factory-worker/engines/remotion`，Node v26.7.0）
| 命令 | 退出码 | 结果 |
|---|---|---|
| 修改前（包 A 合并后）`npm test` | 0 | 176 条全过（基线） |
| 修改后 `npm test` | 0 | 214 条全过（+38）；`npm run type-check` 通过 |
| 变异 6 个（首词规则关掉 / 每 3 个镜头位用真人改每 5 个 / 快切小节不拆半拍 / 黑白小节错位 / 允许相邻同镜头 / 第 0 拍不归零） | — | 各自多红 1 条以上（先前「真人占比」变异存活，补了专门测试后被抓住）；只比对了失败条数，没逐个比对测试名 |
未运行：仓库根 `npm test` / `build`（没动主站代码）；`render-smoke`（`RUN_REMOTION_RENDER` 未开，改为下面手工真渲）。

## 当场试跑（本机，成片在会话临时目录，不在仓库）
音乐 `pipa-trap`（139 BPM，包 A 已量过），32 拍，成片 14.7 秒（<15 秒，ThruPlay 按看满 15 秒计）。
| 版本 | 渲染 | 音画偏差（`qa.py`） | 每秒最多闪光 |
|---|---|---|---|
| A 虚构「悉尼公寓」，占位渐变镜头，含 clipTag 绑定 | 退出码 0，442 帧，用时 121 秒 | −2 ms | 3 |
| B **CTS 内容**（价格团期取官网 2026-10-05 核对值，记录在 `docs/audits/2026-10-05-remotion-first-real-run-recipe-check.md`；镜头为 PM 备份里的 12 条库存镜头，`source: stock`） | 退出码 0，442 帧，用时 100 秒 | **+1 ms**（目标 ±50 ✓） | 2 |
两版换客户**没改任何代码**，只换 props 与素材。9 宫格逐格自检（B）：词与价格一字不差（27 · INCLUDED · 4-5 STAR · FLIGHTS · ENGLISH · NZ$10,899 · DEPARTS · 16 OCT 2027 · 27 DAYS）；logo 只在最后几拍出现且完整；无黑屏；入场动画瞬间字会被放大冲出边缘，沉淀后实测在安全区内（单独抽 `27 DAYS` / `FICTIONAL` 沉淀帧确认）。

## 配方对账（方案 §2 `montage` 列，本包实测后的结论）
钩子（首帧大字数字）满足；满屏大字满足；快切满足（0.4–0.6 秒，**仍是「押快切」的假设，未用真实广告数据验证**）；航拍：库存航拍可用；**真人出镜/自拍感：未满足**（B 里的 `person` 是库存路人）；**真实感：未满足**（全部库存镜头，`ENGLISH` 词叠在长城游客镜头上不代表 CTS 导游，需知悉）；音乐卡点满足；logo 弱化满足。成品是「信息清楚 + 节奏对」的快切，不是配方意义上的爆款。

## 未验证
- 没有读 `viral_reference_library`（方案 §2 说要在 WP-B 现场查库复核；本窗口没有生产库读取授权，**这一项未做**）。
- 没有真实广告数据；没有独立审查；没有接出片机（包 C）。
- 只在本机 Chrome Headless Shell 上渲过；`Grain`（噪点）每帧重算，渲染比清单模板慢（约 100 秒 vs 30 秒）。

## Reuse Statement
复用：R1 引擎（`schema.ts` 的 `relFile`/`text`/`HEX_COLOR`、`timing.ts` 的 `FPS`、`components.tsx` 的 `Logo`、`theme.ts`）、包 A 的音乐目录与 `beatGrid`、PM 备份的 `PunkReel`/`qa.py`。新增均为 platform-shared；industry-specific 无；client-specific 无（`no-client-facts` 扫描覆盖新源码与示例，通过）。
