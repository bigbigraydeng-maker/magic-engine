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

## 真领生产工单试跑（PM 2026-10-06 回「授权」后做）
授权范围：对生产库建**一张**蒙太奇测试工单，只存草稿，不发布，不审批。
- **工单**：`23ba32e8-e58b-4feb-877f-4b8943ba8ea4`（CTS，`template: montage`，内容同上面的 CTS 版，`brief.copy.endcard` 用 10/5 那几张单已核过的官网链接与文案，`budget_cap_usd` 0.50，`angle_source.source = manual_remotion_trial`）。建单走 SQL 直插，字段形状照 10/5 两张 Remotion 试跑单。
- **谁来领**：为避免 Mac 上常驻的出片机（`mac-ray-cts-one-shot-…`，跑的是 main，不认 montage，也没开通 remotion）抢单后拒收，我先在本机用**本分支代码**起了第二个出片机进程（id `mac-ray-remotion-packc-trial`，轮询 2 秒，只认 CTS + remotion，`MUAPI_API_KEY` 置空、`FACTORY_PUBLISH_LIVE=false`，素材/乐库用临时 studio 目录，品牌包和 `Music/` 乐库是指向真目录的符号链接），**再**建单。它在建单后 3 秒领到单（13:57:18），13:58:56 完成，随后我立刻停掉了它；常驻出片机全程没动。
- **结果**：状态 `in_review`（进了审片队列），`actual_cost_usd = 0`，`attempt_count = 0`；服务端 `complete` 往返成功。服务端自动检查 **7 项全 PASS**：有音轨（−16.3 LUFS）、1080×1920 / 14.741 秒、字幕 18 条时间对齐、封面非空白非占位、Reel 格式、CTA 在首条评论、首评链接带追踪参数；`redline_hits` 为空。`quality_flags` 里有 1 条 `narrator_voice_mismatch`（简报要求第一人称、文案是公司口吻），与 10/5 两张清单试跑单完全相同，PM 当时已决定放行「品牌自己视角」的信息清单型。
- **没有**：审批（`review_ref` 为空）、发布（`published_ref` / `published_ad_id` 为空）、花钱（成本 0，未走任何付费生成接口）。这张单现在留在审片队列里，**我没有批准也没有拒绝它**。
- 音乐确实是从共享乐库 `Music/` 取的（符号链接指向真目录），成片音轨在、响度正常。

## 仍没做 / 需要有授权的人做
- 44 MB 的成片上传成功（没有撞存储桶大小限制，真往返已验证）。
- 没有独立审查（A 级要子牙 + 魏征 + 狄仁杰签字，尚未进行）。
- 旧版 worker 遇 `montage` 必拒收：读代码确认，并且**这次实际观察到**常驻 worker（main 版）确实没有抢到单，没法证明它会拒收，仍是读代码结论。

## Reuse Statement
复用：R2a 出片机分支整体、包 B 的注册表与 `loadTemplate`、包 A 的音乐目录。新增均为 platform-shared；客户相关只在 props / 素材库；乐库来自共享文件夹，不含客户专属曲；客户名没有写进共享代码。
