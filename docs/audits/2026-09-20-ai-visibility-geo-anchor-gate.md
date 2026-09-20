# AI 可见度：品牌判定加「地域锚点」，防同集团海外分公司冒领

- 日期：2026-09-20
- 风险级：**A**（改已上线的共享判定逻辑 + 需要在生产库加一列）
- 分支：`claude/inspiring-kalam-e4fa28`
- 上游：[#1823 / #1837](https://github.com/bigbigraydeng-maker/magic-engine/pull/1837)（Ray White 冒领 Roman Hu，同一类错的英文版）
- 相关未合并 PR：[#1846 CTS 历史回填](https://github.com/bigbigraydeng-maker/magic-engine/pull/1846) —— **本改动会让 #1846 的 137 条清单失效，必须重算**，见文末「两个 PR 怎么排队」

---

## 一句话

**AI 回答里只靠「别名」认出客户时，现在要求原文同时出现客户自己市场的地名；正式品牌名和官网域名永远不受限制。**

CTS Tours NZ 只做新西兰，但配了别名 `china travel service` —— 那是中旅集团的通名，
澳洲、香港的分公司也叫这个名字。实测 3,096 条有原文的历史回答里，**15 条讲的明确是澳洲的中旅**
（原话如 "China Travel Service (CTS), established in 1985, is a premier Australian travel agency"、
"China Travel Service (Australia) Pty Ltd / 中旅澳洲"），一处新西兰信号都没有，却被记成「CTS 被提到」。

---

## 为什么不是别的修法（两条都实测否决过）

| 修法 | 结果 | 出处 |
|---|---|---|
| 把 `china travel service` 从别名里摘掉 | **修好 7 条、弄坏 40 条** —— 那 40 条原文明确是新西兰语境，客户名字就写成 "China Travel Service (NZ) Ltd" | [#1846 计划文档第 1 步](./2026-09-20-cts-ai-visibility-rank-backfill-plan.md) |
| 只在回填脚本里加一条地域规则 | 线上每周还会继续造同类行，历史和现在永远对不上 | 同上「已知没修干净的地方」第 1 条 |

所以闸门必须加在**证据**上，不是加在别名清单上，而且必须加在**线上线下共用的那一份判定函数**里。

---

## 规则

`src/lib/ai-tracker/client-brand-match.ts > admissibleClientIdentifiers`：

1. 客户**没配**地域锚点 → 判定跟以前**完全一样**（逐客户 opt-in，其余 47 个客户零影响）。
2. 客户配了锚点 → **别名**这一类证据，只有在原文里同时出现任意一个锚点时才算数。
3. 客户的**正式品牌名**和**自己的域名**永远不受限制 —— 否则「提到客户但没提国家」的真实提及会被误杀。

配套细节：

- 锚点按**整词**匹配归一化后的原文，所以 `nz` 不会被 `bonza` 命中；中日韩字符走 CJK 分支（`新西兰` 可以匹配无空格中文）。
- 闸门没过时，那家海外同名公司**留在 `brands_mentioned` 里当普通竞品**，不删 —— 它是回答里真实存在的公司，删掉等于抹掉竞品数据。
- **周报品牌排行**（客户能在月报里看到的那张表）改成**按每条回答已经判好的名次**来认客户，
  而不是按品牌名字符串去猜：某条回答判了「客户排第 N」，那条回答里排第 N 的那个名字就是客户，
  并进客户那一行；判了「没提到」的回答，里面那个同名公司就单独成行，不算客户头上。
  `mergeClientBrandVariants` 这个按名字合并的老函数整个删掉了。
- 也接进了**诊断分的实时探针**（`src/lib/diagnostic/ai-visibility-live-probe.ts`），否则客户门户上的 AI 可见度分还按旧规则算。

## 地域词放在哪

新增一列 `clients.brand_geo_anchors text[]` + 后台 Settings 界面「📍 品牌地域锚点」。

**`src/lib/` 里没有任何一个国家名 / 城市名**（CLAUDE.md 铁律 2）。共享代码里只有「怎么用锚点」这条规则，
锚点词本身是客户配置。数据结构沿用 `src/lib/geo-module/types.ts > GeoEntityProfile` 的
`geoAnchorsMultiword` / `geoAnchorsShortWordBoundary` 概念（CLAUDE.md 铁律 0 Reuse First），
但**合并成一个列表**：归一化之后统一走整词匹配，多词锚点和短锚点不需要分两个数组，FDE 只填一栏。

字段跟界面一起做完（铁律 8），FDE 不需要进 Supabase Studio 直填：
- 写入口：`src/app/api/clients/[id]/brand-geo-anchors/route.ts`（GET / PATCH，逐条归一化 + 去重 + 上限 20）
- 界面：`src/app/dashboard/clients/[id]/settings/_components/BrandGeoAnchorsPanel.tsx`（照 `BrandAliasesPanel` 写，读失败显示报错 + 重试，不显示空输入框）

---

## 实测（对 CTS 全部 3,827 条历史回答跑真函数，只读，没写库）

CTS 锚点按 `{new zealand, nz, aotearoa, auckland}` 试算：

| 指标 | 结果 |
|---|---:|
| 有原文可判的回答 | 3,096 |
| 旧规则判「客户被提到」 | 1,768 |
| 新规则判「客户被提到」 | 1,753 |
| 判定发生变化的行 | **15**（全部是「原本记了名次 → 改成没提到」）|
| #1846 人工核对出的 7 条澳洲中旅，是否全部被新规则挡住 | **7 / 7** |

**逐条人工看过这 15 条原文，15 条全部确实是澳洲/香港的中旅**，没有一条误伤。
另外 16 条「只靠别名认出来、但原文带新西兰信号」的行**全部保留**，规则没有碰它们。

### 诚实记账 —— 没修干净的地方

1. **有 1 条澳洲的行仍然通过**（`affb40be`）：原文主体讲澳洲的 China Travel Service Pty Ltd，
   但整篇回答别处出现过 "New Zealand"，整篇口径下锚点算命中。
   试过改成「只看别名所在那一句」：能抓住这条，但会误杀另外 2 条真实的新西兰行（URL 密集的回答断句不可靠）。
   **1 换 2 不划算，所以维持整篇口径**，这 1 条留着。
2. **有 1 条（`21dc3d0c`）连带把解析器编的品牌名 "CTS Tours" 从品牌列表里删掉了** ——
   那篇澳洲回答原文里一次 "CTS Tours" 都没有，是解析器自己安的名字。
   这是这个模块**原有**的「没有原文证据的客户条目一律删」行为，不是这次新加的。
3. **只改 CTS 一个客户的判定结果**，因为目前只有 CTS 会配锚点。
   全库其余客户的同类问题（#1846 记的 169 条误记 / 340 条漏记）**这次一行都不动**。

### 跑过的验证

```
npx vitest run src/lib/ai-tracker src/lib/diagnostic src/lib/industry-ai-visibility
                                                       → 33 files / 554 tests 全过
npx tsc --noEmit                                       → 11 处报错，与改动前基线**逐字节相同**（diff 为空；全在 messenger 测试和 tools/，与本次无关）
npm run build                                          → ✓ Compiled successfully，新接口 /api/clients/[id]/brand-geo-anchors 已产出
```

新增 17 个回归用例：
- `__tests__/client-brand-match.test.ts`（11 个，文本取自真实回答原文）：澳洲原文被挡 / 没配锚点时行为不变 /
  海外同名公司留在竞品列表里 / 带锚点的原文照常认 / 正式品牌名和域名不被闸门碰 / 短锚点整词匹配 /
  CJK 锚点 / 全空白锚点等于没配 / 太短的 CJK 锚点不会把闸门关死。
- `__tests__/ranking-table.test.ts`（6 个，**新文件 —— 这条客户可见路径原本零覆盖**）：
  四种写法合并成一行 / 被判「没提到」的那条不算客户头上 / 同一个拼写在两条回答里按各自判定分开算 /
  客户名次指向的不是客户时不误伤 / 合并后平均名次与分引擎明细正确 / 不传客户身份时只数原始字符串。

**自己抓到并修掉的回归（1 个）**：第一版把「短单词别名」的文本证据规则错误地套到了品牌名匹配上，
打挂了 3 个原有用例（CJK 别名、短别名等）。已拆成两条路径：`isClientBrand` 用完整可用清单，
只有「文本位置证据」那一步才剔短单词别名。

**复审抓到并修掉的回归（1 个 · 子牙 P0）**：第一版把地域闸门也套在周报品牌排行上，
判据是「这个品牌名字符串里带不带地名」。这是错的 —— 一篇几百字的回答里没出现国名是强信号，
但一个三五个词的公司名里没出现国名毫无信息量（绝大多数公司名本来就不写国名）。
实测 CTS 的 7 个品牌键里有 4 个行为被改变，**只有 1 个是想要的效果**，另外 3 个（`CTS` /
`China Travel Service` / `中国旅行社`）会被错误地拆出客户行，客户自己的提及数被劈成好几份。
**已改成按每条回答已判好的名次来认**（见上），并给这条路径补了 6 个回归用例 ——
复审指出它此前**零测试覆盖**，所以「525 个测试全过」当时证明不了这条链路。

---

## 两个 PR 怎么排队（重要）

[#1846](https://github.com/bigbigraydeng-maker/magic-engine/pull/1846) 那份「137 条历史回填清单」是**按旧规则算出来的**。
本 PR 一旦合并，判定规则变了，那 137 条必须**重算一遍**才能执行，否则会按旧规则写生产库。

建议顺序：
1. 先合本 PR（只改规则 + 加一列 + 加界面，**不写任何历史数据**）；
2. 给 CTS 在后台填上 `new zealand / nz / aotearoa / auckland`；
3. #1846 重跑 DRY-RUN 生成新清单，顺手把 `EXCLUDED_AMBIGUOUS_IDS` 里那 7 条**删掉** ——
   规则本身已经能正确处理它们，不需要再手工排除；
4. 新清单给 PM 过目，PM 点头后才 `--apply --confirm` 写库。

**上线顺序硬要求**：`clients.brand_geo_anchors` 这一列必须**先在生产库建好，再合并代码**。
`orchestrator.loadClientContext` 会显式 select 这一列，列不存在则每周的 AI 可见度任务整个失败。
本仓库有过「migration 文件在仓库里但从没在生产跑过」的实际事故
（`20260430000003_add_parse_error_message.sql`，见 #1846 计划文档），所以**判定这一列有没有建好只认对象存在性**，不认文件名。

---

## Platform Tier Classification（Full）

**被判定对象**：AI 可见度品牌判定新增「地域锚点」闸门 + 客户级锚点配置。

**建议层级**：规则本身 = **既有 L1 Capability（AI 可见度）的判定规则扩展**，不新增能力线；
锚点数据 = **L4 Client Configuration**。

**归属**：ME 6 支柱之「AI 可见度」。不新增支柱、不新增垂直版本。

**换客户测试**：✓
- 反例客户 1（Roman Hu，地产）：不配锚点 → 行为逐字不变；将来配 `auckland / mission bay` 同样成立，规则里没有一条只对 CTS 成立。
- 反例客户 2（Oztop，零售）：品牌名 `Oztop` 不是通名，不需要配锚点，规则不触发。

**换行业测试**：✓
- 反例行业 1（地产）：「同名分行冒领」正是 #1823 修的 Ray White 场景，同一条规则可用。
- 反例行业 2（零售/电商）：同名海外经销商同样存在，规则形态不变。
- 权重 / prompt / 默认参数里没有任何行业判断。

**智能层 or 执行手**：智能层 —— 这是 ME 自己对证据强弱的判断，不调外部系统。

**红线检查**：
- 红线 1（禁包装升级）：✓ 不新设能力线，是既有支柱内的判定规则。
- 红线 2（禁客户/行业事实进 shared runtime）：✓ `src/lib/` 里零国家名 / 城市名 / 客户名；`grep -n "new zealand\|auckland" src/lib/ai-tracker/` 零命中（测试文件除外）。
- 红线 3（禁直建 L1）：✓ 不新建 L1，扩展既有 L1，不占候选名额。
- 红线 4 / 5：✓ 见上。
- 红线 6：不适用（非新增 L1）。
- 红线 7：✓ 没有往 Playbook 里塞单客户事实；CTS 的锚点词进 `clients` 行，不进代码。

**PM 待拍板项**：① 在生产库加这一列（不可逆，需显式 `go`）；② #1846 重算后写历史数据（另行请示）。

**结论**：原本想法层级 = L1 扩展 + L4 配置；判定层级 = 一致，不需改口。

---

## Reuse Statement

- **复用了什么已有平台能力**：`geo-module` 的地域锚点概念与 fail-closed 空字符串校验思路；
  `client-brand-match` 既有的归一化 / 词边界 / CJK / 其他品牌跨度剔除全套；
  `BrandAliasesPanel` + `brand-aliases` 接口的读写形态原样照抄。
- **哪些是 platform-shared**：`admissibleClientIdentifiers` 这条规则、`clients.brand_geo_anchors` 这个字段形状、Settings 面板。
- **哪些是 industry-specific**：无。
- **哪些是 client-specific**：CTS 的锚点词 `new zealand / nz / aotearoa / auckland` —— 只存在数据库的 CTS 那一行，不在代码里。
- **有没有把客户名 / 客户 ID / 行业判断写进 shared runtime**：没有。代码注释里出现 CTS 只作为事故出处说明，不参与任何分支判断。
- **学习升级边界**：「通名类别名需要地域佐证」这条经验已泛化成平台规则；具体是哪些通名、哪些地名，仍留在客户配置。
- **本次实现落点与 tier-gate 决策时的分类是否一致**：一致。决策时判 L1 规则扩展 + L4 配置，实现落点就是
  `src/lib/ai-tracker/client-brand-match.ts`（规则）+ `clients.brand_geo_anchors`（配置），没有漂移。

---

## 复审结论

**子牙（架构）· 第一轮：改完才能合。**
P0 一条 —— 周报品牌排行的闸门用错了证据（实测 7 个品牌键里 4 个行为变化、只有 1 个是想要的，且该路径零测试覆盖）。
**已采纳并改完**：删掉按名字合并的老函数，改成按每条回答已判好的名次认客户，并补 6 个回归用例。
P1 三条也已改完：① `admissibleClientIdentifiers` 一词多义 → 更名 `admissibleIdentifiersForAnswer`，
文档里写死「只能传整篇回答，不能传品牌名」，且随 P0 修复只剩一个调用点；
② 两处新 select 的失败方式 → orchestrator 的异常现在带上数据库真实报错（缺列时不再误报「客户不存在」），
诊断实时探针的「查询失败静默降级成空身份」改成直接抛（上游 `runner.ts` 已有 `Promise.allSettled` +
「该维度判为不可知、不给假的 0 分」的既定处理，所以抛是安全且正确的）；
③ 两字 CJK 锚点存得进却永远匹配不到 → 写入接口直接拒收并给中文报错，运行时再兜一道并打警告，加了用例。
P2 已吸收：空白锚点全被丢光时打警告（不再静默当没配）、旧注释已更新、两套锚点概念的边界写进本文档。
他额外确认的三件事：**没有漏接的消费方**（GSC 品牌词匹配不该加地域闸门、industry 采集器不做客户判定、
只读已落库名次的消费方自动生效）、**迁移不需要 RLS 段落**（不是新表，是给既有 `clients` 加可空列）、
**没有不可逆的数据损坏风险**。

**魏征（对抗性挑刺）**：复审进行中，结论回来后补录在此。
