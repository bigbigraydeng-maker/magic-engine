# East Inter 出片接线方案（111 号，2026-10-14）

- **性质**：方案 + §2 数据卡接线代码（PR 2646）；没改名单/库，没出片。风险级 **A**（改准入 + 改出片机代码），须子牙+魏征两审、PM 回「合 N」。
- **核对基线**：origin/main `b876f4bf4`（本地快照，2026-10-14）。

## 1. East 为什么被拒（事实）

| 关卡 | 在哪 | 谁判定 | East 现状 |
|---|---|---|---|
| ① remotion 准入名单 | 出片机本机 `.env` 的 `FACTORY_REMOTION_CLIENT_IDS`（`scripts/factory-worker/worker.mjs:139` 读，`remotion-branch.mjs:360` 判）。**不在仓库、不在数据库**，默认空=全拒 | 出片机进程 | 不在名单 → 报「这个客户没有开通 remotion 出片」 |
| ② 客户→素材文件夹映射 | 出片机 `.env` 的 `FACTORY_CLIENT_STUDIO`（`worker.mjs:85`、`brandkitFor`），**绝不回退别家品牌包**（2026-08 Oztop 事故） | 出片机进程 | 没配；且 `~/Dropbox/MagicLab_Studio/` 下**没有 East 文件夹、没有品牌包** → 即使入名单也会失败 |
| ③ 数据卡模板 | 原 `remotion-branch.mjs` 对 `datacard` 一律抛 `DATACARD_NOT_WIRED` | 出片机代码 | **已接线（PR 2646：拒收已删，caption/SRT 已补）**；模板 PR 2582 |
| ④ 红线复扫 | 服务端 `complete-work-order.ts:200` 用 `clients.brand_redline_phrases` 扫 worker 回传的 `caption` | 服务端 | East 的红线词是否已配，**未查（要查库，只读）** |

结论：被拒不是「一道锁」，是四处各缺一块；其中①②是本机配置（不进仓库），③是代码，④是库里的客户配置。

## 2. 数据卡要补的接线（最小改动，A 级，只动 2 个文件）

`scripts/factory-worker/remotion-branch.mjs` + 其测试 `remotion-branch.test.mjs`：

1. 新增 `buildDatacardText/Caption/Srt`：把**屏幕上每一句字**（hook.lines、每行 label/value/sublabel、disclaimer）用现有 `clean()` 清洗后拼成回传 `caption`（红线复扫吃的就是这串）和 SRT（时间取 `computeDataCardTiming`）。
2. 删掉 `template === 'datacard'` 的拒收，并让 `srtText/caption` 按 template 分三路（list / montage / datacard）。
3. `recipeGaps` 已由模板回报，沿用，写进回执；不改。
4. 测试：①文案拼接含全部文字 ②含红线词能被复扫命中（用虚构词）③不可见字符被清掉 ④`DATACARD_NOT_WIRED` 旧测试改为「接线后能出 caption/SRT」。

不动：模板本身、服务端、Kernel。**解禁 = 删那 3 行拒收**，仍受名单①约束，不会对别的客户放开。

## 3. East 本身要补的（均不在仓库）

| # | 事 | 谁做 | 要 PM？ |
|---|---|---|---|
| a | 建 `MagicLab_Studio/East_Inter/brandkit/`：`brand_red.txt`、`assets/logo_color.png`、`assets/watermark.png`（logo/主色按 PM 定：#123B63/#1F7AB8/#F2A900；源文件 `docs/clients/east-inter/brand/`，须先读 master_briefs VI 核对） | 本窗口 | 否 |
| b | 出片机 `.env` 加 East 的 client_id 到 `FACTORY_REMOTION_CLIENT_IDS` 与 `FACTORY_CLIENT_STUDIO`（本机配置，改完需重启出片机） | 18 号/PM 机器 | **是（A 级准入）** |
| c | 查 East 的 `brand_redline_phrases`，缺「倒计时/截止/限时/最低价/最便宜」等则补（写生产库，单独 A 级） | 单独走 | **是** |
| d | `East_Inter/remotion-assets/` 放入许可明确的素材（见 §4） | 本窗口 | 否 |

## 4. 素材（只读核对结果）

Dropbox `00_Inbox/industry-logistics/2026-10-14_International_Logistics`：20 条（Pexels 授权，登记文件 `collection-record.json` 逐条有来源/许可/限制，全部 `no_publish:true`、`eligible_for_automatic_selection:false`）。**能用，但有 4 条要小心**：

- `70d9e7465fe7`（日本邮政国内货车）：国内邮政，**不得写成跨境运输** → 不用。
- `353e226833f3`（Juneyao Air）、`a184441a5ae8`（Philippine Airlines）、`1627e888c3c2`（OEL INDIA 船名）、`2d5c70b07aaa`（HELI 叉车）：画面有第三方品牌，**不得暗示是东际的** → 只用远景/打码或不用，画面角标「Illustrative footage」。
- 整批都是「通用场景图，非东际实拍」，不拍胸脯说是东际仓库/船/车。

## 5. 先后顺序（等 18 号拍板）

1. 18 号看本方案 → 通过。
2. §2 代码 + 测试已写（PR 2646，A 级，子牙+魏征审，PM 回「合 N」）。
3. 合并后：做 §3a/d，18 号/PM 做 §3b/c。
4. 之后才出 6 条片 → 苏东坡+马良审。**不发布、不设开关、不写生产库。**

## 6. 一个必须先说清的缺口

数据卡是**纯数字画面，没有镜头素材**。PM 要的「用物流素材做视频」，6 条里只有「价格封面/价格卡」那部分能靠数据卡；**带素材的画面要走 montage 模板**（已接线，也受 ①② 约束）。所以 6 条建议做成：**价格封面（datacard 出 1 张片头）+ montage 素材片体**，或先交 montage 版。需 18 号定拼法，我再动。另：物流行业配方库为 0 条，对账表只能如实写缺口。

## 7. 进展（111 号，同日晚）

- PR 2646（A 级草稿）：数据卡接线已过子牙+魏征审，问题已修；等 PM 本人回「合 2646」。
- §3a 已做：`MagicLab_Studio/East_Inter/brandkit/`（logo_color / logo_white / watermark / brand_red.txt，logo 来自本目录 brand/ 的 SVG 渲染，主色 #1F7AB8）。库里 master_briefs 的 VI 字段为空，颜色以 PM 指定为准。`remotion-assets/` 已建空目录。
- §3c 只读查到：East 的 client_id 为 `2e3f040d-4497-4527-89f6-50b6fa91e205`（库 glbdnayojixmexgofbsd），`brand_redline_phrases` 为空数组 → 复扫对 East 目前是空转。要补禁用词（倒计时/限时/截止/最低价/最便宜等）须写生产库，A 级，待 PM 点头，未写。
- §3b 未做：出片机 `.env` 加 East 的 client_id（两项）并重启，等 PM/18 号。
