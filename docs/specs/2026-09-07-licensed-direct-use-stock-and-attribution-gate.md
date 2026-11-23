# Spec：授权直用素材 + 发布前署名闸（Licensed Direct-Use Stock & Attribution Gate）

- 日期：2026-09-07
- 状态：**⚠️ 2 审已完成，原设计按下重做（见文末「2 审结论与方向调整」）。PM 2026-09-07 拍板：两条线并行、分场景。**
- 风险级：**A**（碰共享出片池 evaluate.ts + 对外发布合规 + 可能改 schema）
- 触发：给 CTS 攒了 102 张 Wikimedia CC 授权风景图，要让视频 agent 能调用；双审发现现有工厂 stock 链会**抹掉署名、把合法 CC 图做成违规成片**（见 [[feedback-factory-stock-chain-strips-credit-cc-unsafe]]）。

---

## 1. 问题（为什么要立项）

ME 工厂现有 stock 链（`stock-pipeline.ts` `ingestHarvestedImages` → `stock-ingest.ts` → `stock-transform.ts`）是为 **"抓来路不明的图 → gpt-image-1 重绘脱版权 → 只有 AI 改写后的进出片池"** 设计的。把**授权干净但要求署名**的 CC-BY/CC-BY-SA 图灌进它，四个硬点全踩（双审坐实）：

1. **原图进不了池**：`evaluate.ts` 的 `sourceImagePool` 只收 `is_ai_transformed===true`；原图 = 死数据。唯一出口是 AI 重绘（$0.04/张 + 把真实风景画成假通用画面 = PM 骂的"跑题"）。
2. **零 credit + 主动抹署名**：`HarvestedImage` 类型无 author/license；`buildStockClipRows` 硬编 `provider:'pinterest'`、不存 author/license；transform prompt 明令 `No text/watermark/signage` → 主动抹署名。全链无任何署名环节。**CC-BY/CC-BY-SA 经此链发布 = 违约。**
3. **scene_tag 是 6 词白名单**；城市/景点被静默拍平成 `establishing` → 按城市挑片失效。
4. **一 transform 就 status=active 立即上线**，无"入库暂不启用"开关 → 无署名 CC 衍生图会自动进下一条发布。

**结论**：需要一条**独立于"洗盗图"链**的「授权直用素材」通路，并补上 ME 目前**完全没有**的**发布前署名能力**。

---

## 2. 目标 / 非目标

**目标**
- G1 授权干净的图（CC/PD/客户授权）以**直用**身份进出片池，**不经 AI 重绘**。
- G2 每张图**全程携带 provenance**：license / author / source_url / origin，并可被 agent **按城市·景点·朝向查询**。
- G3 **发布前署名闸**：任何用到"需署名"素材（CC-BY/CC-BY-SA）的成片，发布前必须带上摄影者+协议 credit（endcard 或首评），否则 **fail-closed 拦发**。
- G4 与现有 Pinterest stock 链、及其清理任务（task_7c3297ff）**物理隔离**，互不误伤。
- G5 "入库暂不启用"开关：先入库、人审后才进池。

**非目标（本 spec 不含）**
- N1 **视觉 AI 自动识别打标**（自动判白天/黑夜/有没有人）——另立平台能力，单独评审。
- N2 i2v 出片本身 / Muapi 额度 / 蒙太奇引擎——出片环节，与入库分开。
- N3 竖版素材不足的补足策略——素材采集问题，非本机制。

---

## 3. 层级判定（Tier Classification · 平台层级门）

**被判定对象**：授权直用素材入库通路 + 发布前署名闸。

| 组成 | 层级 | 理由 |
|---|---|---|
| `origin='licensed_stock'` 入库通路 + evaluate 池分支 | **L1 平台能力** | client-agnostic；未来任何客户的授权图库通吃 |
| 发布前署名闸 | **L1 平台能力（Governance/合规）** | 所有客户、所有对外发布通用；属发布内核的合规闸 |
| provenance 字段（license/author/source） | **L1**（机制）+ **L4**（具体值） | 机制共享；每张图的具体授权/作者是 client-scoped 数据 |
| CTS 这 102 张 + 城市/景点标签 | **L4 客户数据** | 按 client_id 隔离，存 per-row meta |

