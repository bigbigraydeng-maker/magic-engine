# 出片机「音乐含人声就拦」检查 · 一页设计 v2（子牙「带条件通过」+ 魏征「打回」后重写）

> 106 号 · 2026-10-16 · 风险级 **B**（出片机的一道前置检查，不新增能力线，不改已有模板输出，不写客户数据）。DeepSeek 写；动工前再让子牙 + 魏征复审 v2；禁 Codex 审。
> 起因：Tale 三条 (ccff4bb9/abd7a705/19c191c5) 的背景音乐 `analytical-scholar` 自带地产广告人声没人发现。事故与整库转写表：`docs/clients/cts/2026-10-16-tale-music-vocals-incident.md`；证据包在本机 `~/Library/Application Support/magicengine/evidence/2026-10-16-tale-vocals/`。
> 以下行号一律以动工当天的最新 main 为准重新核（本分支落后 main 很多）。

## 1. v1 被打回的原因（已吸收）
转写对纯音乐会幻听成俄文/僧伽罗文乱码，对哼唱合唱又常常转不出东西——**「转写 = 判决」不成立**。所以：转写只用来「提名可疑」，**「确认无人声」必须由真人签字（智能体不能签）**；规则按**实际用到的那一段**判，不按整首判。

## 2. 做法
**A. 独立登记表（不碰 `music.json` 的严格校验）**：新文件 `scripts/factory-worker/engines/remotion/catalog/music-vocals.json`（平台共享、无客户信息），每条按**文件内容 sha256**登记：
`{ sha256, name, verdict: 'none'|'present'|'unknown', cleanUntilSec?: number, derivedFrom?: sha256, signedBy, signedAt, evidence: '<证据包路径或文档锚点>' }`
- `none`：人确认整首无人声（需 `signedBy`）。
- `present`：确认有人声 → 永远拦。
- `unknown`：未确认；**只有当本次实际使用区间 ⊂ [0, cleanUntilSec]** 才放行（例：Jade River Journey 登记 `cleanUntilSec: 100`，用前 15 秒放行；无 `cleanUntilSec` 的 unknown 一律拦）。
- 不把转写文字写进共享表（可能含第三方/客户广告词，如事故里的楼盘名）；表里只放状态和证据指针，文字在证据包里。

**B. 离线扫描工具** `scripts/factory-worker/tools/scan-music-vocals.py`（与现有 `analyze-music.py` 并列）：整首转写（small + large-v3-turbo 两个模型），输出提名清单：连贯词句（任一语言、两个模型都转出同一组词）→ `present` 候选；零段 / 只有 Music、Thank you 一类幻听 / 乱码（非目标语种文字）→ **「需人听」**，不得自动判 `none`。登记表只能由人（PM 或指定审片员）把「需人听」签成 `none`。`_n/_q` 等派生文件：工具按派生关系写 `derivedFrom` 并继承 `verdict`，由人复核签字。README「新增一首音乐」流程加一步「先跑人声扫描并签字」。

**C. 出片机接线（两条路径都要，各有用例）**：
1. `remotion-branch.mjs` 暂存音乐处（含 catalog 曲与 `client_library` 客户自带曲两路）：在**拷贝后的暂存文件**上算 sha256（`copyWithinRoot` 已逐块读文件，顺手算），与登记表比对；用到的区间 = `musicStartSec` 起、成片时长。
2. recipe 路径 `creative-recipe.mjs` 的 `resolveRecipeBgm`：同一函数 `assertMusicVocalClear(sha256, startSec, durSec)`（新放在共享小模块），不要两处各写一份。
- 判定：`present` → 拒；`none` → 过；`unknown` → 看 `cleanUntilSec`；**查不到 sha → 拒**，错误写「先跑 scan-music-vocals 并签字」。回执里记录 sha256 与判定。

**D. 签字规则（18 号转 PM 口径；苏东坡/马良是智能体，听不了音频，**不能**签「无人声」；签字人必须是真人）**
- **第①类「PM 审片即听过」**：曲子已在 PM 点过通过、且成片带声音审过的工单里用过 → 用「该工单号 + PM 通过时间（回填时从库里读）」做证据，**按实际用到的区间登记**（如前 15 秒 → `cleanUntilSec: 15`），不需要 PM 再听。含 Codex 三条已验收 Shorts 的三首（龙旗破云、Snap the Floor、Sunday Hammer，PM 验收签字，按各自实际用到的 cue+时长区间登记）；以及已发布工单用过的在用曲（如 founders-at-dawn、horizons-*、second-hand-sunrise、sunlit-kitchen-window 前 15 秒、jade_river_journey 前 15 秒），区间同样按实际用到的算。
- **第②类「从未经 PM 听过」**：新曲 / 库里待用曲（含 road-afar、feel-good-travel、momentum 等未被 PM 通过过的）→ **默认不放行**，需真人（PM 或 PM 指定的员工）听 20 秒后签；到那时由 18 号只问 PM 具体那一首。Founders in Motion（Tale v3 用）属本类：PM 点通过 v3 时听到即视为签字，同时登记。
- `present`：Analytical Scholar 及其 `_n` 派生、Jayden小弟（转写出连贯歌词/广告词，永远拦）。
- 转写只用于「提名可疑」，**不作「确认无人声」的依据**；`signedBy` 字段记真人姓名或「PM审片@工单号」。
- 首次回填与代码**同一个 PR**，否则合并即停产；已发布/在飞工单不回改。

