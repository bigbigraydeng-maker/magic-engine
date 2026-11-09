# Magic Insight 数据研究院 · 出版系列

> **这是什么**：以「Magic Insight 数据研究院」名义对外发布的行业研究报告系列，
> 面向 Magic Engine **高级会员（499 档）** 作为服务附送内容。
>
> **这不是什么**：不是调研工作区。原始调研材料、来源抓取、per-engagement 的过程产物
> 放 [`docs/research/`](../research/)，那边已有成熟约定（`YYYY-MM-DD-<主题>/` + `sources/*.md`）。
> **本目录只放已定稿、可对外的出版物。**

---

## 编辑立场（PM 2026-09-04 定，适用于所有卷）

**这些报告不是写给某一家公司用的。**

它是 Magic Engine 所处的 **digital marketing（海外市场）赛道**的观察与思考——
ME 看到了什么、怎么想的。不是客户方案，不是销售材料，不是给某个客户定制的分析。

**出发点是客观事实，主线是数字化营销机会。**

写法上的具体含义：

| 要 | 不要 |
|---|---|
| 先摆事实，再谈这对做营销的人意味着什么 | 先设结论，再找数据凑 |
| 面向整个赛道的从业者 | 面向某一个客户的痛点 |
| ME 的判断标注为 ME 的判断 | 把判断包装成数据 |
| 承认"这个我们也没答案" | 假装每个问题都有结论 |
| 数据反直觉时如实写反直觉 | 迁就流行叙事 |

**红线（PM 2026-09-04 原话：「一定禁止杜撰数字！太可怕了」）**

> 任何一个印进报告的数字，都必须是**本人在发布方自己的页面上读到的**。
> 不是从记忆里想出来的，不是从转述它的博客里抄的，不是"看起来合理"推出来的。
> 拿不到就写「未取得 + 原因」。**留白不丢人，编造会毁掉整个系列。**

这条红线的由来见下方「为什么 Vol.01 / Vol.02 被作废」。

---

## 与 `docs/research/` 的分工

| | `docs/research/` | `docs/magic-insight/`（本目录） |
|---|---|---|
| 性质 | 调研工作区 | 对外出版系列 |
| 组织方式 | 按调研次数 `YYYY-MM-DD-<主题>/` | 按卷号 `volNN-<主题>/` |
| 内容 | 原始材料 · 来源抓取 · 过程记录 | 定稿报告 · 数据台账 |
| 受众 | 内部 | 高级会员（对外） |
| 是否过发布闸 | 否 | **是，强制** |

一次调研可能产出多卷，也可能一卷都不产出。两者不是一一对应，**不要互相复制内容**，用链接互指。

---

## 卷目录

| 卷 | 主题 | 日期 | 状态 | 目录 |
|---|---|---|---|---|
| Vol.01 | 中国入境游海外客源市场 | 2026-08-27 | 🔴 **已作废** | 由 Vol.04 重做 |
| Vol.02 | 中国 → 澳洲零散单物流 | 2026-09-03 | 🔴 **已作废** | 由 Vol.05 重做 |
| Vol.03 | 中国 → 新西兰小批量物流 | 2026-09-03 | ✅ 已发布 | [`vol03-nz-china-freight/`](./vol03-nz-china-freight/) |
| Vol.04 | 中国入境游客源市场与数字营销机会 | 2026-09-04 | ✅ 已发布 | [`vol04-china-inbound-tourism/`](./vol04-china-inbound-tourism/) |
| Vol.05 | 中国 → 澳洲小批量物流与数字营销机会 | 2026-09-05 | ✅ 已发布 | [`vol05-au-china-freight/`](./vol05-au-china-freight/) |

### 为什么 Vol.01 / Vol.02 被作废

两卷在起草时**未跑任何一次实时数据查询**，却给自造数字配上了权威来源标注
（ABS、Google Ads Keyword Planner、国家移民管理局、Trip.com 财报）。
事后 34 个 agent 全量核查：**150 条数字里仅 13 条 VERIFIED**，
CONTRADICTED 64 · UNVERIFIABLE 32 · NO_SUCH_DATA_EXISTS 26 · CLOSE_BUT_OFF 15。

典型问题：
- 引用了**根本不存在的数据源航段**（FBX 大洋洲航段）
- 描述了一项**从未执行的调研**（「抽样约 40 家 · 审计时间 2026-08」及 16 项百分比）
- **真假掺杂**：北京客源表 8 国里 3 个与官方数据逐位吻合，另 5 个编造且系统性低估
  （法国印为 −2%，官方实为 **+24.9%**，正负号相反）——真数字反而给假数字背了书

两卷的 PDF 已从本机删除，源文件不入库。事故记录见
[`docs/registry/platform-candidates.md`](../registry/platform-candidates.md) 对应候选条目。

