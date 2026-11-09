# Remotion R2a：出片机新增 remotion 分支（2026-10-05）

任务书：PM 2026-10-05 派活（R2a，只做「工单自带 props → 渲染 → 走现有上传与提交链路」）。风险级别：A（出片机准入 + 发布前链路）。基线：`origin/main` 837933d51（本地快照，未刷新）。

## 一、设计（编码前，送审稿）

### 改动面
| 文件 | 内容 | 预算 |
|---|---|---|
| `scripts/factory-worker/remotion-branch.mjs`（新） | 引擎选择、健康检查、素材暂存、渲染子进程 + 心跳、SRT、上传 + 提交 | ≤ 300 行 |
| `scripts/factory-worker/remotion-branch.test.mjs`（新） | 假依赖单测（沿用 worker.recipe-sequence 风格，vitest） | ≤ 300 行 |
| `scripts/factory-worker/worker.mjs`（改，约 +25 行） | `processOrder` 里分发；日志里 `segments.length` 容错；catch 里认 `e.retryable`；启动时打印一次健康检查 | — |
| `scripts/factory-worker/package.json`（+ 锁文件根 engines） | `engines.node` 22.4 → 22.18（R1 README 要求统一，直接 import R1 的 `.ts` 校验文件需要） | 2 行 |
| 台账卡 / 本审计 / 出片机 README 一小节 | 文档 | — |

不动：claim 接口与领单 RPC、complete 的服务端校验、数据库、`creative-recipe.mjs`、`make_promo` 分支、发布适配器、`FACTORY_PUBLISH_LIVE`。

### 流程（`brief.engine === 'remotion'`）
0. `resolveEngine(brief)`：engine 缺省（undefined/null）→ legacy；`'remotion'` → 新分支；**其他任何值 → 非重试失败**（不落进 legacy）。
1. 新分支内，先于一切：brief 带 `creative_recipe` → 非重试失败（不得并用）。`assertNoRecipeIntentInvalidReason` 仍在分发之前对所有单执行。**有意跳过** `assertClientRecipeIntentMatchesBrief`/`assertReopenedRecipeReplan`/`assertRecipeReplanAcknowledged`：这三道闸只管「配方客户不得被当 legacy 壳单跑」，remotion 单是工单显式选择的另一个引擎；若不跳过，CTS 这类配了配方意图的客户的 remotion 单会被它们拒掉。
2. 健康检查（每单都做；启动时再打一次警告日志）：Node ≥ 22.18、`engines/remotion/node_modules/@remotion/renderer` 在、浏览器可用（`REMOTION_BROWSER_EXECUTABLE` 指向的文件在，或 Remotion 自带下载的 chrome-headless-shell 已在 `node_modules/.remotion`）。不过 → 非重试失败，写明修法（仿 `BRANDKIT_REQUIRED`）。
   **局限（如实写）**：领单接口不按引擎过滤、本步又不许改领单 RPC，所以出片机不可能「领单前就知道这单是 remotion」。只能领到后立刻拒（非重试 → 进后台 dead_letter，一键复活）。
3. `brief.remotion = { template: 'list', props }`：template 只认 `'list'`；props 用 R1 的 `parseListReelProps` 校验（动态 import `engines/remotion/src/schema.ts`，只在这个分支里 import，旧流程在老 Node 上不受影响），不合格 → 非重试失败，原因直接用 R1 的中文校验信息。
4. 素材暂存：每单一个暂存目录，**只放 props 引用到的文件**。
   - logo：**只**取 `brandkitFor(wo.client_id)/assets/watermark.png`（与 R1 版式的 470×171 角标比例一致；`brandkitFor` 找不到就抛错，绝不借别的客户的），`props.logoFile` 必须以 `.png` 结尾，重命名成 props 里写的名字。
   - 其余文件（各镜头、音乐）：只从本机素材库 `<STUDIO_ROOT>/<该客户 studio 文件夹>/remotion-assets/<相对名>` 取（文件夹来自与品牌包同一份 `FACTORY_CLIENT_STUDIO` 映射），路径解析后必须仍在该目录内（含符号链接）；缺任何一个 → 非重试失败，列出缺的文件名和该放的目录。
   - **不做**「从工单里的网址下载素材」：领单接口只给 `brief.segments[].clip_ids` 签名下载地址，remotion 单没有这个字段；服务端签发素材地址属于 R2b/R3。
