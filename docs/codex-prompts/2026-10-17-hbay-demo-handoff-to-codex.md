# HBay 演示站 · 交接给 Codex（2026-10-17）

> 用法：整段复制下面「提示词」一节，粘进 Codex 新会话。旧写入者（Claude Code 窗口）从此停止写这个站，由 Codex 唯一负责。

---

## 提示词（从这里开始复制）

你现在是 **HBay Water 演示网站** 的唯一写入者。上一任是 Claude Code 窗口，已停手，不会再改这个站。先读完本段再动手。

### 0. 对话规矩（硬要求）
- 和你对话的是**非技术 PM**。回复一律**中文**，先结论再原因；一次只说一件事、一次只问一个问题（给「回 `xxx` 就行」的回法）；技术黑话（merge / PR / commit / endpoint 等）必须当场翻成大白话。代码、变量名、注释用英文。
- 没真跑过的命令不许说成功；没验证的事直说没验证。
- **以下动作必须先问 PM 一句、等他回字才能做：合并到 `main`（等于上线）、花钱（例如生成新图片）、强推、删分支、对外发布。** PM 已多次表态只管业务和花钱，别拿技术细节问他。
- 你不会自动加载别的规则；本提示词就是你的全部指引，缺什么就去仓库里读，别让 PM 贴代码。

### 1. 这个站是什么
- 客户：**HBay Water**（法人 New Zealand Miracle Water Ltd，Hastings, Hawke's Bay）。客户状态仍是 prospect（未签约），这是我们（Magic Engine）做的**设计演示站**，给客户评审用，**不是正式官网**。
- 仓库：`https://github.com/bigbigraydeng-maker/hbay-magic-engine-demo`（公开仓库，主分支 `main`，GitHub Pages 从 `main` 根目录直接发布，无构建步骤）。
- 线上地址：`https://bigbigraydeng-maker.github.io/hbay-magic-engine-demo/design/index.html`
- 客户真实官网是 `nzmiracle.com`（对方的另一套站，不归我们改，只可只读参考）。
- 开始前先自己 `git clone` 该仓库到一个**新的空目录**，别用任何旧的临时目录。

### 2. 现状（我核对过的事实，2026-10-17）
- `main`（线上，head `9202572`）= **10 月 14 日那一版**：首页弱化了工厂，改成「品牌故事 + 4 张 AI 海报」。**PM 看了说「越改越丑」，这版不是他想要的。**
- **PR #3（草稿，未合并，head `1a6edc2`）= 「酒庄午宴」新方向**：`https://github.com/bigbigraydeng-maker/hbay-magic-engine-demo/pull/3`，分支 `home-redesign-benchmark`。这是 PM 在方向选择里亲自选的方向。**没有 PM 点头不要合。**
- 首页新稿的文件：`design/index.html`、`design/home.css`；图片在 `assets/home/`；`PRODUCT.md` 和 `.impeccable/surfaces/design-index-html.md`（方向合同）已写在 PR #3 里。`DESIGN.md` **还没写**（要等 PM 认可方向后再写）。
- 其他页面（`our-water / partner / trade-export / contact / privacy / reports / review`）仍是旧样式，和新首页**风格不统一**：新首页用 `home.css`（亚麻白底、Bodoni Moda 衬线标题 + Hanken Grotesk 正文、细线品酒单排版），其他页用 `site.css / demo.css / brand-v5.css / brand-first.css`（Figtree/DM Sans、蓝粉配色）。它们的导航和链接锚点也和新首页对不上。**这是接下来最大的一块未完成工作。**

### 3. PM 的设计要求（按时间，后面的覆盖前面的）
1. 弱化「工厂」元素，突出「品牌」。首页不放厂房、产能、设备数字；这些只留在「合作」页给批发客户看。
2. 用 **impeccable** 技能做，且要对标同行官网：已看过 Antipodes（新西兰高端水）、Waiakea、Mountain Valley、FIJI、evian。共同做法：一页只有 4–5 块、一种图片风格、**图上不印字**、颜色只用两种。
3. PM 最新的话：必须体现「**品质生活**：来自新西兰的纯净矿泉水，纯天然的逼格和调性，**奢华但又不贵**」。之前两版被否，原因是像「超市货架上的水」。
4. PM 在方向选择里选了「酒庄午宴」（借 Hawke's Bay 是新西兰顶级葡萄酒产区的身份：葡萄园、长桌午宴、酒庄品鉴单式排版）。
5. 受众：新西兰主流超市购物者，英文为主，不做中文、不做华人渠道。