**Vol.01 已由 Vol.04 重做**（2026-09-04）。重做过程本身值得记一笔：
第一稿仍只用了北京一个城市的数据，PM 当场追问「那么多口岸城市呢？上海呢，广州呢？」——
补查后发现 **上海才是外国客第一门户**（713.9 万人次，占全国 20.3%），北京只占 13.0%。
原稿整节结论建立在一个 13% 的样本上却当成了全国画像。
**"标成数据缺口"不等于"查过了"** —— 能查到的就该去查，这条已写进上方出品流程第 1 步。

**Vol.02 已由 Vol.05 重做**（2026-09-05）。这次的教训不是编造，而是**"混"**——
6 路并行 agent 采集了 62 条一手数据本身没有造假，但初稿把不同分母的比例并排放
（"中国占进口 19.8%"是货物+服务、"家具占比 74.4%"是仅货物，两者不可比较）、
把货代营销页报价当成事实印（LCL/FCL/空运具体价格）、把经验值写成精确数据
（"破本点 14–15 CBM"）、还把一句找不到出处的归因安在了错误的数据源头上
（"NAB 含海外商户"实际来自 NAB 自己都未在 HTML 页写明的一句话）。
额外跑了一轮**独立敌意核查**（重新打开每个原始 PDF/网页/API 复核）才抓出这些问题。
**一手数据不等于成稿安全** —— 口径标注和"谁的话"必须逐句核对，不能假设采集阶段已经做完全部把关。

---

## 出品流程（强制）

### 1 · 先拿数据，再动笔

**不许凭记忆写数字。** 每个要印出来的数字必须先在一手页面上读到。
- 搜索量 / CPC / KD / SERP → 必须跑 [`src/lib/dataforseo/`](../../src/lib/dataforseo/)，留 receipt
- 官方统计 → WebFetch 发布机构自己的页面，不是转述它的博客或新闻
- 拿不到就写「未取得 + 原因」，**不许填估计值**

### 2 · 记数据台账

每卷目录下必须有 `sources.md`，逐条记录：数字 · 期间 · 口径 · 发布方 · URL · 置信度。
台账是发布闸的输入，也是日后被质疑时的唯一辩护材料。

### 3 · 过发布闸

```bash
npx vite-node scripts/magic-insight-prepublish-check.ts -- docs/magic-insight/volNN-<主题>/report.html \
  --receipt <凭证路径> --artifact <调研产物路径> --source "<来源名>"
```

有 blocking 项**不得发布**，退出码为 1。
七条规则与三类失败模式说明见 [`docs/sops/magic-insight-prepublish-data-check.md`](../sops/magic-insight-prepublish-data-check.md)。

⚠️ **闸门只覆盖「机械错」与「措辞风险」两类。**
「编造」类文本分析看不出来，只能靠 receipt / 产物强制——这是设计边界，不是遗漏。
所以第 1 步不能跳。

### 4 · 人工过四条闸门管不了的

1. 抽查 3–5 个**支撑核心结论**的数字，亲手点开一手源核对
2. 口径对得上吗（FY vs CY、货物 vs 货物+服务、不同机构的不同定义）
3. 同一件事在文档里说了两遍吗，两遍一致吗
4. **删掉所有拿不出凭证的数字后，论点还站得住吗**——站不住就是这一节要重写

---

## 目录约定

```
docs/magic-insight/
  README.md                    ← 本文件，系列登记簿
  volNN-<主题>/
    report.html                ← 报告源文件（可改、可重新生成 PDF）
    sources.md                 ← 数据台账：每个数字 → 期间 → 口径 → URL → 置信度
    Magic_Insight_VolNN_*.pdf  ← 定稿 PDF，对外发送的就是这一份
```

**PDF 入库**（PM 2026-09-03 指定）：本目录是 Magic Insight 报告的唯一存放处，
成品 PDF 与源文件放一起，不散落在 Downloads 或临时目录。

改报告的流程：改 `report.html` → 重跑发布闸 → 重新生成 PDF 覆盖旧的。
生成命令见各卷 `sources.md` 末尾。

---

## 封面（每卷必须有一张设计好的照片封面）

PM 2026-09-04 要求：**每卷一张设计好的封面，Unsplash 配图 + 醒目标题的风格**，
不要清一色深蓝背景——同质化太高。

- 模板：[`_shared/cover.css`](./_shared/cover.css)（全幅照片 + 暗色遮罩 + 大标题 + 品牌角标）
- 每卷换一张**贴题**的 Unsplash 照片（旅游卷用目的地地标，物流卷用港口/货运……）
- **图片存成卷目录里的 `cover.jpg`，HTML 用相对路径 `url(cover.jpg)` 引用**——
  不用 base64。对外交付物是 PDF，生成时图会烘焙进 PDF，国内照样能看；
  换图 = 换一个文件，report.html 保持几十 K 可读可 diff
- **禁用 `text-shadow`**：PDF 阅读器（微信 / macOS 预览）会把文字阴影渲染成白色横条
  （2026-09-04 实测事故）。文字可读性靠底部实色遮罩，不靠 shadow