**红线检查**：
- 红线 1（禁包装升级）✓ 不新设支柱/智能层，是发布内核合规闸 + 素材入库通路的扩展。
- 红线 2（禁客户事实进 shared runtime）✓ 城市/景点标签落 **per-row meta**，**绝不**塞进 `constants.ts` 的 scene_tag 白名单（子牙红线）。
- 红线 4/5（换客户/换行业）✓ 机制对任何客户任何行业成立；"CTS 城市"是数据不是规则。
- 换客户测试：换 Oztop/地产客户 → 同一入库通路 + 署名闸照用，只是数据不同 ✓。

**结论**：L1 平台能力（机制）+ L4 客户数据（内容）。不新增能力线。需走完整五道 Build Gate + 大任务 2 审。

---

## 4. 设计

### 4.1 入库通路（新入口，不复用 ingestHarvestedImages）
- 新函数（建议 `src/lib/factory/licensed-stock.ts`）：读每城 manifest → 下载/上传/去重（**复用** stock-pipeline 里已验证的 IO：`fileNameFor` / bucket upload / sha 去重）→ 写 `video_clips` 行。
- 存储桶前缀独立：`content-factory/licensed_stock/`（跟 `stock/`、`renders/` 分开，一眼可辨）。
- 🔴 Wikimedia 取图坑（魏征）：manifest 存**中等分辨率派生 URL**（不用 original，常 >15MB 被 `MAX_IMAGE_BYTES` 静默跳过）；只收 jpg/png（`.svg/.tif` 会被当 jpg 存坏）；**不走** `normalizeHarvest`（`minSaves=50` 会全刷掉）。

### 4.2 落库字段（video_clips）
- `track='b_generated'`、`is_still_image=true`、`is_real_footage=false`（保持"氛围底料、绝不当真拍打真价"的隔离，与现有一致）。
- **新增 provenance**（存 `source_meta` jsonb，避免 migration；若需大规模按景点查再考虑加列）：
  `{ origin:'licensed_stock', provider:'wikimedia_commons', license, license_url, author, source_url, note, requires_attribution:bool, city, landmark, orientation }`。
  🔴 `license_url`（协议链接）和 `note`（修改说明，如 "resized to 1150px wide, re-encoded JPEG q68"）**必须落库**，不能只存 license 名称——发布闸最终要拼出完整 CC 署名（作者 + 协议 + 协议链接 + 是否修改），少一项署名就不完整。现有 `templates/tailor-made-itinerary/heroes/CREDITS.json` 已经在存这两项，入库时原样带过来，不要再重新调查。
- **`requires_attribution` 判定必须先规范化再比对，不能直接对原始字符串做集合成员判断**：Wikimedia 实际值带空格和版本号（`CC BY 2.0`、`CC BY-SA 3.0`、`CC BY-SA 4.0`，见上面 CREDITS.json 的真实样本），逐字比 `license ∈ {'CC-BY','CC-BY-SA'}` 会全部判不中导致误判为无需署名，署名闸形同虚设。改为：
  1. 解析出受控的 `license_family`（`CC-BY` / `CC-BY-SA` / `CC0` / `PUBLIC_DOMAIN`）+ `license_version`，只认白名单模式（如 `/^CC[- ]BY(-SA)?[- ]?\d+(\.\d+)?$/i` 加归一化空格/连字符）；解析失败一律写 `license_family='UNKNOWN'`（不是留空、不是复用某个已知枚举值）；
  2. `license_family ∈ {CC-BY, CC-BY-SA}` → `requires_attribution=true`；`∈ {CC0, PUBLIC_DOMAIN}` → `false`；
  3. **无法归一化解析的原始 license 字符串一律 fail-closed**：`license_family='UNKNOWN'`、`requires_attribution=true`，该行禁止进入 4.3 的直用分支，直到人工修正 license 字段为受控值——不允许"未知值默认不需要署名"。
  4. 🔴 **`license_family` 必须作为独立硬字段贯穿全链，不能被 `requires_attribution` 这一个布尔值代替去做"能不能用"的判断**：`requires_attribution=true` 同时覆盖两种完全不同的情况——①合法解析出的 CC-BY/CC-BY-SA（可以用，但要署名）②`license_family='UNKNOWN'` 的未知/无法解析（禁止使用，等人工修正）。单看 `requires_attribution` 布尔值无法区分这两者。因此 4.3（进池查询）、4.4（发布闸）、第 5 节（分期放宽条件）任何一处要"放行"逻辑，都必须先独立检查 `license_family ∈ {CC-BY, CC-BY-SA, CC0, PUBLIC_DOMAIN}`（即已成功解析且属于受控枚举）作为**不可被后续任何阶段放宽的硬前置条件**；`license_family='UNKNOWN'` 永远不放行——不论 P2/P3 哪个阶段、不论 `requires_attribution` 取值、不论发布闸对 caption 文本内容的检查是否"看起来"通过（协议文本本身可以是编造或误填的，闸只能证明"caption 里有一段像署名的文字"，证明不了"这张图的许可证真的属于允许集合"）。