### 4. 内容红线（违反 = 伤害客户）
- 口号只能是 **「More Natural Better Living」**（客户已确认）。
- **不许写**：「government-backed」「top 3 / 前三」「since 2015」（未证实或与客户官网「2020 年上市」冲突）。
- 「250,000 years」只能写成「平原形成的地质年代」，**不是水龄**，必须带说明和出处：Heretaunga Plains Groundwater Study, 1997。
- AI 生成的图一律标注（页面上有 "AI-generated" 字样）。
- 规格（客户官网）：瓶装 330 / 500 / 600 mL、1.5 L；容器 6 / 10 / 16 L；7 L 袋；10 L 盒中袋。
- 超市：PAK'nSAVE、New World 的商品页已核对；Four Square 是品牌披露渠道，链接到门店查询。
- 水质数字（pH 7.3 / TDS 113 mg/L / 钙 18.7 mg/L）来自客户提供的**内部摘要**（引用 Hill Labs 报告 4306093.2），不是实验室证书，必须保留「仅代表一个样品」的说明。
- UI 里不许出现真实第三方供应商名；客户私有信息不写进共享代码。

### 5. 素材
- 仓库内：`assets/brand/hbay-logo.svg`（品牌蓝 `#1E95D4`）、`assets/lifestyle/`、`assets/products/`、`assets/retail/`、`assets/water/`。
- Dropbox（PM 已多次说明：里面的图片/视频**都有授权，别再问**）：`~/Library/CloudStorage/Dropbox/MagicLab_Studio/03_Enterprise/Hbay/`，子目录 `marketing_creatives / product_images / retail_photos / company_images / design_references`。
- **不要把这 4 张海报放首页**：`marketing_creatives` 里的 `Image_20260920105221_45`（跑步）、`..112344_69`（家庭）、`..112521_70`（帆船）、`..114429_74`（雪山三瓶）。它们自带大标题，其中两张写成了错口号 "More Nature"，一张背心上有 New Balance 商标，一张拼成了 "Hawkes Bay"。PM 曾要求放进去（已上线在 `main`），之后我们建议撤下，**最终以 PM 为准**，但别在新首页里默认带回。
- 首屏现用的图是 `assets/lifestyle/vineyard.webp` 裁出来的 `assets/home/long-lunch.webp`（AI 生成，已裁掉原图顶部印的口号）。**评审员认为它「瓶子太亮、像饮料广告」**，最好换成更自然的图；**生成新图要花钱，必须先问 PM**。图里 600 mL 那只瓶子带「压印无标签款」外观，**要向客户确认和真瓶子一致**，确认前不要宣称它是真实产品外观。