5. 渲染：子进程 `node render.mjs --props --out --public-dir 暂存目录 --timeout-sec 600`。退出码 5（渲染失败）最多重试 1 次；2/3/4（命令/props/素材）与 124（超时）不重试；最终失败 → 非重试失败（带最后一段错误输出）。父进程另设「超时 + 30 秒」强杀兜底。渲染期间每 60 秒 `heartbeat(woId, 0)`；心跳返回 `abort:true` → 杀子进程、非重试失败；心跳本身抛错只记日志不中断（成本为 0，无供应商花费；失联由服务端清扫收回，complete 还会验归属）。
6. 产出：`captions.srt`（hook 三行合一条、每个条目一条、价格段一条；时间取自 R1 的 `computeTimingFromProps`，沿用 `buildSrt` 的编号 + `HH:MM:SS,mmm` 格式）、`segments.json`（引擎名、模板、props、渲染次数与用时——不含任何网址/密钥）、成片。`probeMediaEvidence` 算媒体证据（由 worker 注入，避免循环引用）。
7. 提交：`complete`，`actual_cost_usd: 0`，`new_clips: []`，无 `recipe_receipt`（brief 没有配方）。**`caption` = 画面上所有文字拼接**——服务端红线复扫只扫 `caption` 与 `brief.segments/copy/receipt` 里的字，remotion 单没有后两者，所以全部上屏文字必须进 `caption`，否则红线复扫等于没扫。

### 已核实的服务端事实（读源码，未触生产）
- `completeWorkOrder` 对没有 `brief.segments` / `brief.copy` / 配方的单**不拒收**（这些全部按空数组处理）；`max_new_clips` 缺省 0，`new_clips: []` 合法。**不需要改服务端。**
- 但 `buildReelPublishAutoChecks` 读 `brief.copy.endcard`：remotion 单若没有它，审核队列里「CTA 放首条评论」「首评链接带追踪参数」两项会自动判 FAIL（只标红，不拒收）。工单创建方在 `brief.copy` 里补 `{ caption?, endcard:{cta,url} }` 即可让它们过，worker 不读这些字段。
- 领单接口会把 `brief` 原样下发（含 `brief.engine`、`brief.remotion`），不需要改。

### 需要评审盯的点
1. 跳过三道配方意图闸是否可接受（见 1）。
2. 「领到后才拒」是否满足「不领 remotion 单」的意图（见 2 局限）。
3. 心跳抛错不中断渲染（见 5）。
4. `remotion-assets` 目录约定（新约定，只在出片机本机，客户隔离靠 studio 文件夹映射）。
5. 渲染是否可能被利用读出素材目录之外的文件（props 只许相对文件名、暂存目录只含引用文件、拷贝前 realpath 校验）。

## 二、设计评审结论与修订（子牙 + 魏征，各一次，只读；结论都是「需改后开工」）

**采纳（写进实现）**
- `processOrder` 日志里的 `wo.brief.segments.length` 在 try 之外，remotion 单没有 segments 会抛错、工单卡在已领取、被清扫程序无限收回重领 → 改成容错，并用经过真实分发/失败路径的测试守住（魏征 2）。
- 客户准入：新增 `FACTORY_REMOTION_CLIENT_IDS`（默认空 = 全部拒绝），否则 `engine:'remotion'` 就是绕开配方强约束的开关（子牙 1、魏征 9）。
- remotion 单带 `recipe_replan_required` / `review_feedback*` / `reopened_from`（质量打回产生的重开单）→ 非重试失败：本步不读打回意见，重渲只会得到一模一样的片子（魏征 6、子牙 1）。
- 渲染后硬校验：文件存在且非空、1080×1920、时长≈总帧数/30；校验不过不上传不提交（魏征 3）。
- 心跳：渲染前就启动、跨两次尝试；返回 abort 或 409（工单已被收回）→ 杀整个进程组、不上传；其他心跳报错只记日志（魏征 4、子牙 4）。
- 子进程：独立进程组并整组强杀（Chrome 是孙进程）、单工单专用临时目录（打包产物随之清掉）、只传白名单环境变量（不把领单令牌带进渲染进程）；`finally` 里删暂存素材与成片（魏征 10、子牙 7）。
- 重试：退出码 5（渲染失败）进程内重试 1 次，仍失败抛**普通错误**（沿用 worker 现有「默认可重试，服务端 max_attempts 兜底」）；2/3/4（命令/props/素材）、124（超时）、健康检查、准入、配方并用等一律非重试（子牙 4）。
- 画面文字全部进 `caption`：开场、「条目标签 i/N」、条目、揭晓标题、价格（`en-US` 千分位）、限定语、日期、脚注；先 trim + NFKC + 去零宽字符；测试断言「props 里每个文字叶子都出现在 caption」（魏征 7）。
- 素材：素材库根目录本身也要在该客户 studio 文件夹内（realpath）；路径比较带分隔符；暂存名大小写不敏感去重；拷完核对大小（魏征 8）。
- SRT 毫秒用整数运算，末条结束时间 < 实测时长；Node 版本判断按 22.18 / 23.6 / ≥24 精确判；出片机 README 里过时的「Node 18+」顺手更正（魏征可选）。

