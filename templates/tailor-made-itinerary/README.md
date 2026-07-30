# CTS Tailor-made 行程单模板

面向 **最终客户** 的定制行程 PDF 模板。CTS 同事提供行程内容 → 系统输出一份符合 CTS 视觉规范的行程单，可直接发给客户。

```
templates/tailor-made-itinerary/
├── itinerary-template.html   ← 模板本体（自包含：logo/banner/配图全部内嵌 base64）
├── sample-data.json          ← 示例数据（即 China Grand Discovery Tour 20 天，也是 schema 范例）
├── render.mjs                ← JSON → PDF 渲染脚本（无依赖，只需本机装了 Chrome）
└── README.md
```

---

## 1. 现在就能用

```bash
node templates/tailor-made-itinerary/render.mjs my-trip.json output.pdf
```

`my-trip.json` 按下面的 schema 填写即可。不想用命令行的话：直接用浏览器打开 `itinerary-template.html`，
`⌘P` → 目标改为「存储为 PDF」→ 边距选「无」→ 勾选「背景图形」即可导出同样的结果。

模板已在 Chrome 无头模式实测：20 天行程输出 7 页、6 天行程输出 5 页，页数随内容自动变化。

---

## 2. 文档结构（客户拿到手是什么感觉）

| 页 | 内容 | 设计意图 |
|---|---|---|
| 1 | **封面** — 满版风景图 + CTS logo + 行程名 + 城市线 + 日期/天数/人数 + “Prepared for 客户名” + 报价编号 | 第一眼是「这是专门为我做的」，不是群发的宣传册 |
| 2 | **Your journey** — 行程概述、6 项关键事实（天数/人数/酒店星级/导游/司机/交通）、行程亮点、专属顾问名片 | 客户 30 秒内知道全貌；顾问是有名有姓的人，不是 info@ |
| 3+ | **Day by day** — 每天一张卡片：大号日号、城市/路线、日期星期、正文、Travel / Stay / Meals 标签 | 最常被反复查阅的部分。「第 9 天住哪」一眼可见 |
| 尾 | **What is included** 含/不含双栏 → **价格** → **Costs to allow for** → **Please note** 条款 | 商务信息集中在后段，先让客户爱上行程再谈钱 |
| 末页 | **Ready when you are** 三步下一步 + 联系方式 + TAANZ/IATA/Qualmark/TEC 资质 + logo 落款 | 明确的下一步 + 信任背书收尾 |

**页头**：每页顶部红/金色条 + CTS logo + 行程名与报价编号。
**页尾**：公司名 · 0800 电话 · 邮箱 · 网址 + `Page X of Y`。

**关键细节**：单日卡片永不跨页断开。模板用 JS 先量高度再分页（`render()` 里的 `paginate` 逻辑），
标题也不会孤立地留在页尾（`keepNext`）。这是纯 CSS 分页做不到的，也是客户文档最容易露怯的地方。

---

## 3. 数据 Schema

这是**未来工具需要产出的唯一契约**。所有字段都是字符串，除非另有说明。留空的字段不会渲染（不会留下空标签）。

```jsonc
{
  "meta": {
    "quoteRef":   "CTS-2027-0142",     // 报价编号，出现在封面和每页页头
    "issuedDate": "27 July 2026",
    "consultant": { "name": "", "title": "", "phone": "", "email": "" }
  },
  "client": {
    "name":       "Mr & Mrs Thompson",  // 封面 "Prepared for"
    "travellers": "2 adults, twin share"
  },
  "trip": {
    "title":     "China Grand Discovery Tour",
    "route":     ["Beijing", "Xi'an", "Shanghai"],   // 数组：封面城市线 + 第 2 页路线带
    "dateRange": "8 May – 28 May 2027",
    "duration":  "20 days",
    "heroImage": "",                    // 留空用默认长城图；可填 https:// 或 data: URI
    "summary":   "一段概述（2–4 句）",
    "highlights": ["亮点 1", "亮点 2"],
    "facts": [ { "label": "Duration", "value": "20 days / 19 nights" } ]  // 建议 6 条，3 列排布
  },
  "days": [
    {
      "day": 1,
      "date": "8 May", "weekday": "Saturday",
      "route": "Auckland → Guangzhou",  // 卡片主标题：城市或 A → B
      "body":  "当天正文，一段即可",
      "travel": "Flight CZ306 · Auckland → Guangzhou · dep 22:30",  // 可选
      "accommodation": "New World Centre Tongpai Hotel or similar 4★", // 可选
      "meals": "Breakfast"              // 可选
    }
  ],
  "pricing": {
    "basis": "Land only, per person, based on two people sharing a twin/double room",
    "currency": "NZD",
    "amount": 6480,                     // 数字 → 渲染大号价格；null → 渲染 amountNote
    "amountNote": "Quotation issued separately — see covering email",
    "optional": [ { "label": "国内段机票（估）", "value": "NZD $490 per person" } ]
  },
  "inclusions": ["..."],
  "exclusions": ["..."],
  "notes":      ["..."],                // 条款提示，红边框区块
  "nextSteps":  [ { "title": "", "body": "" } ]   // 建议 3 条
}
```

