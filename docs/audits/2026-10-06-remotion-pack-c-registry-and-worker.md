# Remotion 包 C：模板注册表 + 出片机接线（2026-10-06）

范围依据：`docs/specs/2026-10-06-remotion-template-catalog-and-selector.md` §3 末项、§6 WP-C；PM 2026-10-06 回「做 C」。风险级别 **A（自报，出片机准入；机器按路径会判 B，沿用 R2a 先例作为下限）**，**草稿 PR，不自动合**。基线：`origin/main` = `0ff2702bd`（含包 A、B）。

## 做了什么
- `engines/remotion/src/templates.ts`：新增 `musicSourceOf(catalog, stagedName)`（暂存名 → 乐库里的文件夹+文件名，不在目录里返回 null）。模板注册表本身（`TEMPLATE_IDS` / `isTemplateId` / `loadTemplate`）是包 B 已经放进去的。
- `scripts/factory-worker/remotion-branch.mjs`（+80/−12 行）：
  1. 模板白名单改读注册表：`template` 只要是字符串就进，随后用 `isTemplateId` 判；不认识的 → `RemotionOrderError`（不重试）。props 校验、素材清单、总帧数全部来自 `loadTemplate`。
  2. 渲染命令带上 `--template`。
  3. 音乐：`props.musicFile` 在共享乐库目录里就从 `<STUDIO_ROOT>/<folder>/<file>` 拷进暂存目录（realpath 必须在该乐库文件夹内，含符号链接；失败 → 非重试错误）；不在目录里仍走客户 `remotion-assets` 老路径。
  4. `montage` 的字幕（一词一条）与 `caption`（所有词拼接，供服务端红线复扫）；`segments.json` 的 `template` 取真实模板名。
- 测试：`remotion-branch.test.mjs` 33 → 39 条；`templates.test.mjs` +3 条。写代码：DeepSeek 两轮约 US$0.013。

## 与 R2a 的关系 / 行为不变的部分
`list` 工单路径逐行不变（只是校验函数换成注册表入口，测试 33 条旧用例全部原样通过，仅改了假引擎的形状）。不动：领单接口、`complete` 校验、数据库、`FACTORY_PUBLISH_LIVE`、`creative_recipe` 互斥、心跳/超时/重试规则。

## 验证
| 命令 | 退出码 | 结果 |
|---|---|---|
| 修改前 `vitest run scripts/factory-worker/remotion-branch.test.mjs` | 0 | 33 条过（基线） |
| 修改后同命令 | 0 | 39 条过 |
| 修改后 `vitest run scripts/factory-worker`（4 个文件） | 0 | 182 条全过 |
| 引擎包 `npm test` / `npm run type-check` | 0 / 0 | 217 条全过 / 通过 |
| 变异 6 个（去掉 `--template` 参数 / 关掉乐库路径越界检查 / 放行未知模板 / `segments.json` 写死 list / 蒙太奇字幕走 list 构造器 / 音乐不拷贝） | — | 分别 2 / 1 / 1 / 1 / 1 / 3 条测试变红；恢复后全绿（只比对失败条数，没逐个比对测试名） |
未运行：仓库根 `npm test` / `build`（没动主站代码）。

## 当场试跑（本机，真实代码路径，**没有碰生产工单队列**）
用真实的 `processRemotionOrder`（真健康检查、真引擎加载、真渲染子进程、真 `probeMediaEvidence`），只把「服务器」换成记录用的假实现（心跳/上传/complete）。临时 studio 目录：客户素材库放 CTS 备份里的 12 条库存镜头 + 品牌包 `watermark.png`；乐库 `Music/` 放真曲 `琵琶陷阱`。工单：`template: 'montage'`、CTS 内容（价格团期取官网 2026-10-05 核对值）、`musicFile: 'pipa-trap.m4a'`（出片机从乐库按目录查到并拷入暂存）。
- 结果 `{ ok: true, cost: 0 }`，一次渲完（`attempts: 1`，渲染 65 秒），暂存目录已清理；
- 上传三件套：`final.mp4`（44 MB，1080×1920，h264 + aac，14.73 秒）、`segments.json`（`engine: remotion`、`template: montage`）、`captions.srt`（19 条，每词一条）；
- 成片体检：分辨率 1080×1920 ✓、时长 14.741 秒 ≈ 预期 ✓、音轨在 ✓、响度 −16.3 LUFS、封面占位符检测 false；
- `caption` = `27 · DAYS · FLIGHTS · INCLUDED · 4-5 STAR · HOTELS · DOMESTIC · FLIGHTS · ENGLISH · GUIDE · NZ$10,899 · PER PERSON · TWIN SHARE · DEPARTS · 8 MAY 2027 · 16 OCT 2027 · NZ$10,899 · 27 DAYS`。
- 旧 worker 遇 `montage` 必须拒收：旧代码的条件是 `template !== 'list'` 直接抛非重试错误，这一点读代码确认，**没有另起旧版本实测**。

## 没做 / 需要 PM 或有授权的窗口做
- **没有真领一张生产工单**：方案要求「本机真领一张 montage 工单」，这需要 PM 授权对生产库建一张测试工单（`brief.engine='remotion'`，`brief.remotion.template='montage'`，`brief.copy.endcard` 带 `cta` 和 `url`——否则首评两项自动检查判 FAIL，见 R2a 审计 §六），并给出片机配 `FACTORY_REMOTION_CLIENT_IDS` 与素材目录。上面的本机试跑覆盖了出片机分支的全部逻辑，但**没覆盖真服务器的 claim/complete 往返**。
- 44 MB 的成片能不能过存储桶大小限制，没有核实。
- 没有独立审查（A 级要子牙 + 魏征 + 狄仁杰签字，尚未进行）。

## Reuse Statement
复用：R2a 出片机分支整体、包 B 的注册表与 `loadTemplate`、包 A 的音乐目录。新增均为 platform-shared；客户相关只在 props / 素材库；乐库来自共享文件夹，不含客户专属曲；客户名没有写进共享代码。
