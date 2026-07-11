# SOP · 新客户 Discovery 段扫盘（并行分身 pattern）

> **归属**：DAPE-D（Discovery 段）· 司马徽 agent 未上线前的手工版参考实现
> **首次验证**：2026-07-10 Roman Hu 客户案例（Ray White Mission Bay 华人四语中介）
> **适用范围**：任何新客户接入的第一周 · 竞对分析 · 市场速写 · 本地媒体扫盘 · 战场地图

---

## 一、何时触发

任何满足以下之一：

1. **新客户签约后的第 1-3 天**（self-serve 或 FDE 都适用）
2. 客户提出**跨行业 / 跨地理**新业务方向，需要重新扫场景（如 Roman Hu 从西区跳东区）
3. FDE 月度**竞品动态回顾**（每 30 天重跑一次同 pattern 快扫）
4. 客户提出的**具体竞对名单**，PM 需要"Roman Hu 想调研 Aaron Foss、Paul Neshausen…"这类

**不适用**：
- 需要付费数据源精细数据（Ahrefs backlink / Similarweb 流量 / Apollo 决策链）→ 走 MCP
- 客户业务 KPI 数据（GA4 / GSC / Meta Ads real data）→ 走 connectors
- 内部工程代码审计 → 用 Explore agent

---

## 二、PM 输入准备（Discovery 触发前收齐）

| 字段 | 必填 | 例（Roman Hu 案例） |
|---|---|---|
| 客户名 + 一句话业务 | ✅ | Roman Hu · 华人四语房产中介 |
| 主要目标地理 | ✅ | Bayside + Central Gold（附地图截图更好）|
| 具体竞对名 3-5 个 | ✅ | Aaron Foss / Paul Neshausen / Lawrence Yuan / Sarah Liu |
| 客户已知短板 / 期望 | 建议 | "想通过 Meta 视频 + WhatsApp + 免费咨询建漏斗" |
| 客户所属公司 / 品牌 | ✅ | Ray White Mission Bay · Head of Projects |
| 客户 4 大公开档案 URL | 建议 | LinkedIn / 官网 / realestate.co.nz / OneRoof |

**PM 手上没有 → 让客户 15 分钟填一份 onboarding form 补齐** · 别硬开工。

---

## 三、第一波 · 广扫盘（4-5 个 Agent 并行）

**关键**：一次派齐 · 不要串行 · 每个分身独立跑 · 分身之间不共享上下文。

### 派单结构

| Agent | 任务 | 输出长度 |
|---|---|---|
| Agent 1-N | **每个竞对一个分身**（4 竞对 = 4 分身）| 500 字/份 |
| Agent N+1 | **市场速写**（房价 / 学区 / 人口 / 目标客群 / Meta 渗透 / 中文平台）| 500 字 |

### Prompt 骨架（复制改客户名 & 竞对名即可）

```
调研 [目标地理 · 中英双写] 的 [客户所属行业] [竞对姓名]，用于为
新客户 [客户名] 做竞争分析。

用 WebSearch + WebFetch 拿真实公开数据（不能凭空编）。查以下：

1. 挂在哪家公司？（列常见主流品牌供参考）
2. 主打区域 / 覆盖 suburb
3. 语言 / 目标客群
4. 网上能查到的近 12 月成交 / 客单 / 交易量级
5. 个人网站 / 落地页 URL · 是自有域名还是挂在公司下
6. Facebook / Instagram / LinkedIn 有没有个人品牌账号 ·
   关注数 / 内容频率 / 有没有跑广告
   （看 Meta Ad Library https://www.facebook.com/ads/library/ 搜他的名字）
7. YouTube / TikTok / 小红书 / WeChat 有没有？
8. 有没有 review / testimonial？（GBP / RateMyAgent / 行业口碑）
9. 差异化定位是什么？
10. 有明显短板 / 空白吗？

500 字以内报告，结构：
【一句话定位】【所属公司】【区域】【客群】【近 12 月活跃度】
【个人域名/网站】【社媒清单+粉丝量+更新频率】【是否跑 Meta 广告】
【差异化】【明显短板】【链接清单】

如果查不到就明说"无公开数据"，绝不编。
```