**不采纳 / 留给后续**
- 「渲染前不创建 remotion 单直到所有机器升级」：运营约束，写进 PR 的上线步骤，不是代码（子牙 2）。
- 让别的机器不领 remotion 客户：靠现有 `FACTORY_WORKER_TARGET_CLIENT_ID` 分机，写进上线步骤。
- Inngest 机设了 `REQUIRED_RECIPE_ID` 时 remotion 单会被其门禁拦下：这是 fail-closed 的预期行为，写进 PR，不改。
- `CLIENT_STUDIO` 两个客户指向同一文件夹的重复检测：品牌包同样存在，非本步新增，不做。
- 发布正文 `brief.copy.caption` 不在红线扫描范围：既有缺口，非本步新增，只在 PR 里提示。
- `buildSrt` 内部 `fmt` 无法复用：新分支自带整数毫秒格式化。

**两条要 PM 知道的真实限制（不是代码能修的，实测/读源码核实）**
1. **没有音乐的 remotion 成片永远批不了。** 批准要求「自动检查全部 PASS」（`review-apply.ts:83-85`），其中音频项要求有音轨且响度 > −55 LUFS（`reel-media-checks.ts:27-31`）；R1 不带音乐的渲染实测没有音轨（`ffprobe` 只有 video 流）。带音乐的又受「音乐商用来源未确认前不得用于广告」限制（R1 README）。R2a 不改服务端校验，所以这是 R2b 前要决定的事。
2. **工单要自带 `brief.copy.endcard {cta,url}`**，否则「CTA 放首条评论」「首评链接带追踪参数」两项自动检查判 FAIL，同样批不了（`reel-publishing.ts:58-89`，由工单创建方补，worker 不读）。

**CLAUDE.md §8「配方对账表」**：R2a 不产出对外成片（试跑用假接口、不进审核队列、不发布），配方对账与「分镜自检表」留到第一张真实 remotion 工单开工前；试跑成片仍逐镜自检（见试跑一节）。

## 三、实施与第二轮评审（子牙 + 魏征 + 狄仁杰，各一次，只读）

**谁写的**：DeepSeek（aider 一次性），共 9 次调用、合计约 US$0.065；Claude 只出指令、审 diff、跑测试、做变异检查、手改了 1 句提示文案。没有走「自己写」的例外。
**第二轮评审结论**：三人都没有发现准入闸被绕过的办法；子牙「可进下一步」，魏征「无阻塞」，狄仁杰「闸可信，渲染后有洞」。已修的：
- 狄仁杰高：渲染子进程的孙进程攥着输出管道时 `close` 不触发，出片机会永久卡死且心跳照发 → 现在监听 `exit` 并在 3 秒宽限后收尾，超时强杀后同样兜底。
- 狄仁杰中高：工单配了音乐但成片没有音轨（East Inter 那类事故）→ 渲染后体检直接拒；ffprobe 没装时不再报「undefinedxundefined」，改成「没测到分辨率」。
- 狄仁杰中：红线扫描可被不可见字符绕过 → `caption` 清洗扩到软连字符、双向控制符、C0/C1 控制字符等。**未修**：西里尔字母等同形字（NFKC 不折叠），只在这里留痕。
- 魏征：单次心跳请求挂死会让后续心跳和 abort/409 全部失效 → 单次心跳 15 秒超时；错误信息只留 stderr 末 300 字（`worker.mjs` 把消息截到前 500 字，原来会把有用的尾部截掉）；`runRemotionRender` 原先零测试 → 补 3 条（环境白名单 + 进程组、exit 无 close、abort 杀整组）。
- 子牙/魏征：`complete` 返回 4xx 属于确定性拒收，重渲结果一样 → 改成非重试。
**未修（有意）**：`watermark.png` 复制前不做 realpath（品牌包是运维自管目录）；`CLIENT_STUDIO` 值是否重复/含 `..`（环境变量配置错误，品牌包同样存在）；渲染进程收到 SIGINT 时不联动；黑屏镜头（素材库里放全黑视频）不拦——服务端「封面」自动检查会给出标记；另外心跳 15 秒超时那一段没有测试。

