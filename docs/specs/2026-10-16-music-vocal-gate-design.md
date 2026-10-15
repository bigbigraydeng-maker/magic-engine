# 出片机「音乐含人声就拦」检查 · 一页设计 v2（子牙「带条件通过」+ 魏征「打回」后重写）

> 106 号 · 2026-10-16 · 风险级 **B**（出片机的一道前置检查，不新增能力线，不改已有模板输出，不写客户数据）。DeepSeek 写；动工前再让子牙 + 魏征复审 v2；禁 Codex 审。
> 起因：Tale 三条 (ccff4bb9/abd7a705/19c191c5) 的背景音乐 `analytical-scholar` 自带地产广告人声没人发现。事故与整库转写表：`docs/clients/cts/2026-10-16-tale-music-vocals-incident.md`；证据包在本机 `~/Library/Application Support/magicengine/evidence/2026-10-16-tale-vocals/`。
> 以下行号一律以动工当天的最新 main 为准重新核（本分支落后 main 很多）。

## 1. v1 被打回的原因（已吸收）
转写对纯音乐会幻听成俄文/僧伽罗文乱码，对哼唱合唱又常常转不出东西——**「转写 = 判决」不成立**。所以：转写只用来「提名可疑」，**「确认无人声」必须有人签字**；规则按**实际用到的那一段**判，不按整首判。

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

**D. 首次回填（与代码同一个 PR，否则合并即停产）**：用整库转写表回填：
- `present`：Analytical Scholar 及其 `_n` 派生、Jayden小弟。
- `none`（有人签字）：Codex 三条 Shorts 已发布用过且 PM 听过并验收的 龙旗破云、Snap the Floor、Sunday Hammer（签字依据=PM 验收已发布成片，不是转写）；其余当前在用曲（founders-at-dawn、horizons-*、second-hand-sunrise(_n)、momentum(_q)、road-afar、feel-good-travel、founders-in-motion(_n)）由审片员听过后签字，**签不了的先留 unknown 不放行**，不为赶进度默认放行。
- `unknown + cleanUntilSec`：Jade River Journey（100）、Sunlit Kitchen Window（55）。
- 已发布/在飞工单不回改；之后新工单按上面规则走。

## 3. 验收
- 单测（修改前后各记命令与退出码，沿用 `music.test.mjs`、`templates.test.mjs` 等现有基线）：present / none / unknown 无窗口 / unknown 窗口内外 / 查不到 sha / 同曲不同文件名同 sha / `_n` 派生 / 乱码与空转写不得自动判 none（工具层）/ `client_library` 路径 / recipe 路径。
- 当场试跑（出片机本机、无害测试单、只到待审、不发布）：①用 `analytical-scholar` 提单 → 必须被拦且回执写明原因；②用已签字 `none` 的曲子（founders-in-motion_n）提单 → 正常出片到待审，回执含 sha256。
- 现有 engine 与出片机测试基线不变。

## 4. 复用声明
复用 sha256 习惯、`copyWithinRoot`、出片前置检查位与回执；新增只是一张平台共享的登记表和一个小判定函数；客户/行业专属内容为零。