- **不碰** scene_tag 白名单：scene_tag 走既有兜底即可；**景点查询靠 source_meta.landmark**（需给 strategist 挑片逻辑加读 source_meta.landmark 的分支，或 evaluate 侧带出）。

### 4.3 进池（evaluate.ts sourceImagePool）
- 新增分支：`origin='licensed_stock'` 且 `status='active'` **且 `source_meta.license_family ∈ {CC0, PUBLIC_DOMAIN}`**（P2 阶段等价于 `requires_attribution===false`，但查询条件写的是 `license_family` 白名单成员判断，不是 `requires_attribution` 单一布尔值——原因见 4.2 第 4 点：布尔值分不清"合法直用"和"未知禁止"）的行**直接进** sourceImagePool（对标 `client-asset-pool.ts` 的"直用不改写"），**不要求** `is_ai_transformed`。
- 🔴 **`license_family` 白名单是查询层硬条件，不是靠人审流程去把关**：只检查 `origin` + `status` 不够——人审只要把一张 CC-BY/CC-BY-SA 图设成 `active`，它就会在 P3 署名闸落地前直接进池，跟第 94 行"P3 通过前一张都不许进池"的边界矛盾。`license_family ∈ {CC-BY, CC-BY-SA}`（含 `UNKNOWN`）的行即使 `status='active'` 也必须被这条查询排除，直到 P3 署名闸上线并验证通过后，才把条件放宽为"`license_family ∈ {CC-BY, CC-BY-SA}` 且闸存在则放行、闸不存在则拦"；`license_family='UNKNOWN'` 不受此放宽影响，任何阶段都排除在外（见 4.2 第 4 点）。
- 🔴 **sourceImagePool 的每一项必须带 `license_family`，不能只是裸 URL 字符串**：现有 `evaluate.ts` 的 `sourceImagePool: readonly string[]` 只是 URL 列表，`strategist.ts`（约 346-365 行）从池里取图时只拿到 URL，写进 `clip_generation_plan.source_image_url`，`worker.mjs`（约 343-350、667-683 行）再把这个 URL 交给 `muapiGenerate` 做 i2v——整条链路里没有任何环节能看到这张图的 `license_family`。P2/P3 引入需署名素材后，池结构必须改成携带许可证族的条目（如 `{ url, license_family, requires_attribution }`），`clip_generation_plan` 也要透传这个字段，否则 4.4 的 SA 排除规则（不喂 i2v）在下游无从判断，形同虚设。
- 与 Pinterest 链彻底分开：licensed_stock **永不**进 `transformStockImages`（不重绘、不脱版权，本来就干净）。