- 遮罩已保证白色标题在任何照片上可读，换图不用调标题颜色
- **图片来源必须记进该卷 `sources.md`**（摄影师 + Unsplash 链接 + License）——来源可追溯红线
- 封面照片只作氛围背景，**不含数据主张**，不得选会让人误以为是数据来源或实拍证据的图

选图 + 放置流程：
```bash
# 1. 从 unsplash.com 图片页拿到 CDN 直链（images.unsplash.com/photo-xxx）与摄影师
# 2. 下载 + 优化体积，直接存进卷目录
curl -sSL "https://images.unsplash.com/photo-XXX?w=1600&q=80&fm=jpg" -o /tmp/c.jpg
sips -Z 1500 -s formatOptions 68 /tmp/c.jpg --out docs/magic-insight/volNN-<主题>/cover.jpg
# 3. HTML 里 .cover-img 用 background-image: url(cover.jpg)（相对路径，同目录）
```

---

## 图表体系

**目标**：报告要有足够的信息密度，少留白，用图把结论摆出来而不是只靠文字。
每卷至少 4–6 张图（条形 / 堆叠 / 甜甜圈 / 分叉），表格与图表交替出现。

**技术选择：手写 CSS + inline SVG，禁用 JS 图表库。**

理由是 PDF：报告最终产物是 headless Chrome 打印的 PDF。Chart.js / ECharts 要等 canvas 渲染，
与 `--virtual-time-budget` 抢时序，偶发画一半或全白——**而 PDF 出错没人会发现**（图是空的但版面正常）。
CSS 与 SVG 是声明式的，浏览器一次布局就定稿。

- 共享模板：[`_shared/charts.css`](./_shared/charts.css)
- **必须内联进每份 `report.html`**，不要外链——报告要对外发送、单独另存，外链一旦脱离目录图表全散
- 改进了样式请回写共享模板，让后续卷受益

**图表数值必须与 `sources.md` 台账一致。** 改数字要同时改台账，否则图和台账会漂移。

**做完必须真看一眼**（2026-09-04 教训）：发布闸查不出图表画错。
预览面板把本地文件当静态快照加载时视口为 0，`1fr` 列会塌成 0 宽，
**所有柱子不可见但版面完全正常**。用真实宽度截图肉眼确认：

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --hide-scrollbars \
  --window-size=1180,2400 --virtual-time-budget=12000 \
  --screenshot=/tmp/check.png \
  "file://$(pwd)/docs/magic-insight/volNN-<主题>/report.html"
```

---

## 品牌约束

- 署名统一为 **Magic Insight 数据研究院**，副题 `Research Series · Vol.NN`
- **封面与页脚必须出现公司名与官网**：`Magic Engine · magicengine.com.au`。
  封面用「隶属」一栏，页脚版权行写 `© 2026 Magic Engine · Magic Insight 数据研究院出品`。
  ⚠️ **不要写法律主体名** —— 官网页脚本身只声明「© 2026 Magic Engine」，
  且 ME 实体对齐尚未完成，编一个主体名上去会造成对外文件与工商信息不一致
- Magic Insight 是 Magic Engine 旗下**研究出品子品牌**，VI 与 ME 主品牌分开管理
  （主品牌 VI 见 [[reference-magic-engine-vi-package-location]]）
- 页脚必须写明数据分层说明与「不构成经营决策依据」
- **禁止**出现自证清白式表述（「所有数字均可反向溯源」等）——
  这类句子把举证责任压在自己身上，读者找到一处不成立整份就归零。
  发布闸会拦，但更该在写的时候就不写

---

## PM 已拍板的边界

| 项 | 决定 |
|---|---|
| 会员绑定 | **499 档**（通用 + 定制） |
| 发行节奏 | **不承诺**（品质优先于时间表） |
| 数据策略 | 三方公开源二次加工 + ME 现有抓取能力，**不新增付费订阅** |
| 定位 | 高级会员**服务附送**，不独立收费、不承担 P&L 硬指标 |

## PM 待拍板（未决，勿自行推进）

1. **法务边界** —— 免责条款措辞 + 三方数据引用授权。
   「ME 名义 + 研究院署名 + 发给付费客户」三信号叠加，建议正式发行前过一次法务。
2. **编委机制** —— 总编 / 各卷主编 / 发布前谁签字。
   工具与 checklist 已就位，但「谁按下发布键」是人的问题。

---

## 相关

- 平台候选登记：[`docs/registry/platform-candidates.md`](../registry/platform-candidates.md)
  「行业市场研究报告出品能力（Magic Insight 数据研究院）」
- 发布前核查 SOP：[`docs/sops/magic-insight-prepublish-data-check.md`](../sops/magic-insight-prepublish-data-check.md)
- 闸门实现：[`src/lib/magic-insight/prepublish-check.ts`](../../src/lib/magic-insight/prepublish-check.ts)
- 调研工作区：[`docs/research/`](../research/)

---

## 历史

- 2026-09-03 · 建立。同日 Vol.01 / Vol.02 因数据完整性事故作废，Vol.03 为首个过闸发布的卷。