**体量（如实）**：任务书目标「代码 ≤300 行、测试 ≤300 行」，实际 `remotion-branch.mjs` 469 行（其中约 40 行注释空行）、`worker.mjs` 净增 39 行（删 3）、测试 364 行 / 33 条。超出的全部是两轮评审要求的加固（进程组与超时、心跳、素材隔离、渲染后体检、红线字符清洗）。子牙指出可删而不损安全的约 25–30 行：Node 版本检查、拷贝后大小核对、启动日志、`segments.json` 里的 attempts/elapsed。要砍回预算回我一句，我再派一轮。

## 四、当场试跑（假接口，不连生产）

做法：本机起一个只监听 127.0.0.1 的假接口（认领 / 心跳 / 上传 / 提交 / 失败五个路径），把**真实的** `node scripts/factory-worker/worker.mjs --json-result` 指过去（`FACTORY_API_BASE`、假令牌、临时素材根目录、`FACTORY_REMOTION_CLIENT_IDS`），整条链路都是真的（含真 Chrome 渲染、真 ffprobe/tesseract 体检、真子进程），只有服务端和存储是假的。脚本在会话临时目录（`.../scratchpad/trial/`，未入库）。内容用 R1 试跑 A 的 CTS 参数（官网 2026-10-05 核对过的价格与日期，该条不对外、不入审核队列、不发布）。2026-10-05 11:38–11:40（NZDT），代码为最终版本。

| 场景 | 结果 |
|---|---|
| A 正常单（5 条目 + 音乐，11.1 秒） | worker 退出码 0，用时 28 秒；`claim → heartbeat → 上传 final.mp4 / segments.json / captions.srt → complete`；`actual_cost_usd=0`、`new_clips=[]`；体检 1080×1920、11.136 秒、有音轨 −14.1 LUFS、7 条字幕 |
| A2 同内容节拍放慢 3 倍（33.4 秒，用来拉长渲染） | 退出码 0，用时 72 秒；**第 60 秒（渲染中）发出第 2 次心跳**；上传 + 提交同上 |
| B 素材库缺一个镜头 | 退出码 0；发 `fail`：「缺少素材文件：clips/not_there.mp4。请放到 …/remotion-assets」，`retryable:false`；没渲染、没上传 |
| C `engine:'bogus'`（无 segments） | `fail`：「不认识的引擎 "bogus"…没有落进旧流程」，`retryable:false`；没有出现 `segments.length` 的报错 |
| D remotion 单同时带 `creative_recipe` | `fail`：「remotion 单不能同时带 creative_recipe」，`retryable:false` |

产出文件（会话临时目录）：成片 `…/scratchpad/trial/out-A/final.mp4`；**9 宫格自检图** `…/scratchpad/trial/A_grid9_final.png`。逐镜自检（我自己逐格看过）：①开场「27 DAYS / FLIGHTS / INCLUDED」、5 条「INCLUDED i/5」文字、价格「NZ$10,899 / PER PERSON · TWIN SHARE / DEPARTS 8 MAY 2027 / 27 DAYS · ALSO DEPARTS 16 OCT 2027」与工单一字不差；②每一格左上角 logo 完整清晰，是该客户品牌包的 watermark；③画面里没有别的客户内容；镜头 3–5 是工单要求的模糊氛围背景（`blurBackdrop`），第 8 格底部脚注在入场动画中，第 9 格已完整。**这些文字的事实来源是 R1 试跑 A 时对官网的核对，本次没有重新核对官网；该片不对外使用。**
未做：**没有领真实生产工单**（需要 PM 授权改生产数据，见第六节）；渲染超时（124）与渲染失败重试只有单测，没有真跑（真跑需要人为制造 10 分钟挂死）。