### 4.4 🔴 发布前署名闸（本 spec 的核心新能力）
- **provenance 传递**：工单要记录它用了哪些 source 图（image_asset → work_order），把 `requires_attribution` 的图的 author/license/license_url/note 汇总带到发布层（4.2 的 `source_meta` 全字段一起带，不能只带 author + license 名称——闸要能拼出完整 CC 署名：作者 + 协议 + 协议链接 + 修改说明）。
- **闸**：`publish-worker` 发布前检查——若本片用到任一 `requires_attribution=true` 的图，则**成片 caption 或 endcard 文案必须含**对应摄影者 + 协议名 + 协议链接（+ 有修改则注明"modified"）；缺任一项 = **fail-closed 拦发**（比照现有红线闸 `scanPublishCaption` 的 fail-closed 写法，闸校验的是最终署名文本内容，不是"有没有填 credit 字段"）。
- 🔴 **credit 载体只能是发布前可校验的位置（caption / endcard），本期不做"首评"**：现有 `publish-worker.ts`（`src/lib/factory/publish/publish-worker.ts:254-255`）发布调用只传 `videoUrl` + `caption`，没有首评步骤；首评通常要先拿到已发布帖子 ID 才能创建，等于帖子先公开、评论后补。若评论请求失败，就会留下一条已公开但无署名的内容，不满足 fail-closed。因此本期署名闸**只接受 caption/endcard 这类发布前即可读取校验的字段**；"先建不可见草稿 → 写首评拿到回执 → 再公开"的分阶段发布工作流留作后续能力，需要 provider 支持隐藏发布 + 独立立项评估，本 spec 不含。
- CC0/PD 图不触发此闸。
- 🔴 **SA（ShareAlike）排除必须有真实代码路径承接，不能只是文字约定**：i2v 衍生是否触发 SA 的"同协议"义务需法务确认；保守起见本期 `license_family='CC-BY-SA'` 的图**禁止**进入 `clip_generation_plan` 的 i2v 生成分支（`strategist.ts` 里 stock 不足时 fallback 生成的那条路径，最终交给 `worker.mjs` 的 `muapiGenerate`）。核查现状：当前 `resolveClips`（`worker.mjs`）里每一条缺库存的 segment 都无条件走 `muapiGenerate`（i2v），代码库里**没有**"直用静态图不重绘"的替代产出路径（不存在所谓"蒙太奇"分支）。因此本期两个选项二选一，不能默认成不存在的第三条路："直用/蒙太奇"：
  1. 在 4.3 的 `sourceImagePool`/`clip_generation_plan` 构造处，`license_family==='CC-BY-SA'` 的条目直接**不参与 i2v 候选轮换**（`chosenSource` 挑选时跳过），实质是本期 CC-BY-SA 图完全不喂 i2v、也不做任何生成使用，只入库和被人工/未来路径使用；
  2. 或新建一条真正独立的非 i2v 出片路径（静态图直接切片/裁切，不经 `muapiGenerate`），并在本 spec 范围外单独立项验收。
  本 spec P3 默认选 ①（零新增代码路径、零 SA 风险），②留作后续能力，不在本期分期交付范围内。

### 4.5 启用开关 + 隔离
- 入库默认 `status='quarantined'`（新入库暂不进池），人审后置 `active`（堵魏征"一入库就自动上线"）。
- 与 task_7c3297ff（Pinterest 清理）对齐：清理判据必须按 `origin`/`provider` 精确匹配，**licensed_stock 不在清理范围**——立项后先跟那个窗口对齐判据再上线。
- 🔴 **`quarantined → active` 必须有真实的人审入口，不能只是"改个状态位"**：全仓检索 `video_clips` 现有调用方只有入库（stock-pipeline / licensed-stock）、选片（evaluate/strategist）、worker 出片三类路径，**没有任何审核/激活入口**——按现状，唯一能把一行从 `quarantined` 改成 `active` 的方式是有人直接改数据库，这既不是"人审"（没有展示待审素材和 provenance 的界面），也不满足第 7 条铁律"FDE/PM 要填的字段必须连 Settings UI 一起做完"。P1 必须一并交付：
  1. 一个待审列表（读 `origin='licensed_stock'` 且 `status='quarantined'` 的行），展示缩略图 + `source_meta`（author / license / license_url / city / landmark）；
  2. 一个激活 / 拒绝动作（`status → active` / `status → rejected`），带操作权限（PM/FDE 角色）和落库回执（谁在什么时间点做的这个决定，存 `source_meta.reviewed_by` / `reviewed_at`）；
  3. 拒绝态（`rejected`）需与 `quarantined`/`active` 三态并列定义，避免被误判为"待审"重复出现在列表里。
  没有这三件，P1"入库可查、人审后才进池"这句话在验收时无法闭环——素材会卡在 `quarantined` 出不来。

---

## 5. 分期（严格顺序：署名闸必须先于任何 CC-BY 图对外）