---

## 4. 未来的工具怎么接

同事「用自然语言或复制粘贴发出来」→ 出 PDF，链路是：

```
同事粘贴的原始文本
   ↓  ① Claude 抽取（唯一需要用到模型的一步）
   JSON（上面的 schema）
   ↓  ② 人工在界面上核对/微调  ← 别跳过这步
   ↓  ③ 注入模板（替换 /*__DATA_START__*/ … /*__DATA_END__*/ 之间的内容）
   ↓  ④ 无头 Chrome 打印
   PDF
```

- **① 抽取**：把 schema 连同原文一起给模型，要求只输出 JSON。日期、航班号、酒店名必须原样照抄，
  不允许模型补充原文没有的信息（价格、餐食、酒店尤其危险 —— 这是要发给客户的文件）。
- **② 核对**：建议做成「左边原文、右边解析结果」的对照界面，顾问确认后才允许导出。
- **③④** 就是 `render.mjs` 里那几行，搬进 Next.js API route 即可。注意生产环境的无头 Chrome：
  Render 上需要用 `@sparticuz/chromium` + `puppeteer-core` 这类方案，而不是本机的 Chrome 路径。

> 现有的 `/itinerary-generator`（`src/lib/itinerary/engine.ts`、`src/app/api/itinerary/*`）是**新西兰本地**
> 行程生成器，景点库、预算算法、14 天上限都是新西兰的，与中国 tailor-made 业务无关。本模板独立，
> 未做任何改动。要做 tailor-made 工具时，建议新开路由，不要在那套引擎上改。

---

## 5. 设计规范

| 项目 | 值 | 来源 |
|---|---|---|
| 主红 | `#B61E2E` | `tailwind.config.ts` → `primary` |
| 金 | `#D6A756` | `secondary` |
| 正文墨色 / 次要 | `#23201C` / `#5A554F` | `ink` / `ink.muted` |
| 米色底 | `#FBF7F0` | `surface` |
| 标题字 | Playfair Display（缺失时回落 Georgia） | 站点 `font-serif` |
| 正文字 | Inter（缺失时回落 Helvetica Neue） | 站点 `font-sans` |
| 版面 | A4，左右页边距 16mm | — |

改色只需改 `itinerary-template.html` 顶部的 `:root` 变量。公司地址/电话/落款改 `CTS_FIRM` 对象。

**字体说明（已知限制）**：本机未安装 Playfair Display / Inter，所以实测导出用的是 Georgia / Helvetica
回落字体 —— 观感依然专业，但与网站不是同一套字。要完全一致，把两个字体的 `.woff2` 以 base64 内嵌
`@font-face` 即可（模板其余资源已经是内嵌的）。

---

## 6. 用示例数据时请注意

`sample-data.json` 是对现有 Word 模板的**忠实转录**，转录时发现原件两处需要确认：

1. **第 19 天（26 May，广州自由活动）原件没有写住宿**，其余每天都有 —— 疑为漏写。
2. **不含项写着「国内段机票（北京→成都，估 NZD 490/人）」，但行程里北京→西安→成都走的是高铁** ——
   这条不含项可能是从别的行程复制过来的。

两处都按原文保留，未擅自修改。