### 硬约束（每份 prompt 必写这两句 · 不要省）

1. **"查不到就明说'无公开数据'，绝不编"** —— ME 项目 CLAUDE.md 强约束（CTS queenstown inbound / Oztop vinyl/shutters 编数据事故教训）
2. **"如实标出无法验证的项 · 给出 PM 15 秒可核的直达链接"** —— Meta Ad Library 是 SPA / LinkedIn HTTP 999 / RateMyAgent 403 / FB IG 精确粉丝需登录 · 全部老实标"未拿到"

### 并行派法

用 Agent 工具 + `general-purpose` subagent_type · 一条消息里发**多个 Agent 调用**并行：

```
[单条消息包含 5 个 Agent 调用]
Agent(desc="Research 竞对 1", prompt=...)
Agent(desc="Research 竞对 2", prompt=...)
Agent(desc="Research 竞对 3", prompt=...)
Agent(desc="Research 竞对 4", prompt=...)
Agent(desc="Market context", prompt=...)
```

**wall-clock**：~5 分钟 · 每份 ~9k token · 主上下文只承担合成

---

## 四、第二波 · 深挖（2-3 个 Agent 补漏）

第一波报告到齐后，读一遍找 3 个最重要盲点，再派 2-3 个深挖分身：

**典型盲点场景**：
- 竞对是否付费投 Meta → 单独派一个 agent 挖 Meta Ad Library + FB Page 内容策略
- 客户身份或前情**发生变化**（Roman 从 B&T 跳 Ray White）→ 派一个 agent 挖新东家 / 新头衔 / 新集团资产
- 本地媒体 / newsletter / 社区平台调研（第一波常漏）→ 派一个 agent 扫本地报刊 / FB Group / EDM / 播客 / 华人媒体
- 华人段渠道（小红书 / 微信 / 天维网 / Chinese Herald / 中文电视电台）

**第二波 prompt 骨架必带**：

```
你是这次调研的**唯一执行人**，不要再 delegate 给别的 agent，
也不要说"agent launched"。直接用你手上的 WebSearch + WebFetch
工具亲自查、亲自写报告。
```

**踩过的坑**：第一次派的本地媒体 agent 误认为要转发任务，输出了"Agent launched in background"就退出 · 什么都没查到。加上"你是唯一执行人"这句就好了。

---

## 五、报告固定 schema（分身回稿必按此结构）

所有分身报告要**同一 schema**，主 session 合成才不痛苦：

```
# [竞对姓名] · 竞争分析

【一句话定位】
【所属公司】
【区域】主打 / 延伸
【客群】语言 / 画像 / EN 中文比例
【近 12 月活跃度】成交数 / 客单价 / GMV
【个人域名 / 网站】DNS 亲验状态
【社媒清单】FB / IG / LinkedIn / YouTube / TikTok / 小红书 / WeChat 各粉丝量
【是否跑 Meta 广告】Y/N + 证据
【小红书 / 微信矩阵】（华人段专属）
【差异化】3-5 点
【明显短板 · 我方可利用的攻击面】3-5 点
【链接清单】所有原始 URL
【数据获取失败项】老实标（Meta Ad Library / LinkedIn / GBP review 等）
```

---

## 六、主 session 合成阶段（不派分身 · 亲自做）

合成必须在主 session · 因为需要**跨报告 pattern matching**（"全部撞同一堵墙"这类洞察分身看不到）。

### 合成产出的 4 大骨架

1. **竞争白地图矩阵**：9-12 维度 × 4 竞对 × 客户 · 找出**全部 ✗**的行 = 白地图机会
2. **客户武器 vs 短板**：诚实盘点 · 短板必须包含**红线项**（如域名未 rebrand / 平台身份未同步）
3. **多线漏斗处方**：至少 3 线 + 1 独家杠杆
4. **90 天路线 + KPI + 预算**：D1-30 抢救期 / D31-60 起势 / D61-90 转化 · KPI 12 个数字 · 月预算表 · 打平模型