## 3. 验收
- 单测（修改前后各记命令与退出码，沿用 `music.test.mjs`、`templates.test.mjs` 等现有基线）：present / none / unknown 无窗口 / unknown 窗口内外 / 查不到 sha / 同曲不同文件名同 sha / `_n` 派生 / 乱码与空转写不得自动判 none（工具层）/ `client_library` 路径 / recipe 路径。
- 当场试跑（出片机本机、无害测试单、只到待审、不发布）：①用 `analytical-scholar` 提单 → 必须被拦且回执写明原因；②用已签字 `none` 的曲子（founders-in-motion_n）提单 → 正常出片到待审，回执含 sha256。
- 现有 engine 与出片机测试基线不变。

## 4. 复用声明
复用 sha256 习惯、`copyWithinRoot`、出片前置检查位与回执；新增只是一张平台共享的登记表和一个小判定函数；客户/行业专属内容为零。

## 5. 复审后补丁（子牙 / 魏征对 v2 均「带条件通过」，2026-10-16；以本节为准）

1. **接线补第三条路径**：老路径 `worker.mjs` 的 `resolveBgm`（可用绝对路径、回退 `FACTORY_BGM_PATH`/品牌包默认曲，`music_mood` 还可能交引擎自动选曲）动工前核实是否仍在用：在用 → 同样接 `assertMusicVocalClear`；已停用 → 写明并加用例证明走不到。
2. **接线细节**：`stageRemotionAssets` 目前同步且不返回值 → 改为 catalog 曲（`copyWithinRoot`）与客户自带曲（`stageOne`）两路都返回 sha256，并把 `props.musicStartSec` 与实际总帧数/FPS 传入；判定点在渲染之前。recipe 路径 `resolveRecipeBgm` 是纯函数 → 注入 `hashFn` 与登记表（由 `worker.mjs` 传入）；命中 present 或区间越界时 `continue` 到下一首并写回执，全部被拒才抛错；**对「实际喂给 make_promo 的文件」算 sha**（先拷到 tmp 再算，避免换文件空窗）；`creative-recipe.test.mjs` 现有测试改为注入夹具登记表，不再要求「零改动」。
3. **区间算法**：放行条件 = `musicStartSec + 成片实际时长(总帧数/FPS) + 1 秒余量 ≤ cleanUntilSec`（余量覆盖淡出与帧取整）；起点按 `excerptFor` 取整后的值算；用例：恰等于、略超、起点不为 0、起点在人声之后。
4. **判定模块与登记表校验**：新建 `scripts/factory-worker/music-vocal-gate.mjs`（严格 zod：sha256 64 位十六进制、verdict 枚举、`cleanUntilSec` 非负、sha 不得重复；加载失败 = 整体拒绝出片，不当空表；含 `assertMusicVocalClear`），登记表放 `engines/remotion/catalog/music-vocals.json`。
5. **派生文件各自独立签字**：`_n/_q` 是降噪/响度处理版，原曲签了不等于派生版没问题；`derivedFrom` 只作追溯，**不继承 verdict**。Analytical Scholar 母版与 `_n` 各登记一条 `present`。
6. **签字防伪**：登记表本身就是闸 → **任何改动一律按 A 级处理**（在受保护路径里登记；PM 在对话里回「合」即等于签字；PR 必须列出表的 diff）。`signedBy` 只允许白名单真人或形如「PM审片@工单号」的由回填脚本生成的值；回填脚本必须**去库里核对**该工单存在、`review_ref.approved_by` 是 PM（排除 Airtable 同步写入的 `unknown`）、取 `approved_at`，并**从工单的 `musicStartSec` 与时长算区间**（取该曲在已通过工单里实际用到的最大区间），不靠手写；证据字段附证据文件 sha256。
7. **在飞/周期工单不能一合并就停产**：回填清单必须覆盖已排队、未渲染工单与每日计划（`remotion-daily-plan`）会选到的全部曲目；计划阶段（网页端读不到 Dropbox 文件）至少**按曲名过滤掉未登记曲**，sha 校验仍在 worker 端做；客户自带曲同样要登记，否则合并当天会被全部拦下。
8. **验收补**：区间边界用例；登记表被改（校验失败）必须拒绝；回填脚本只读试跑，输出「每首曲子的登记结果 + 证据来源」让人对一遍；README「新增一首音乐」流程同步更新并在验收里勾选。
9. **已定 A（18 号统筹代 PM 定，2026-10-16；PM 有异议可改）**：①往后审片清单加一项「已开声音听、背景音乐无人声」（B 级小改，DeepSeek 写，子牙+魏征审，禁 Codex）；②已发布曲子回填按实际用到区间登记并标 `strength: approval-only`（弱证据：仅审片通过），证据里必须附上已做的两模型（small / large-v3-turbo）转写结果指针；③在用的十几首由 PM 有空时各听 20 秒升级为强证据（统筹每次只问具体那一首）；④新曲未经真人听不放行。