## 五、验证（命令、退出码、通过/失败数；2026-10-05，分支 `feat/remotion-r2a-worker-branch`，基线 `origin/main` 837933d51 本地快照）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npx vitest run scripts/factory-worker` | 0 | 4 个文件、175 条全过（旧 142 条 + 新 33 条）；旧的三个测试文件未改动 |
| `npx vitest run scripts/factory-worker/remotion-branch.test.mjs`（逐个变异后） | — | 27 个变异：25 个被测试抓住；2 个存活（心跳 15 秒超时无测试；ffprobe 缺失的**文案**变异——行为仍是拒收）。只比对了失败条数，没逐个比对失败的测试名 |
| `cd scripts/factory-worker/engines/remotion && node --test test/schema.test.mjs test/no-client-facts.test.mjs test/render-smoke.test.mjs` | 0 | 138 条全过（R1 包，本步未改动它） |
| 同目录 `npm run type-check` | 0 | 通过 |
| 仓库根 `npm run type-check` | 2 | 16 条错误，**没有一条指向 factory-worker 或 remotion**；本步只动 .mjs/.md/.json，不在类型检查范围；**没有在原版 main 上同环境重跑，所以不写成「既有失败已证实」，归因未确认** |
| 仓库根 `npm run lint` | 1 | 0 条指向本步文件（`next lint` 本来就不扫 scripts/）；报错是别处「规则定义找不到」等，未与基线对比，归因未确认 |
| `grep -inE "CTS|ctstours|NZ\$|China Panorama|10,?899|Auckland|Yangtze"` 对两个新文件 | 1（无命中） | R1 客户事实词表对新文件零命中 |

未运行：全仓库 `npm test`（本步没动 `src/`，只跑了受影响目录）；`npm run build`（没动 Next 应用代码）。

## 六、上线步骤与已知限制（PM / 协调窗口）

1. **所有出片机一起升级后，才能创建 remotion 工单。** 领单接口不按引擎过滤；没升级的旧版 worker 领到 remotion 单会在 `try` 之前就因 `segments.length` 报错，工单卡在已领取，被清扫程序每 10 分钟无限收回重领。当前只有一台 Mac 出片机时没问题。
2. 出片机 `.env` 要配 `FACTORY_REMOTION_CLIENT_IDS=<允许的 client_id>`，并有 `FACTORY_CLIENT_STUDIO` 映射；素材放 `<STUDIO_ROOT>/<该客户文件夹>/remotion-assets/`；`engines/remotion` 里要跑过 `npm ci`，浏览器要在（首次渲染会下载；或设 `REMOTION_BROWSER_EXECUTABLE`）。Node ≥ 22.18。
3. remotion 工单的 `budget_cap_usd` 必须 > 0（心跳规则是「成本 ≥ 预算即 abort」，成本恒为 0；默认值 2.00 没问题）。
4. **要让成片能被批准**（改不了服务端的前提下由建单方保证）：`musicFile` 必须有（否则没有音轨，音频自动检查判 FAIL，批不了）；`brief.copy.endcard` 要带 `cta` 和 `url`（否则「CTA 放首条评论」「首评带追踪参数」两项判 FAIL）。音乐商用来源未确认前，带音乐的片不得用于广告——这两条合起来意味着**目前 remotion 成片拿不到「可用于广告 + 可批准」**，需要 R2b 前定。
5. Inngest 机若设了 `FACTORY_ORCHESTRATOR_REQUIRED_RECIPE_ID`，remotion 单会被它的配方门禁直接拦下（失败即关闭，预期行为）。
6. **要在 Mac 上真领一张生产工单**：需要 PM 授权对生产库创建一张测试工单（`brief.engine='remotion'`，`brief.remotion.props` 用核对过的内容，`brief.copy.endcard` 填好）+ 出片机配好上面第 2 条；预期它进「审片队列」，三项自动检查全 PASS。**这一步没有做，由协调窗口向 PM 申请。**
7. 首张真实对外成片前还要补 CLAUDE.md §8 的「配方对账表」与「分镜自检表」（本步成片只是试跑，不对外）。