- **P1**：入库通路 + provenance 落库（含 `license_family` 归一化解析，见 4.2）+ quarantine 开关 + origin 隔离 **+ 待审列表与激活/拒绝入口**（见 4.5，缺这个人审无法闭环）。产物：图安全进库、可查、可人审、**inert（不进池、不发布）**。
- **P2**：evaluate `licensed_stock` 直用分支 + strategist 按 landmark 挑片。查询条件**代码层强制** `license_family ∈ {CC0, PUBLIC_DOMAIN}`（见 4.3），不依赖人审自觉、不单看 `requires_attribution` 布尔值。sourceImagePool 结构改为携带 `license_family` 的条目（见 4.3），为 P3 放宽做准备。产物：CC0/PD 图可进池喂出片；`license_family ∈ {CC-BY, CC-BY-SA, UNKNOWN}` 的行即使 `status='active'` 仍被查询排除，物理上进不了池。
- **P3**：发布前署名闸（fail-closed）。P3 落地并验证通过后，才把 4.3 的查询条件放宽为"`license_family ∈ {CC-BY, CC-BY-SA}` 且闸存在则按闸结果放行"；`license_family='UNKNOWN'` 任何阶段都不放宽（见 4.2 第 4 点）。**`CC-BY-SA` 图放宽后仍不进入 i2v 生成分支**（见 4.4 SA 排除机制①），只有 `CC-BY` 图在闸验证通过后可进入 i2v。**在此之前，CC-BY/CC-BY-SA/UNKNOWN 图一张都不许进出片池/发布**；只有 CC0/PD 可先用。

---

## 6. 数据 / RLS
- 复用 `video_clips`，不新建表 → 无新 RLS。
- 若后续为"按景点大规模查询"加列，另起 migration（service_role 模板，见 DECISIONS），本 spec 一期不加列。

---

## 7. 风险 / fail-closed
- 署名闸**必须 fail-closed**：查不到 credit / 查询出错 → 拦发（合规违约是不可逆对外风险，宁可不发）。
- quarantine 默认关：防未审素材自动上线。
- origin 物理隔离：防 Pinterest 清理误删 + 防混淆。

---

## 8. Reuse Statement
- **复用**：stock-pipeline 的下载/上传/去重 IO；client-asset-pool 的"直用不改写"范式；publish-worker 红线闸的 fail-closed 写法。
- **新增 platform-shared**：`origin='licensed_stock'` 通路 + evaluate 池分支 + **发布前署名闸**（发布内核合规能力，全客户通用）。
- **client-specific**：CTS 102 张 + 城市/景点/授权/作者（per-row meta，client_id 隔离）。
- **未**将任何客户城市语义写入共享常量（scene_tag 白名单原封不动）。
- 落点与 tier 判定一致：机制在 shared runtime，客户事实在 per-row。

---

## 9. 待办 / 立项后下一步
1. 2 审：子牙（架构，尤其 evaluate 分支与 client-asset-pool 对齐）+ 魏征（挑刺，尤其署名闸 fail-closed 与 provenance 传递）。
2. 跟 task_7c3297ff 窗口对齐 Pinterest 清理判据。
3. 法务/PM 确认：i2v 重绘对 CC-BY-SA 的 SA 义务边界（决定 CC-BY-SA 是否允许喂 i2v）。
4. 走五道 Build Gate → 分期实现（P1→P2→P3）。

---

## 2 审结论与方向调整（2026-09-07，子牙 + 魏征）

**两审一致：原"把授权真图灌进工厂"的设计按现状建不成，且方向本身有个根本问题。**

**根本问题（魏征拿代码坐实，evaluate.ts:181-193 / 228-229 / strategist.ts:346-367）**：工厂里静态图**唯一去处是喂 i2v 生成全新 AI 片**，没有"真图直用"的代码路径。所以把真实地标照片灌进工厂 = 被 i2v 重画成 AI 画面 → ①"真实"卖点蒸发、变成 PM 骂的假/通用画面；②CC-BY 成了衍生作品、CC-BY-SA 的 SA 传染在工厂里躲不掉。§2 G1、§4.3 的"直用不改写"与代码事实冲突。