---

## 七、交付 HTML deck 结构模板

调研完直接进中文 HTML memo · 存 `docs/clients/[客户名]/[YYYY-MM-DD]-discovery-deck.html`：

**关键设计**：
- 章节 markers 用中文数字 `壹 贰 叁 肆 伍 陆 柒 捌`（不用 01 02 03 默认）
- 竞争矩阵 table 用 `overflow-x: auto` + tabular-nums
- 红线警报用 `border-left: 3px solid signal` 非满色卡
- 免用 emoji · 华人段 accent 用沉稳古铜金 `#A88342`（不用扎眼金）
- 客户品牌色映射进 CSS token（Roman 案例用 Ray White navy #002542）

**复用**：Roman 案例源文件在 scratchpad `roman-hu-strategy-deck.html` · 下次改客户名 + 竞对名 + 数据行即可。

发布用 Artifact 工具 · 默认私有 · PM 决定分享时机。

---

## 八、已知限制清单（每次跑必知）

| 限制 | 应对 |
|---|---|
| Meta Ad Library 是 SPA · WebFetch 抓不到详情 | 老实标"需 PM 15 秒人工核" · 给直达链接 |
| LinkedIn HTTP 999 反爬 | Google 快照代替 · 不精确 |
| RateMyAgent HTTP 403 | 拿到评分数字即可 · 不深挖 review 内容 |
| IG / FB 精确粉丝数需登录 | 拿"存在 + 大致量级" · 不追精确 |
| Stats NZ 细分族群 % suburb 级 | JS-loading · WebFetch 拉不到 · 用总亚裔 % 代替 |
| Ahrefs / Similarweb / Apollo 需 OAuth | 非交互 session 无法 auth · 记 PM 授权后二次跑 |
| 大部分本地广告价格 | 需邮件询价 · 报告里给联系人 · 不编价 |
| DNS 是否注册 | 用 `dig` 亲验（比 Google 快照硬）|

---

## 九、验证清单（session 结束前跑一遍）

- [ ] 所有分身报告到齐 · 无一个 "agent launched" 空退出
- [ ] 竞争矩阵表填满 · 每格有具体证据（数字 / URL）
- [ ] "不确定"项标红并给 PM 手动核链接
- [ ] 客户红线项列出（域名 / 平台身份 / 品牌资产迁移风险）
- [ ] 三线漏斗 + 独家杠杆识别到位
- [ ] 90 天路线 + KPI + 月预算 · 12 月打平模型算清
- [ ] 存 `docs/clients/[客户名]/` + 发 artifact · 更新 CLAUDE.md § 当前焦点

---

## 十、案例引用

- **首次跑通**：Roman Hu · 2026-07-10 · deck v1 [`scratchpad/roman-hu-strategy-deck.html`](../../.claude/scratchpad/roman-hu-strategy-deck.html) · Artifact URL `https://claude.ai/code/artifact/c2cf1103-065c-4816-8bdc-6f8bb3e5351d`
- **memory 沉淀**：[[project-roman-hu-ray-white-mission-bay]] · [[feedback-parallel-discovery-agent-pattern]]

---

## 十一、未来自动化路径

这套手工版 SOP 是 **司马徽 agent**（DAPE-Discovery 段 · Week 4+ 建）的规格说明。届时：

- 输入：新客户 `client_id`
- 自动读：`clients.brand_aliases` + `master_briefs.competitor_domains` + 客户主关键词
- 自动跑：8 个分身并行（4 竞对 + 1 市场 + 1 深挖 + 1 本地媒体 + 1 华人段专属）
- 自动落库：`competitor_snapshots` 表 + `market_context_snapshots` 表 + `local_media_channels` 表
- 自动出：客户详情页 Discovery tab 直出 HTML deck v0
- FDE / PM 在此基础上 v1 迭代 + 与客户对齐

**Roman 案例的 pattern**（并行分身 + WebSearch/WebFetch + 硬约束 + 中文 memo）就是这个 skill 的 spec。
