# 「CRM 管理」底座设计稿 v1（WP-B）

**状态**：B1 已合并（[PR #2161](https://github.com/bigbigraydeng-maker/magic-engine/pull/2161)）。B2 已合并（[PR #2165](https://github.com/bigbigraydeng-maker/magic-engine/pull/2165)）。B4（并发改档保护）已在 B2 一起做完，不再单独算。B3+B5 已合并（[PR #2166](https://github.com/bigbigraydeng-maker/magic-engine/pull/2166)）。B6（删「今天要联系」页）已实现、过魏征实现复审（漏改的侧栏链接已修），已提审（[PR #2167](https://github.com/bigbigraydeng-maker/magic-engine/pull/2167)）。

**B7（视觉重做）暂停，等板桥有空**：2026-09-28 这轮查过，板桥（非技术视角审查 Agent）当前离线（Remote Control 状态 offline），联系不上。B7 是"颜色/字体/字号统一过一遍"这种主观设计判断，PM 已经点名批评过一次现在的排版，不该在拿不到非技术视角复核的情况下自己一个人闷头重做一遍——那样风险是做完一版 PM 醒来还是不满意，等于白做。B1-B6 全部完成、合并，这是一个干净的停顿点；下一个窗口或板桥上线后再接 B7。
**权威说明**：本文件 + `docs/specs/2026-09-28-crm-rebuild-plan.md` WP-B 节。后者定验收，本文件定怎么做。
**写入者**：本会话（分支序列 feat/crm-priority-section-ui → feat/crm-all-contact-drawer-b2 → feat/crm-kind-filter-b3 → feat/crm-delete-today-page-b6，每个工作包独立分支，B1/B2/B3/B5/B6 均已合并或已提审），唯一。B7 未认领。

## 背景

`docs/specs/2026-09-28-crm-rebuild-plan.md` WP-B 节已经定了验收标准和「今天要联系」独有功能清单。本稿回答「具体怎么改代码」，并拆成可独立提审的子任务（B1–B7）。

## 关键决定

### 决定 1：详情面板用 PersonDrawer，不是 ContactDetail

`crm/all/page.tsx` 现在点一行是就地展开一块 `ContactDetail`；`crm/page.tsx`（今天要联系）点一个人是从右侧滑出 `PersonDrawer`。两份组件独立维护，`PersonDrawer` 已经有 `ContactDetail` 缺的一切：Messenger 回复、邮件回复、一键动作（`drawer-actions.ts`）、`ImportantMarkerEditor`、`MarkWonPanel`。`ContactDetail` 只多一样：WhatsApp 回复（`PersonDrawer` 其实也有，今晚已经加上）。

**换成 `PersonDrawer`**：全部客人点一行 → 从右侧滑出 `PersonDrawer`，删除 `ContactDetail.tsx`。理由：
- 一次性补齐 Messenger / 邮件回复 / 一键动作，不用照抄一遍到 `ContactDetail`（已知坑 5：两份重复逻辑）
- `drawer-nav.ts`（今晚已写、15 条测试）就是为这个场景准备的「上一位/下一位」——用上它
- 这正是「今天要联系」页两轮复审定下的交互（业界调研过 8 家 CRM），只是应用到「全部客人」而不是新建一页——不用重新设计，直接复用已审过的方案

**必须带的两条防线**（v0 稿两轮复审查出，抽屉模式特有）：
- `<PersonDrawer key={row.contactId} ... />`——换人必须重新挂载，否则 A 的笔记记到 B 头上（已知坑 1）
- 多人同时改同一个客人：`advanceContactStage` 加可选 `expectedFromStage` 参数，不传 = 老行为（已知坑 2）

### 决定 2：WP-A 并进 B1，不单独起一个包

WP-A 的漏洞（🤝 同行渠道对 NAL 可见）和 B1（合并首页卡片）改的是同一段代码（`clients/[id]/page.tsx` 诊断与分析区）。查证过的最小修法不需要新数据库字段：`同行渠道` 按 `industryFeatureFlags(industry).tailor_made` 同款机制加一个 `agents` 开关（旅游行业关键词，跟 `tailor_made` 共用**同一个 `TRAVEL_KEYWORDS` 常量引用**，不是复制一份——魏征 2026-09-28 复审点名：复制的话以后改 `tailor_made` 关键词的人不知道还要同步改 `agents`），现有两个客户（CTS=旅游、NAL=非旅游）就能正确区分，不必等"客户级开通"那道 A 级数据库改动。FDE 侧栏已核实（魏征 2026-09-28）：`dashboard-shell.tsx` 的 `buildScopedAdminSections` 本来就没有「同行渠道」这一条，侧栏不用同步改。

「按客户开通、行业只当默认值」那个更彻底的方案，登记进 `docs/registry/platform-candidates.md` 当候选，不阻塞这一轮。

### 决定 3：首页从 6 张卡片收成 1 张

现在 `clients/[id]/page.tsx` 诊断与分析区有 6 张独立卡片：我的客人（仅地产）/ 今天该联系谁 / 全部客人 / 客户消息 / 商务收件箱 / 同行渠道（仅旅游）。收成 1 张「CRM 管理」，指向 `crm/all`；原来 6 个目的地变成 `crm/all` 页面内部的一条子导航（扩展现有 `CrmTabs`，改名 `CrmHubNav`）。

子导航项：全部客人（默认）/ 客户消息 / 商务收件箱 / 同行渠道（条件显示）/ 我的客人（条件显示）/ 决策清单（只读）。

**魏征 2026-09-28 复审查出的窗口期问题（已采纳）**：`crm/page.tsx`（今天要联系）文件头注是「销售在外面用这一页」——B1 就把它从子导航拿掉、B2/B3/B5 还没把它的功能搬完，会有一段只能手敲网址才能到达的窗口期，FDE 天天用的入口凭空消失。**改法**：B1 阶段 `CrmHubNav` 暂时保留「今天要联系」这一项（跟现有 `CrmTabs` 一样直链 `/crm`），等 B6 删页时才一并从子导航去掉。首页卡片照样收成 1 张「CRM 管理」——差别只在子导航多留一项过渡期，不影响 B1 的核心验收（漏洞堵住、卡片收口）。

### 决定 4：「今天要联系」独有功能怎么搬

| 功能 | 搬去哪 | 子任务 |
|---|---|---|
| MessengerReply / EmailReply | 换用 PersonDrawer 自动带上，不用单独搬 | B2（含在决定1里） |
| 一键动作（没打通/已发出等）| 同上，PersonDrawer 自带 `drawer-actions.ts` | B2 |
| 同行/终端客户筛选 + 批量发邮件 | 新增到 `crm/all`：筛选 toggle + 批量发送面板，复用现成的 `kind-filter.ts` | B3 |
| 今天的进度（dayProgress）| 分段模式（`grouped=true`）每段标题旁加「今天已处理 X」，复用 `day-list.ts` 的 `dayProgress` | B5 |
| QuickNote（快速记一笔的预设文案）| 并入 PersonDrawer 已有的一键动作按钮，不单独做一个组件 | B2 |

## 子任务拆分（各自独立可审、可合并）

```text
B1 · 首页收口 + 补上 WP-A 的漏洞
  做：clients/[id]/page.tsx 6 张卡片收成 1 张「CRM 管理」；
      industry-features.ts 加 agents 开关（复用 tailor_made 关键词）；
      agents/page.tsx 拆成服务端外壳（仿 listings/page.tsx）+ 客户端组件，服务端做 clientHasIndustryFeature 闸；
      agents 三条 API 路由（route.ts / customers/route.ts / reply/route.ts）同样加闸（纵深防御）；
      CrmTabs → CrmHubNav，加子导航项（客户消息/商务收件箱/同行渠道/我的客人条件显示）。
  验收：NAL 打开首页和 /agents 网址都看不到/进不去同行渠道；CTS 两处照常；首页只有 1 张 CRM 卡片。
  风险：B（改已上线导航 + 新增服务端闸，不碰 schema/鉴权核心）。

B2 · 全部客人详情面板换成 PersonDrawer
  做：crm/all/page.tsx 点行改成开 PersonDrawer（key={contactId}）；删除 ContactDetail.tsx；
      advanceContactStage 加 expectedFromStage 可选参数；
      补 suggestedChannel 字段缺口（子牙 2026-09-28 复审查出）：src/lib/crm/contact-response-row.ts
      的 responseRowFor() 只把 segment/segmentLabel/temperature 塞进响应行，seg.suggestedChannel 和
      seg.reason 被丢了（segmentContact() 其实已经算出来）；contact-table-types.ts 的 ContactRow 也
      没有这两个字段。不补的后果：PersonDrawer.tsx:154 兜底成 'phone'，对一个只有 Facebook 私信、
      没有电话的客人会硬渲染"没打通"这种电话话术按钮——drawer-actions.ts 头注和
      ContactDetail.tsx:100-101 两处注释都点名要避免的错误，会在这次改动里原样重犯一次。

  魏征 2026-09-28 复审查出、写实前必须先钉住的三点（之前写得太含糊）：
  ① drawer-nav.ts 目前零调用点，PersonDrawer 里根本没有上一位/下一位 UI——不是"接上"这么简单。
     具体接法：PersonDrawer 新增 header 按钮；调用方（crm/all/page.tsx）负责把 sections[key].items /
     sectionPages[key] / sections[key].total 组装成 loadedIds/sectionPage/sectionTotal 传给
     nextNavStep()；need_more 时调用方异步拉下一页，拉完后按 openFirst 打开首位或末位并重新组装。
     这一段状态机在 crm/all/page.tsx 里新增，不是 drawer-nav.ts 本身要改。
  ② 直达链接的滚动目标要跟着改：crm/all/page.tsx:257-262 现在滚到"表格行"（因为详情撑开那一行）；
     换成抽屉后详情不再撑开行，滚到普通行 + 右侧弹抽屉是两件割裂的事。改法：deepLink 命中后不再
     scrollIntoView 到行，而是直接触发"打开抽屉"（跟点击行同一个函数），不需要滚动定位。
  ③ viewerEmail 三处手写具体是：src/app/api/clients/[id]/crm/contacts/route.ts 的三条响应路径
     （分页 / 分段 / 直达）。挪法：三条路径共用同一个 buildContactsResponse() 收口，viewerEmail
     在收口函数里填一次；新增测试对三条路径分别断言 viewerEmail 非空。
  验收：点开任意人能回私信/邮件/WhatsApp；连续点两个人各记一笔互不串；换人不丢乐观更新中的星标；
      suggestedChannel 从接口到 DrawerRow 全程带上、不依赖兜底默认值（新增测试钉住）；
      分段模式下上一位/下一位跨页正确（含段尾不自动跳段）；直达链接展开的是抽屉不是空表格行。
  风险：B，大任务（改动 >3 文件、影响已上线功能）——子牙+魏征两审。

B3 · 同行/终端客户筛选 + 批量发送
  做：crm/all 加 KindView 筛选 toggle；批量发邮件面板（复用 batchRecipients/filterBucketByKind）。
  验收：切筛选后总数、列表、批量地址三者一致；"今天已处理"的人不出现在批量地址里。
  风险：B。

B4 · 并发改同一个人的保护（若 B2 未含）
  做：写测试证明 expectedFromStage 生效，老调用方（nal-mark-won 等）不受影响。
  风险：C，跟 B2 合并提审。

B5 · 分段视图加「今天进度」
  做：grouped=true 时每段标题旁显示 dayProgress。
  风险：C。

B6 · 删除「今天要联系」页
  做：crm/page.tsx 改成 redirect 到 crm/all；删 QuickNote.tsx（确认无其他调用方后）；
      修复遗留链接：crm/unclaimed/page.tsx:96、contacts/page.tsx:316（若仍指向旧页）。
  验收：旧网址跳转不 404；今日待办/邮件链接不受影响（已核实都指向 /crm/all）。
  风险：B，最后做——前面几步不完成删了就是丢功能。

B7 · 视觉重做
  做：颜色/字体/字号统一过一遍 crm/all + PersonDrawer + CrmHubNav，板桥过目。
  风险：C，放最后，免得结构还在变时反复重做样式。
```

**顺序**：B1 → B2（+B4）→ B3 → B5 → B6 → B7。每个子任务独立 PR，各自过风险质量闸；B2 是唯一硬性大任务，子牙+魏征两审。

## 已知坑核对表（v0 稿两轮复审的 8 条，逐条落实到哪个子任务）

1. 换人不重新挂载 → B2（`key={contactId}`）
2. 并发改同一人 → B2/B4（`expectedFromStage`）
3. 待办文案写死版面用词 → B6/B7 改版面时同步查 `manual-crm-items.ts:272/342`，加测试防漏改
4. 缺「按 id 取单个人」接口 → 若 B2 用 PersonDrawer + 现有 `crm/all` 数据流，直达链接走的是 `?contact=` 参数 + 已加载列表匹配（`crm/all/page.tsx:242-263` 已有），不一定需要新接口——B2 实现时核实，需要再加
5. 两份重复逻辑（ContactDetail vs PersonDrawer）→ B2 直接删掉 ContactDetail，天然解决
6. viewerEmail 三条路径各写一份 → B2/B3 涉及改动时顺手挪进响应公共类型
7. 预取时间线要能取消 → 已有 `timelineReqRef` 防乱序机制，PersonDrawer 换成后确认沿用
8. `getPriority` 的 `.order('id')` 别跟 `getPaged` 的排序"统一" → 不动 `contacts/route.ts` 这部分，写回归测试钉住

## 不做

- WP-C（AI 标签/排序）—— 等本设计稿全部落地
- 「谁发的」写入侧改造 —— 另一份台账（`2026-09-28-start-recording-outbound-sender-attribution`）
- 点击拨号 —— 另一个工作包