### 6. 必须用的方法：impeccable 技能（别只跑检查器）
- 技能在 Magic Engine 主仓库：`bigbigraydeng-maker/magic-engine` 的 `.claude/skills/impeccable/`（`origin/main` 上有；本机 `/Users/raydeng/Projects/magic-engine` 这个检出是旧的，没有它）。本机一份可用的拷贝在 `/Users/raydeng/Projects/magic-engine/.claude/worktrees/goofy-hugle-99592f/.claude/skills/impeccable/`（该工作区将来可能被清理，到时请新克隆主仓库）。你没有 `Skill` 调用接口，所以**直接读 `SKILL.md` 全文和它指向的 `reference/*.md`**，照着做。可执行入口：`<技能目录>/scripts/impeccable`（本机还有预装程序 `~/.impeccable/bin/impeccable` v4.0.0，已能本地运行，不需要联网下载）。
- **血的教训（上一任犯的错，别再犯）**：上一任只跑了 `impeccable detect`（机械检查器：字太小、对比度、间距这类），拿到「0 个问题」就当成「设计好了」，结果页面越改越丑，PM 发火。**检查器 0 = 没有机械毛病，不等于好看。**
- 完整流程：①读 `PRODUCT.md` 和 `.impeccable/surfaces/design-index-html.md`（方向合同，别抄进页面源码）；②改 UI 前读 `reference/craft-floor.md`；③新页面按 `reference/new-work.md`；④做完用**独立评审员**（`.claude/agents/impeccable-finish-reviewer.md` 的角色）看整页截图，**最多两轮**，按评审意见一次批量修；⑤`detect` 在最后跑一次；⑥评审通过后写 `DESIGN.md`（含 `.impeccable/design.json`）。
- 技能里的禁令：标题上方不许加小标签（kicker）、不许 01/02/03 编号、不许卡片三连、不许渐变字、不许发光阴影。

### 7. 怎么本地看效果 + 截图
- 起预览：在仓库根目录 `python3 -m http.server 8901`，打开 `http://localhost:8901/design/index.html`（用完关掉）。
- 整页截图（电脑 1440 宽、手机 390 宽）：用本机 Chrome + Playwright，示例（`PW` 指向 `/Users/raydeng/Projects/magic-engine/node_modules/playwright`；先把懒加载图片滚出来并等全部加载完；截图时把 sticky 导航临时设为 static，否则整页图里导航会跑到中间）：
  ```js
  const { chromium } = require(process.env.PW);
  const b = await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const p = await b.newPage({viewport:{width:1440,height:900}});
  await p.goto(url,{waitUntil:'networkidle'});
  await p.addStyleTag({content:'.nav{position:relative!important}'});
  await p.evaluate(()=>document.querySelectorAll('img').forEach(i=>i.loading='eager'));
  await p.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>0));
  await p.screenshot({path:'desktop.png',fullPage:true});
  ```
  手机同理，`viewport:{width:390,height:844}, isMobile:true`。
- 截图放 `.impeccable/review/`（已被忽略，不要提交）。

### 8. 你的任务（做完就停）
目标：让整个演示站（首页 + 其他 7 页）成为**一套统一的、体现「品质生活 · 奢华但不贵」的酒庄午宴风格**，并做到可以交给 PM 过目。
1. 先复述你理解的范围（3 行内），再动手；先 `git status`、读 PR #3 的 diff。
2. 把「酒庄午宴」风格推广到其余 7 页，统一导航、页脚、锚点（新首页导航是 Tasting notes / The range / Our water / Where to buy；各页互相的链接都要通）。可以抽共用样式文件，但别重写能复用的东西。
3. 处理首页遗留问题：首屏图（需要换图先问 PM 花钱）、手机端「规格单」可读性、水源段缺一张和全页风格一致的明亮图。
4. 全程按第 6 节走 impeccable 流程，最后给每个页面做电脑+手机截图，交独立评审，最多两轮。
5. 提交到**一个新的功能分支**（别直接推 `main`），更新或新建 PR，**保持草稿**，正文写清楚检查前后数字和未解决项。
6. 停止条件：PR 草稿开好、截图给 PM 看完、等 PM 回「合」。**不要自己合并。**

### 9. 交付时必须报的内容（中文、PM 能验证的话）
改了哪些文件；每条真实检查的命令、退出码、结果；哪些没跑；还没解决的问题；分支和最后一次提交；是否已推送/合并（默认没有）；需要 PM 决定的事（一次只问一个）。

---

## 给 PM 的备忘（不用复制）
- 旧写入者：Claude Code 窗口，已停手。新写入者：Codex，唯一一个。两边不要同时改。
- 线上现状不理想（`main` 还是 10 月 14 日那版）；新方向是 PR #3 草稿。让 Codex 先做完统一再请你过目，你点头才合。
- Codex 的活干完后，建议让 Claude Code 里的「子牙/魏征」之类审查角色再独立看一遍，别让 Codex 自己审自己。
