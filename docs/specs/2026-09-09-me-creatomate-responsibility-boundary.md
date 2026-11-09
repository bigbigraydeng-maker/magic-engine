# ME ↔ Creatomate 职责边界与接口建议 · v1

> 起草：Claude Code · 2026-09-09
> 依据：本次会话里对 Creatomate 官方 API 文档的实测抓取（[docs/specs/2026-09-09-creatomate-connector-spec-v1.md](./2026-09-09-creatomate-connector-spec-v1.md) §3）+ 已落地代码（`src/lib/creatomate/`，PR [#1513](https://github.com/bigbigraydeng-maker/magic-engine/pull/1513) 已合并）+ 本次会话里对 CTS "Golden China" 真实模板的逐层拆解（在 Creatomate 编辑器里点开每个元素核实过，不是猜的）
> 标注约定：**已验证** = 本次实测确认；**推断** = 按 API 文档字段结构合理推断，未逐条实测；**未知/待测** = 官方文档没写、也没机会实测，标出来不装懂

---

## 一句话结论

PM 提出的三层分工（ME=导演 / Creatomate=执行 / i2v=素材生成 / 素材库=存储）**方向是对的，Creatomate 确实不是、也不应该是决策者**。但有一个隐藏前提容易被忽略：**Creatomate 的"执行"不是无限灵活的通用视频引擎，它执行的是一份提前用可视化编辑器画好的模板**——模板里有多少个"槽位"、槽位是图片还是视频还是文字、每个槽位持续几秒，这些结构性的东西一旦画进模板就基本固定了。ME 的结构化数据只能**填槽**，不能凭空**造槽**。造槽（新增/删减镜头数量、改变镜头顺序的自由度、新的动画风格）仍然需要人在 Creatomate 编辑器里动手改模板——这条边界比"ME 决策、Creatomate 执行"这句话表面看起来更窄，必须在架构里显式画出来，否则会高估系统的灵活性。

---

## 1. Creatomate 可以执行哪些具体的视频制作动作

**已验证**（本次会话在真实 Golden China 模板里逐个点开核实）：

| 动作 | 证据 |
|---|---|
| 素材放置（图片/视频填进指定位置） | 模板里 `Still-1`…`Still-8` 每个都是独立元素，Properties 面板显示 `Provider: URL`，可通过 API 换源 |
| 裁剪/缩放/画幅适配 | 图片元素的 `Fit: Cover` 属性（实测点开过一个 Image 元素，面板显示这个字段） |
| 固定画布尺寸/帧率/格式 | 模板 Template 面板：`Format: MP4`、`Frame Rate: 30 fps`、`Size: 1080×1920`——这些是模板级设置，不是逐次渲染可变的 |
| 字幕/文字渲染 | `T-` 前缀的文字元素，字体/位置/动画都在编辑器里预先设计好，API 只能换文字内容 |
| 转场 | Spec 调研阶段确认过 `transition: true` 会让相邻 composition 重叠转场时长（[creatomate-silent-failures 备忘](../../.claude 已存档 memory)） |
| 入场/退场动画 | Properties 面板有独立的 "Animation" 标签页，每个元素可挂动画 |
| 多轨音频混音 | 模板里 `Music`（全局背景音乐轨）与逐镜头的 `voice`（如果模板设计了这个槽位）是独立轨道 |
| 品牌元素（logo/水印/固定背景） | `Watermark`、`TopFade`、`EndLogo`、`EndBG` 都是模板里锁定/置顶的图层，不随渲染变化 |
| 单帧静态导出（做缩略图） | Template 面板的 `Snapshot` 字段（`Time: 1.5s`，可 Enable/Disable）——按官方计费文档，这类静帧导出只要 1 credit，比整片渲染便宜很多，适合做低成本预览 |
| 渲染出最终视频文件 | `POST /v2/renders` → 轮询 `GET /v2/renders/{id}` 拿 `url`（30 天后过期，必须自己转存） |

**推断**（按官方 API 文档的 dot-path 属性覆盖约定，未逐项实测）：
- 除了整个元素的"内容"（图片/视频/文字），理论上还能覆盖元素的子属性（如 `ElementName.duration`），但本次没有找到一次成功的实测案例，**不能当作已确认能力**。

---

## 2. Creatomate 不应该负责哪些导演决策

对着 PM 列的清单逐条确认，**全部不该给 Creatomate**，原因各不相同：

| 决策 | 为什么不能给 Creatomate |
|---|---|
| 理解客户目标、确定受众 | Creatomate 没有任何语义理解能力，它只认"元素名→值"这种键值对，不理解内容含义 |
| 叙事结构、脚本生成 | 同上——它甚至不知道自己在渲染一个"旅游宣传片" |
| 拆分镜头（分镜数量/顺序） | **这条最关键**：镜头数量和顺序在模板设计阶段就已经写死进时间轴了（Golden China 是固定的 8 个 Shot 顺序播放），Creatomate 的 API 不提供"重新排列镜头顺序"或"临时插入/删除一个镜头"的能力——这不是"决策权"的问题，是**能力真的没有** |
| 选择/请求素材 | Creatomate 只会用你喂给它的 URL，它不会去"选"哪张照片更好，也不会主动去请求生成 |
| 镜头节奏/时长 | 同"拆分镜头"——时长是模板时间轴上的静态属性，不是每次渲染可以自由传参决定的（除非模板设计时特意把 `duration` 也设计成了可覆盖的字段，这需要模板作者提前规划，不是通用能力） |
| 字幕内容 | Creatomate 只负责"把这段文字渲染出来"，不负责"这段文字该写什么" |
| 音乐情绪选择 | 同素材选择——它不理解"这段音乐是不是配这个氛围"，只会播放你给的音频文件 |
| CTA 设计 | 文案/链接内容是 ME 给的值，Creatomate 只是把值放进已经设计好位置的文字框里 |
| 审片/修改 | **Creatomate 完全没有自我校验能力**——本次调研确认的"5 个静默失败点"（动画用 `time:"end"` 元素直接消失、audio 不给 duration 撑爆全片、image 只给宽不给高铺满画面、用错对齐属性、track 号冲突互相顶替）全部是"渲染成功、结果是错的"，Creatomate 自己不会报错提醒你。审片必须是 ME 或人工在渲染**结果**（真实视频帧）上做，不能指望 Creatomate 在渲染**过程**里拦下问题 |

---

## 3. ME 应该通过什么结构化数据控制 Creatomate？建议的 JSON 接口

分两层，中间有一次"编译"：

**上层：ME 内部的"导演剧本"结构**（面向内容/业务语义，是 ME 各模块之间传递的东西）：

```jsonc
{
  "template_id": "18dabcd2-3305-4dc4-adef-6b815144c36a",
  "client_id": "c0000000-...",
  "shots": [
    {
      "slot": "Shot-3",                     // 对应模板里固定存在的槽位名，不是 ME 随便定的
      "visual": {
        "type": "image",                     // image | video —— 由 classifyRenderMode 这类闸决定
        "url": "https://.../p_greatwall_x18709769.jpg",
        "source": "cts_footage_library"       // 素材来源，供审计/署名追溯
      },
      "caption_headline": "GREAT WALL",
      "caption_hook": "at Juyongguan",
      "voice_over_url": null                  // 这个模板没有逐镜头配音槽位就是 null，不是每个模板都有
    }
    // ... 其余槽位
  ],
  "end_card": {
    "tour_name": "Golden China",
    "route": "Beijing · Xi'an · Shanghai",
    "meta": "12 days · From NZD $4,999 pp",
    "departure_date": "Departs 16 November 2026",
    "visa_note": "30 days visa-free for NZ passports",
    "booking_url": "ctstours.co.nz"
  }
}
```

**下层：真正发给 Creatomate 的 `modifications`**（扁平键值对，由上层按模板的"字段映射表"编译得出，这一步就是 `src/lib/creatomate/modifications.ts::buildModifications()` 已经在做的事）：

```jsonc
{
  "Still-3": "https://.../p_greatwall_x18709769.jpg",
  "T-GREAT-WALL": "GREAT WALL",
  "T-at-Juyongguan": "at Juyongguan",
  "EndTour": "Golden China",
  "EndRoute": "Beijing · Xi'an · Shanghai",
  "EndMeta": "12 days · From NZD $4,999 pp",
  "EndDate": "Departs 16 November 2026",
  "EndVisa": "30 days visa-free for NZ passports",
  "EndUrl": "ctstours.co.nz"
}
```

**中间这份"字段映射表"是关键、且必须人工维护**——它描述"这个 template_id 里，Shot-N 对应哪个元素名、EndCard 有哪些字段"，本质上是**模板作者（画模板的人）和 ME（消费模板的系统）之间的契约**，Creatomate 自己不提供"内省"接口告诉你某个模板有哪些槽位（至少本次调研没找到），所以这份映射表目前只能靠人核对模板后手写登记（ME 里已经有雏形：`clients.factory_config.render.creatomate.scene_field_map`）。

---

## 4. Creatomate 需要哪些输入字段才能稳定完成渲染

**已验证**（官方文档 + 实测）：

- `template_id`：必须是这个 API key 所在项目下真实存在的模板
- `modifications`：扁平 `{key: value}`，key 必须**精确匹配**模板里已存在的元素名——打错字不会报错，大概率是那个字段安静地不生效（本次没有逐一实测"打错字段名会怎样"，标记为待验证的风险点）
- 图片/视频类的 value 必须是**公网可访问的 HTTPS URL**，Creatomate 服务端会主动去抓取——所以 ME 这边喂进去的 URL 必须真实存活、不能是私有/带签名过期的链接
- `webhook_url`（可选）：官方文档没有说明回调 payload 的字段结构，也没有签名验证机制——**这意味着 ME 不能把 webhook 内容当作事实来源，必须回头用 `GET /v2/renders/{id}` 独立确认**（本次连接器代码已经这样做）

**推断/待验证**：
- 音频类元素如果要替换源文件，官方文档暗示可能需要同时传 `.duration` 子属性，否则会撞上"audio 不给时长撑爆全片"这个已知坑——但本 MVP 目前没有真实场景触发这条路径，没有实测验证 dot-path 写法本身是否真的按预期工作

---

## 5. 哪些能力必须在 ME 里提前完成

| 能力 | 归属 ME 的理由 |
|---|---|
| 素材选择 | Creatomate 不做"选图"这件事，只做"放图"；ME 这边（本次会话）已经确认要从 `MagicLab_Studio/CTS/footage` 这个素材库选，不是现抓 |
| 镜头时长 | 如 §2 所说，这基本是模板设计阶段就锁死的，ME 目前**没有**通用能力去动态控制某个镜头该播几秒——这条能力如果真要做，需要先跟模板作者约定好哪些时长是可覆盖的，不是默认就有 |
| 字幕文案 | ME 生成（无论是 AI 编稿还是从结构化团期数据取值） |
| 音乐/情绪选择 | ME 决定用哪个音频文件（如果模板设计了可替换的音乐槽位），Creatomate 只播放 |
| 审片 | **必须**在 ME 侧、且必须看渲染**结果**（逐帧截图或播放实际视频），不能只看提交的 JSON 参数"看起来对不对"——这是 CLAUDE.md 已有的"分镜自检表"铁律，Creatomate 的存在不改变这条 |
| 模板结构维护 | 这条 PM 的清单里没列，但必须补上：**谁来维护"这个模板有哪些槽位"这份映射表**，是 ME 里被低估的一块隐性人力成本（见 §8 遗漏项） |

---

## 6. 渲染完成后，Creatomate 能返回哪些结果供 ME 审片

**已验证**：
- `render` 对象：`{id, status, url, error_message}`。`status` 是状态机（`planned→waiting→transcribing→rendering→succeeded|failed|cancelled`），`succeeded` 时 `url` 是产物地址（**30 天后过期，ME 必须立刻转存**），失败时 `error_message` 给出原因文本

**未知/待测**：
- 官方文档没有找到"逐帧缩略图"或"渲染过程日志"这类接口——如果 ME 想做"渲染完自动生成一张 4×2 分镜缩略图供审片"，目前看只能靠 ME 自己下载视频后用 ffmpeg 之类工具截帧，Creatomate 本身不提供
- `Snapshot` 单帧静态导出（§1 提到的 1 credit 功能）理论上可以用来做一个便宜的"渲染前预览"，但这是编辑器里的功能，是否能通过 API 单独调用（不必等整片渲染完）没有实测确认

**结论**：Creatomate 能返回的审片素材目前只有"整条成片本身"，没有更细粒度的中间结果——**审片颗粒度受限于"必须先花整片的钱才能看到结果"**，这个约束应该写进 ME 的审片流程设计里，不要假设可以先便宜地看一眼再决定要不要正式渲染（除非专门去接 Snapshot 功能，且需要额外验证）。

---

## 7. 如果 ME 需要修改某一个镜头，最小修改接口应该如何设计

**关键前提**：Creatomate 没有"局部重渲染"的概念——**每一次 `POST /v2/renders` 都是一次完整的全片渲染**，没有"只重渲这一镜头、其他镜头复用之前结果"这种能力。所以"改一个镜头"在 Creatomate 那一层永远是"整条片子重新渲染一遍、只是 modifications 里某个字段的值不一样"。

基于这个约束，ME 这边的最小修改接口应该长这样：

```
PATCH /api/creatomate-jobs/{jobId}/shots/{slot}
Body: { visual?: {...}, caption_headline?: string, caption_hook?: string }
```

内部行为：
1. 读出这条渲染任务已存的完整 `shots[]` 数组（不用重新生成其它没改动的镜头素材——这一步能省钱，`i2v`/出图 是按镜头独立花钱的）
2. 只替换指定 `slot` 那一项
3. 用更新后的完整 `shots[]` 重新跑一遍 `buildModifications()`，拿到完整的 `modifications`
4. 重新提交一次**完整**渲染（Creatomate 那边无法避免，见上）

**成本含义必须让 ME 的产品/审片流程知道**：改一个镜头的 Creatomate 那部分费用跟从头渲染一次几乎一样贵（不含省下来的 i2v/出图费用）——如果审片阶段要来回改好几轮，这笔渲染成本会累加，不是"改一处只花一处的钱"。这条应该反映在 UI 提示或审片 SOP 里，避免有人以为"小改一下"是免费的。

---

## 8. 适合第一版 MVP 的 ME → Creatomate 工作流程

本仓库已经按这个模型落地了一版（[PR #1513](https://github.com/bigbigraydeng-maker/magic-engine/pull/1513)），可以直接作为 MVP 参考流程：

```
1. ME 导演层产出结构化"剧本"（§3 上层 JSON）
   —— 可以来自 AI 编脚本（planScenes 系列函数），也可以来自结构化业务数据
      （比如本次的团期数据：日期/价格/路线，不需要 AI 编）

2. ME 素材层解析每个镜头的 visual：
   - 有现成真实素材（如本次 CTS footage 库）→ 直接用
   - 没有 → 走 i2v/生成模型产出，写回素材库（带来源/授权标签）

3. ME 编译层：结构化剧本 + 模板字段映射表 → 扁平 modifications

4. ME 提交渲染（Inngest 工作流，付费步骤 retries:0 + 幂等）

5. ME 确认渲染结果：
   - webhook 只当"提前通知"，不当事实来源
   - 独立 GET /v2/renders/{id} 确认真实状态
   - 超时/失败一律落终态 + 转人工待办，不允许安静卡死

6. ME 下载产物，在 30 天过期前转存到自己的存储

7. 审片（人工或未来接视觉审核模型）—— 必须看渲染出来的实际画面，
   不能只看提交前的 JSON 参数

8. 通过后进入发布/CTA 流程（本 MVP 范围外）
```

这条流程本身没有问题，本次要补的是把 §7 的"改镜头"接口和 §5 提到的"模板映射表维护"两块正式纳入设计，目前只有雏形。

---

## 遗漏 / 误区（本次审计发现，PM 原始设想里没提到的部分）

1. **"造槽"能力被低估**：PM 的框架读起来像是"ME 有完全的镜头编排自由度，Creatomate 只负责执行"，但实际上镜头数量、顺序、大致时长在模板设计阶段就已经固定。**新增一种"形状"的视频（比如从 8 镜头改成 12 镜头，或者从"单团深度游"改成"4 团合集"这种本次真实发生的需求）等于需要一个新模板**，这仍然需要人在 Creatomate 可视化编辑器里画（对应本仓已有的"视频剪辑买不做"这条 2026-09 PM 拍板——ME 不打算自建这层能力）。结构化数据能解决"同一个模板反复填不同内容"，解决不了"我要一个全新排布的视频"。

2. **模板字段映射表是隐性运维负担，没有自动化手段**：Creatomate 不提供"内省"接口告诉 ME 某个模板有哪些可填槽位，本次是靠人工在编辑器里逐个点开图层核实的。这份映射表以后每新增/修改一个模板都要人工重新核对、登记，目前没有工具能自动生成或校验它是否仍然和模板保持同步（模板被改了但映射表没更新，会静默地填错位置或填不进去）。

3. **审片颗粒度受限于"先花整片的钱"**：没有找到廉价的中间结果/逐帧预览 API（`Snapshot` 单帧功能有希望但未验证能否脱离整片单独调用），"改一版看一眼"的迭代成本比预想的高。

4. **Webhook 不可信是运营现实，不是可选项**：官方没有签名机制，ME 的架构必须默认"回调内容不可信"，任何"渲染完成"的判断都要回头独立确认——这条本次已经在代码里落地，但如果这份职责边界文档要给别的窗口/团队看，必须显式写出来，不然容易被下一个实现者忽略。

5. **动态时长/动态镜头数控制目前是未验证能力，不是已确认能力**：如果未来 ME 想做"根据配音长度自动调整镜头时长"这类更智能的编排，需要专门立项去验证 Creatomate 的 dot-path 属性覆盖（`Element.duration` 之类）是否真的支持、支持到什么粒度，不能假设它已经具备。

---

## 关联

- [docs/specs/2026-09-09-creatomate-connector-spec-v1.md](./2026-09-09-creatomate-connector-spec-v1.md) — L3 Connector 完整设计与两轮复审记录
- `src/lib/creatomate/` — 已落地代码（PR #1513）
- memory `reference-creatomate-silent-failures` — 5 个静默失败点原始记录
- memory `reference-cts-footage-library-location` — CTS 素材库位置（本次会话新增）