**建不成的具体阻断（两审共识）**：
1. **provenance 在入池即死**：sourceImagePool 被拍平成 `readonly string[]`（只剩 URL），license/author 丢失；CTS recipe 路径 `clip_links=[]`（evaluate.ts:376），行级链恒空 → 发布层物理上拿不到"谁拍的" → §4.4 署名闸无法校验。
2. **署名闸只做闸=死锁**：buildCaption 无 credit 字段、也无注入器；只加"无 credit 就拦"会把每条 CC-BY 片永久 fail-closed 发不出。必须"注入器 + 闸"成对，且 credit 得是可字符串校验的字段（endcard 烧进像素的没法扫）。
3. **P2/P3 窗口敞口**：§4.3 进池分支没有 `requires_attribution=false` 过滤 → P3 未上线前 CC-BY 会漏进池发布。
4. **quarantine 是 fail-open**（DB 默认 active，必须显式写 quarantined）；**人审 active 无 UI 入口**（会踩"让 PM 手改库"红线）；**按 landmark 挑片**要把整个池契约从 string[] 改成带 meta 结构（波及 strategist/recipe/types，非小改）。
5. task_7c3297ff（Pinterest 清理）隔离承诺**本仓无法核对**（代码不在此仓）。
6. 附带：`video_clips` RLS `FOR ALL USING(true)` 缺 `TO service_role`（铁律 7），另开小 PR 修。

**方向调整（PM 2026-09-07：两条线并行、分场景）**：
- **真实感片 → 蒙太奇线（make_promo）**：真图加运镜、图不变。这批 102 张需署名授权图（CC-BY/CC-BY-SA）归此线（本就读 Dropbox）。自动化 = 把蒙太奇线搬云端（见 `2026-09-02` 云端退役调查：Path A 需把 make_promo + MagicLab_Studio 素材上云 + 定成本模式）。
  - 🔴 **"人工带署名"不能作为唯一保障**：全仓检索 `make_promo` / `MagicLab_Studio` 均无可强制署名或保存发布回执的实现——没有代码路径能保证操作人员没漏填/少填作者、协议链接、修改说明。§4.4 的**发布前署名闸必须覆盖蒙太奇线**，而不是只默认给未来的工厂 i2v 线建：
    1. **provenance 注入**：蒙太奇线取用这 102 张图（或后续任何 `requires_attribution=true` 的 licensed_stock 行）时，必须从 `source_meta` 带出 author/license/license_url/note，写入该次发布工单（不能靠人凭记忆手填 caption）；
    2. **发布前 fail-closed 校验**：蒙太奇成片发布前必须过与 §4.4 相同的署名闸逻辑（caption/endcard 文本含摄影者+协议名+协议链接，缺任一项即拦发），无论发布是走云端 Inngest 流程还是现状的本地 make_promo 脚本；
    3. **机器可读回执**：每次蒙太奇线发布必须落一条回执（request id、用了哪些 source 图、署名校验结果、发布时间），不能只靠人工口头确认或本地日志，比照铁律 3「Inngest 工作流硬约束」的最小回执要求。
    在这三件补齐之前，102 张需署名图**不得**经蒙太奇线对外发布。
- **AI 动感片 → 工厂 i2v 线**：如要用授权 stock 喂 i2v，**只用 CC0/公有领域**（避开 CC-BY 衍生署名死结）；CC-BY/CC-BY-SA 一律不进工厂。§4.3 的 `license_family` 白名单查询条件（见上）就是这条线的强制闸，工厂线**不需要**额外的发布前署名闸——但这只覆盖工厂 i2v 线，不能反过来当作"整个 spec 可以不建署名闸"的理由：署名闸对蒙太奇线仍是必建项（见上）。

**本 spec 后续**：不按原 §4 全量建。工厂 i2v 线缩水为"licensed_stock 入库 + origin 隔离 + CC0/PD-only 进池过滤 + quarantine/审核 UI"，可砍掉 landmark 池改造；但**发布前署名闸不能砍**——它的落点从"工厂 i2v 发布前"改为"蒙太奇线（make_promo）发布前"，因为实际需要署名的 102 张图现在归属蒙太奇线。待 PM 定两线优先级后重写 §4，署名闸章节按上述"覆盖蒙太奇线"的口径改写，不得删除。
