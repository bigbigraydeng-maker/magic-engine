# CRM「订单来源」与「销售进度（座位）」设计稿 v1.2（复用已上线的订单与付款进度；PM 2026-10-13 明确「不要金额」，金额整块已撤；PM 批准前不写代码、不改生产库）

日期：2026-10-13 · 风险级：**A**（给已上线的表加列 + 新读页 + 写订单的导入） · 起因：统筹转 PM 指派；PM 拍板「分开做」，随后 PM 本人对订单与付款窗口说「不要金额」
窗口：CRM 窗口（唯一写入者）；与「订单与付款」窗口（CTS 会议总结：房型/客人档案/代金券，建了 crm_bookings 家族）已直接对接，其答复见 §8。客户姓名等个人信息不进本文，一律用代号。

## 0. PM 版几句话

1. **不再新建订单表**：主干上已有另一个窗口做好并上线的「订单与付款进度」（`crm_bookings` 一家子），我们复用它，只补两样：①每张订单的**来源标签和发票号**（证明是「公司确认」还是「客人自述」）；②一个**独立的只读「销售进度」页**，按出发日一行一行看：**座位上限、已订人数、剩余**。
2. **金额不做（PM 本人 2026-10-13 原话：「其实我们不是特别在意总的金额，毕竟我们不是财务软件…不要金额」）**。此前统筹转述过「要金额」并据此出过 v1.1，**已全部撤掉**，不加任何金额列、不加改金额函数、不显示金额。v1.1 的金额设计与两审意见留在 git 历史里，需要时可恢复。
3. **分工（PM 要的三样东西）**：①CRM 里看每位客人的付款进度、②团目录里某个团的面板看这个团订了几单、定金/尾款各收几单——这两样**订单与付款窗口做**；③销售进度页的座位/上限——**本设计做**，并提供一个共享的「有效上限」读法，团目录面板也可调用（见 §3.3）。
4. **不做什么**：不改客人页、不改它的付款节点逻辑、不碰给 Meta 回传成交的线。

**最小第一步**：给订单加「来源 + 发票号」两列（改已上线的表，A 级，先出方案等批准）+ 销售进度页（只读）+ 一个「先预览、你说『导』才写入」的导入工具，把 3 月四团邮箱摸出来的 9 单走它自己的建单函数录进去。

**PM 只需要看这几行（下面第 3 节往后是给技术复审看的，可以跳过）**：
- 页面第一次上线时是**空的**（订单表现在 0 行），要等 3 月 9 单导入后才有数，这是正常的，不是坏了。
- 导入的 9 单会同时把「定金已收」标上，否则系统会当成欠款去催销售——这一步我们会在导入前列给你看。
- 录错了不能直接改发票号，只能「取消、重建」。
- 页面只有名单里的 2 个人能看（PM 已定「就这两个」）。

## 1. 为什么这样（简史）

2026-10-13 读主干代码时发现订单与付款窗口已经做好 `crm_bookings`（一客一团一出发日一条订单、人数 `party_size`、取消、定金/尾款两个付款节点、只增审计日志、名单制权限、付款总览页），迁移 `20261012200000_crm_booking_tracker.sql` 已在生产库建好（读到：`crm_bookings` 0 行、`crm_booking_members` 2 行）。我 v0.1–v0.8 自建 `crm_orders` 与它重复，违反复用优先，统筹同意撤掉自己的表、复用它（v0.9）。v1.0 并入第四轮两审；v1.1 曾按统筹转述加了金额并过第五轮两审；**PM 本人随后说「不要金额」，v1.2 撤掉金额**。完整历史见 git 里各版提交。

## 2. 现状盘点（读真实代码和生产库得出）

| 零件 | 现状 | 我们怎么用 |
|---|---|---|
| `crm_bookings` | 列：`contact_id`（必填）、`tour_id`、`departure_id`、`departure_depart_on`（建单时抄的出发日快照）、`booked_on`、`party_size`（smallint 1–60，**可空**）、`status`（active/cancelled，取消必带 `cancel_note`）、`note`、`created_by`；同一客人同一团同一出发日只许一张 active（唯一索引）；**不存金额（本设计也不加）** | 订单的唯一来源 |
| `crm_booking_milestones` | 每单两个节点 deposit/balance，`state` unpaid/paid，`paid_source` staff/email，`paid_evidence_ref` = 邮件引用（有 CHECK、client 内唯一） | 只读：判「定金是否已收」；**不往里放发票号**（会撞它的规则） |
| `crm_booking_events` | 只增审计日志 | 新列要进它的 changed 列表 |
| 数据库函数 `crm_booking_create / update / cancel / set_paid / unset_paid` | 带乐观并发与审计，只给 service_role | 导入走它（建单走新函数，见 §3.1），不直接写表 |
| 权限 `requireBookingAccess(clientId, 'view')` | ME 管理员或 `crm_booking_members` 名单内（现为 2 个邮箱，PM 定不扩） | 销售进度页用同一道闸，不用 `requirePaidClientAccess` |
| 付款总览页 + `booking-overview-*.ts` | 按出发日汇总订单张数、定金/尾款已收；**不含座位数/上限** | 读逻辑复用其分组；座位上限这块归本设计（对方已确认不做） |
| `me_sale_outcomes`（成交记录） | 一行=一次到账，一批准就计入目标并可能真发给 Meta | **不连、不读** |
| `tour_catalog_departures` / `tour_catalog_tours` | 出发日表；`internal.capacity`（内部座位，不对外）；团级 `max_group_size`（**会对外**） | 只读，见 §3.3 |

## 3. 设计

### 3.1 给 `crm_bookings` 增补两列（改已上线表；对方窗口已同意）

> 命名：来源列叫 **`origin_kind`**（不叫 `source`）——订单家族里 `crm_booking_events.source`（staff/email/system）、会话设置 `crm_booking.source`、`paid_source` 已占了这个词，且 HTTP 层 `FORBIDDEN_BODY_FIELDS` 会递归拒绝名为 `source` 的字段。

- `origin_kind` text **null 允许**，CHECK ∈ `company_confirmed` / `customer_stated` / `staff_entered`。旧行与以后手工录的单，来源为空 = 页面显示「来源未标」，按「待核实」算，**不回填猜值**。表上再加 CHECK：`origin_kind is distinct from 'company_confirmed' or evidence_ref is not null`。
- `evidence_ref` text null，存**发票号**（CTS 发票号 = 5 位纯数字，由函数校验，数据库只约束长度与不含空白；归一化 = 大写 + 去掉空白和连字符，与付款邮件识别的发票号提取同一规则）。**部分唯一索引 `(client_id, evidence_ref) where evidence_ref is not null and status = 'active'`**——取消的单保留发票号做审计但不占号，撤回后同一张发票可重导，「挂错客人 → 取消 → 在正确客人名下重建」走得通。
- **建单后 `origin_kind`、`evidence_ref` 都不可改**（BEFORE UPDATE 触发器；不拦合法的 `updated_at` 触碰；`crm_booking_update` 是显式列更新，新列不会被它覆盖）。录错 = **取消、重建**。
- **不改现有 `crm_booking_create`**（改签名会让 Postgres 同时存在 9 参与 11 参两个同名函数，PostgREST 对「界面加订单」的具名调用会选不出来直接 500，且原有 revoke/grant 按 9 参数写）。**另建只给导入工具用的新函数** `crm_booking_create_with_origin`（内部复用 `crm_booking_check_refs`，同样的审计与乐观并发风格；`revoke … from public, anon, authenticated; grant … to service_role`）。界面「加订单」不暴露这两列。**测试**：旧 9 参调用仍成功；`company_confirmed` 不带发票号被拒。
- **唯一冲突按约束名拆开**：发票号冲突抛 `duplicate_evidence_ref`，同客人同团同出发日冲突仍抛 `duplicate_booking`；`mapRpcError` 认识新码。导入重跑时先**按发票号读回已有订单，核对联系人与出发日一致才算「已导」**，不一致进「待人判断」。
- **审计**：`create or replace crm_booking_audit_booking`：`created` 事件 detail 加 `origin_kind`、`has_evidence_ref`（**只存「有没有发票号」的布尔，不存发票号原文**，与现有迁移对邮件证据只存布尔一致）；UPDATE 分支加这两列的 changed 判断（`evidence_ref` 不可改，只是兜底）。注意函数内 `set_config('crm_booking.source','staff')` 是审计来源标记，与新列无关。**不需要放宽 `crm_booking_events.action` 的 CHECK**（没有新动作名）。
- **写迁移时的两条硬要求（订单与付款作者提醒）**：①`create or replace crm_booking_audit_booking` 时保持原有 `crm_booking_clear_settings()` 调用和 return 路径不变（生产库不允许函数级 SET），并在沙盘库重跑 `supabase/tests/crm_booking_tracker.test.sql`，必须仍是 **278 PASS**，再加新用例；②新函数同样 `revoke … from public, anon, authenticated`、只 grant 给 service_role。
- 迁移只含 `alter table … add column`（可空，不重写表）+ CHECK + 部分唯一索引 + 触发器 + 新函数 + 审计函数替换；先在本机 Postgres 沙盘重放，**生产 apply 要 PM 回「同意」**。

### 3.2 金额：不做（PM 2026-10-13 原话「不要金额」）

订单与付款设计的取向「只记进度、不记钱」保持不变。本设计不加 `total_minor` / `currency` / `amount_minor`，不加改金额函数，审计里不记金额，销售进度页不显示金额；3 月草稿里邮箱读到的定金金额**不导入**（只导人数、发票号、来源、定金已收状态）。若将来 PM 要金额，v1.1 的设计与两审意见在 git 历史里，可作起点，但属另一轮 A 级改动。

### 3.3 销售进度页（独立只读页：座位上限、已订人数、剩余）

- **位置**：`/dashboard/clients/[id]/sales-progress`（服务端页；客户首页入口卡片、Tour 目录页页头链接留后续步骤）。不放进客人页，不放进 Tour 目录页（目录页页头写明不记订单、权限是另一份名单、81 号窗口正在改它）。
- **权限**：`requireBookingAccess(clientId, 'view')`（名单制；底下依次过「付费客户」「名单」「该客户启用订单与付款配置」，没启用返回 404）。它返回 `NextResponse`，服务端页面要自己转成 `notFound()` 或「无权限」提示。页面、每个取数接口各自带同一道闸；**测试照现有 `access-gate.test.ts` / `route-capabilities.test.ts` 范式，断言每个新路由都调用同一道闸**；无权限账号/别的客户 id 取不到。能看的人 = 名单现有 2 个邮箱（PM 已定不扩名单）。
- **读哪一层**：页面自己查一次 `crm_bookings`（只取需要的列，含新列）+ 出发日表；**不改**共享的 `BOOKING_COLUMNS` 清单和 `BookingRow` 类型。总览页的分页上限（50 条/`OVERVIEW_HARD_CAP`）要核对，超过上限时不能悄悄少算，必须显示「只读了前 N 条」。
- **共享代码里只认「销售单元」**：适配器接口 `listSalesUnits(clientId) → [{unitId, label, date?, capacity?, capacityNote?, unitStatus}]`；CTS 适配器读 `tour_catalog_departures`（只读，不写，不读 `internal` 其他键）；旅游词只在适配器与文案配置里。换成地产（楼盘/户型）或物流（发运批次）时外壳不改。**「有效上限」读法单独做成一个共享纯函数**（输入：出发日内部座位、团级对外上限；输出：上限数字 + 来源说明），**团目录里某个团的销售情况面板（订单与付款窗口做）也调用它**，保证全站「这个团几个座位」只有一个口径（PM 要「团目录字段能被别的功能统一调用」）。
- **一行（一个出发日）显示**：
  1. **座位上限**：主来源 = 该出发日的 `internal.capacity`（内部座位，**不对外**；3 月四团均为 20）；若该团另有对外的团级 `max_group_size`（公开口径，上海周边团官方 18，PM 定「按 18 算」），**取两者较小者**并标注「内部 20 / 官方 18，按 18 算」。**不往 `max_group_size` 写 20，也不改任何对外字段**（CTS 红线：对外不出现人数上限；`max_group_size` 在发给官网的数据里，而 `internal` 不进任何输出）。都没有 =「上限未设置」，剩余显示「上限未设置」，不默认 20。适配器只取 `internal.capacity` 这一个键，读后丢弃整个 `internal`。
  2. **已订人数**（只统计 `status=active`，人数 = 各单 `party_size` 相加）：**公司确认**（`origin_kind=company_confirmed`）｜**客人自述**（`customer_stated`）｜**待核实**（`staff_entered` 与来源未标）。**对外只说「公司确认」一栏。**
  3. **人数未填 N 单**：`party_size` 为空的订单单列，**不按 1 计**。
  4. **剩余**（保守算法，避免第一批全是待核实时高估空位而超卖）：上限 − （三栏之和）；旁小字「仅算公司确认：N」；若还有人数未填的单，加提示「另有 N 单人数未填，剩余可能更少」。**未归属的人数**（订单没挂出发日 `departure_id` 为空，或出发日行已被团目录硬删而 `departure_id` 悬空，靠订单上的出发日快照 `departure_depart_on` 认出）按团单列，并在该团每一行的剩余旁提示「另有 N 人未归属出发日，剩余可能更少」。已订 > 上限显示红字「超订 N 人」，不显示负数；只提示不拦截，文案写明「系统不会拦截，请销售自行把关」。
  5. 每个数字可点开看是哪几张订单（只显示发票号、日期，不显示姓名电话）。
  6. 页头「数据截至 xx 时刻」；订单与出发日同一次查询读取。已取消的订单不计入任何栏；`cancelled/closed` 的出发日不进主列表，上面挂着的有效订单单列一行；`sold_out/limited` 要显示，不能当关闭。订单联系人被删会连带删订单（外键级联），座位数会无声减少——「数据截至」旁在订单数比上次少时提示。
- 另放两行小字：「订单未挂出发日」条数、「CRM 里阶段为已付但没有订单」的人数（只读差额，不联动）。
- **不显示**：付款进度（已收定金/尾款几单）、证据强度、金额——付款进度由订单与付款窗口在「团目录面板」和付款总览里做，本页不重复，避免两处口径打架。
- 「公司确认」口径、剩余算法写在页面的服务端常量 + 测试里，第一步不做配置界面。
- **测试**：无权限账号/别的客户 id 取不到；每个新路由都调同一道闸；适配器无 `insert/update/delete/rpc` 且返回值里无 `internal` 其他键（含航司航线的夹具断言）；内部 20 + 官方 18 → 按 18 并带差异说明；上限都缺 → 上限未设置；`party_size` 空的单不进人数、进「未填」；取消的单不计；未挂出发日/悬空订单单列并提示；剩余保守算法与超订显示；「有效上限」共享纯函数单测（含团目录面板将来调用的边界）。

### 3.4 3 月四团的数据怎么进来（导入工具）

- 来源：邮箱只读摸出的草稿（本地 Dropbox，含客人信息，**不进仓库**）；3/11 共 8 单 15 人、3/18 共 1 单 2 人、3/25 与 3/26 暂 0 单；全部是定金；CTS 销售对 8 条问题的核对回复后再定稿。**金额不导入**（§3.2）。
- 工具：本地脚本（不进生产服务）。**预览**：按电话/邮箱只读查 `contacts`（`select id` + `client_id` 过滤，电话用同一套归一化比较、邮箱小写比较；**不调 `resolveContact`**——它会在没命中时建人、命中时改最近接触时间）；命中 0 或 ≥2 的进「待人判断」，不自动建、不自动合并；输出打码清单 + 汇总，并**列出「导入后付款催办名单上会多出几条」**。→ **PM 在对话里说「导」**才执行。
- **应用，每单两步**：①调 `crm_booking_create_with_origin`（带 `origin_kind`、`evidence_ref`；`departure_id` **必须**用团目录里真实的出发日 id；`booked_on` **显式传发票日期**）；②对**已确认收到定金**的单，再调现有 `crm_booking_set_paid`（deposit 节点，`paid_source='staff'`，**不带** `evidence_ref`；`paid_on` 取发票或到账日）。不做第②步，这 9 单会被当成「欠定金」进催款名单，还会烧掉 CTS「每人每周最多 2 封」的额度。这 9 单的「已收」是员工代标的，审计里来源是 `staff`，页面文案不要写成「邮件核实」。
- 每单一个事务、带审计；任一单失败立即停止并报告已成功几单；脚本在本地写一份**只含订单 id 和发票号**的进度文件，重跑以它对账（并按发票号读回核对）。
- **撤回**：对已导入的单调现有的 **`crm_booking_cancel`**（不是 `crm_booking_update`——它不允许改状态），需先逐单读出 `expected_updated_at`，`cancel_note` 写「导入批次 <日期> 撤回」（≤200 字）；已取消的单（报 `booking_not_active`）算「已撤回」，不算失败；不删行。取消后发票号释放，可重导。
- 同一客人同一团两张发票（定金一张、尾款一张）：**不自动判断**，进待人判断由人选（尾款 → 在原单上用现有「已收款」操作；另一批人 → 同一单把 `party_size` 加大并在备注里写明，不改唯一索引）。**第一步每单只存一个发票号**（第一张）；尾款发票号第一步不进系统，只在备注里写。
- 个人信息：原件不复制进仓库；脚本输出一律打码；PR/文档只出现代号。

### 3.5 「报价」

订单从**发票**起算（`evidence_ref` 是发票号）。报价单号是另一种编号，`evidence_ref` 建单后不可改，报价→发票是两个编号，硬放同一行会冲突；报价阶段仍由 CRM 现有阶段承载。

## 4. 分步

| 步 | 内容 | 风险 |
|---|---|---|
| **1a** | 迁移（给 `crm_bookings` 加 `origin_kind`、`evidence_ref`、CHECK、部分唯一索引、不可改触发器、新函数 `crm_booking_create_with_origin`、审计触发器替换），本机沙盘重放（含「旧 9 参调用仍成功」「278 项仍全过」）；订单与付款作者复核；**PM 批准后**才在生产 apply | A |
| **1b** | 销售进度页（只读）+ 适配器 + 「有效上限」共享函数 + 测试 | A（读客户订单数据、新页面） |
| **1c** | 导入工具 + 3 月 9 单（等 CTS 销售核对回复、PM 说「导」） | A（写订单） |
| 2 | 每周自动对账邮箱收款邮件（订单与付款窗口已有 P3/P4 自动勾选设计，本设计不另造） | A |
| 3 | Tour 目录页页头加「查看销售进度」链接（先与改该页的窗口协调） | B |

## 5. 资源优先级（ENGINEERING_QUALITY_GATES §11）

频率高（3 月四团在售，每天问「这团几个人、还剩几个座位」）/ IMPACT 高（Measure 事实源，决定各团跟进力度；第一步本身不连广告）/ 收入高（直接关系销售跟进与超订风险）→ **零低三高 → P0**（以 PM 最新指示为准）。

## 6. 风险与防线

1. **错数**：对外只说「公司确认」；每单可点开看发票号；来源缺失一律按待核实；`party_size` 空不当 1；剩余用保守算法；未归属人数单列并提示；同一发票号在有效订单里只能出现一次。
2. **钱与外发**：本设计没有任何到 `me_sale_outcomes`/Meta 的路径；**不存金额**；不进邮件自动勾选、不进任何回传。
3. **不往对外字段写座位**：上限只读内部座位；`max_group_size` 只读不写；适配器测试断言。
4. **个人信息与权限**：页面名单制闸 + 取数接口各自同闸；号码/姓名不出现在进度页；导入原件不进仓库；审计里发票号只存布尔。
5. **改已上线表**：只加可空列 + CHECK + 部分唯一索引 + 触发器 + **新函数（不改现有函数签名）**；迁移先在沙盘重放；生产 apply 要 PM 同意；回滚 = 去掉新触发器/索引/新函数、还原审计函数、列留着或确认无数据后删。数据库触发器挡得住应用层和 service-role，挡不住数据库 owner（迁移/SQL 通道），那一层靠「生产写入必须 PM 同意/说导」。
6. **与订单与付款窗口的边界**：本设计不改它的付款节点、提醒、自动勾选逻辑；只加两列和一个读页；加列的迁移 SQL 写完由它的作者复核。

## 7. Reuse Statement

- 复用：`crm_bookings` 家族（订单、节点、审计、数据库函数）、`requireBookingAccess`、`booking-overview-*.ts` 分组逻辑、团目录出发日只读数据、`internal.capacity`。
- 新增：给订单加来源与发票号两列（platform-shared，列名中性）；销售进度页外壳（通用，只认「销售单元」适配器）；「有效上限」共享纯函数；CTS 适配器与「公司确认」口径（L4，旅游词只在这里）。
- 行业专属：无。客户专属：发票号格式（5 位数字）、团号、座位数字。
- shared runtime 里有无客户名/ID/行业判断：无。
- 决策时分类与落点一致性：决策为「复用既有订单家族 + 通用只读外壳 + CTS 适配器」，实现落点按此，交付时对账。
- 层级判定：L1（既有 CRM/订单能力的扩展，证据只有 CTS 一家，按默认降级登记为候选，待 PM 一句「记」）。

## 8. 与订单与付款窗口的约定，以及需要 PM 回答的问题

**已由对方窗口答复并确认（2026-10-13）**：①同意把来源 + `evidence_ref` 加在 `crm_bookings` 上（不放节点表；列名已按建议改为 `origin_kind`，对方知悉并无异议）；旧行允许 null，不回填；新列进审计；②9 单走它的数据库函数（先对到 `contact_id`，不直接写表、不绕审计），导入属 A 级先出方案；③`party_size` = 「这单占几个座位」，可空，空的单列「人数未填」不按 1 计；取消 = `status='cancelled'`；尾款是同一订单的 balance 节点；「另一批人」现在建不了第二张，不要私自放宽索引；④销售进度页同走 `requireBookingAccess`；它没有计划做座位/上限页。⑤它已落笔：审计与抹除一节、不含金额列的源码守卫测试（PR 2528）；因 PM 改为不要金额，它会把自己设计稿 §7.3 改回「不含金额」，守卫测试保留。

**我的技术取舍（不抛 PM）**：「另一批人」第一步用同一单把 `party_size` 加大 + 备注写明，不改唯一索引。

**PM 的答复**：
- Q2/Q2b（座位上限）：3/11、3/18、3/26 上限 20；上海周边团官方 18，按 18 算并标注，内部座位保持 20、不写生产库。
- Q3（金额）：**PM 本人 2026-10-13 对订单与付款窗口说「不要金额」**，取代此前统筹转述的「要金额」。
- Q5（谁看进度页）：「就这两个」（统筹转述，2026-10-13）：名单里现有 2 个邮箱 + ME 管理员，不扩名单。

**后续（不一次抛）**：Q4 对外只显示「公司确认」栏、「客人自述/待核实」只内部看，是否同意；Q6 外部下单系统上线后谁是准的；Q7 订单要不要也存「报价」。

## 9. 已知缺口（诚实声明）

- `crm_bookings` 现在 0 行：进度页第一版上线时全部是「还没人录」，要等 1c 导入（需 CTS 销售核对 + PM 说「导」）才有数。
- 生产库数字（出发日 34 行、`internal.capacity` 23 个为 20、3 月四团均 20、`crm_bookings` 0 行、`crm_booking_members` 2 行）是我读到的，未经第二人核对。
- 迁移 SQL 还没写：方向性设计；v0.9 复用方案已过第四轮两审；v1.1 的金额部分已撤，**撤掉金额后的 v1.2 没有新增风险面，未再做复审**（只是删除了已审过的金额内容）。迁移 SQL 写完要订单与付款窗口作者复核，PM 批准后才能 apply。
- 「公司确认」口径：由导入时声明 + PM 说「导」决定，不是逐单销售确认。
- 联系人合并后订单分叉、客人要求删除个人信息时订单怎么处理：沿用订单与付款窗口的既有处理，本设计不另造。
- 3 月草稿里 9 单的核对（8 条问题）还在等 CTS 销售回复，最终数以回复为准。
- 「团目录面板里看订了几单、定金/尾款各收几单」与「CRM 里看每位客人付款进度」由订单与付款窗口做，本设计只提供共享的「有效上限」读法；两边的座位口径是否一致，靠这个共享函数保证。

## 10. 复审记录（简）

v0.2–v0.8（自建表）经子牙 + 魏征三轮；v0.9–v1.0 经第四轮（复用方案、加列、导入）：带条件通过，条件已并入；v1.1 经第五轮（金额）：带条件通过——**金额随 PM「不要金额」整块撤掉**，第五轮意见中与金额无关的结论（审计里发票号只存布尔、取消释放发票号、不许改旧函数签名等）已保留在本稿。完整的逐条处理对照在 git 历史各版里。**批准前不写代码、不改生产库。**

## 11. 实现计划（草案；设计稿批准前不写进 `supabase/migrations`、不动库）

### 11.1 分三个 PR（各自过风险闸，按顺序）

| PR | 内容 | 风险 | 谁写 | 前置 |
|---|---|---|---|---|
| **A 迁移** | 给 `crm_bookings` 加 `origin_kind`/`evidence_ref`、约束、索引、不可改触发器；新函数 `crm_booking_create_with_origin`；替换 `crm_booking_audit_booking` | **A**（改已上线表，apply 不可逆） | Claude Code 自写（例外②：A 级数据库函数，PR 里写原因） | 设计稿 PM 批准；订单与付款作者复核 SQL |
| **B 销售进度页** | 适配器、「有效上限」共享函数、纯函数（剩余/三栏/未归属）、服务端页、取数函数、测试、入口卡片 | **A**（读客户订单、新页面、名单制鉴权） | DeepSeek 写（Claude 出指令 + 审 diff），鉴权由 Claude 复核 | PR A 的列在库里（列不存在时页面降级为「来源未标」，不报错） |
| **C 导入工具** | 本地脚本：预览（只读联系人查找）→ PM 说「导」→ 应用（逐单 `create_with_origin` + `set_paid`）→ 撤回（`crm_booking_cancel`） | **A**（写订单） | DeepSeek 写，Claude 审 | PR A 已 apply；CTS 销售 8 条核对回复；PM 说「导」 |

### 11.2 文件清单（预计）

- **PR A**：`supabase/migrations/<时间戳>_crm_booking_origin_evidence.sql`（新）；`supabase/tests/crm_booking_origin_evidence.test.sql`（新，沙盘用）；`src/lib/crm/booking-http.ts`（`mapRpcError` 认识 `duplicate_evidence_ref`）+ 单测；台账卡。
- **PR B**：`src/lib/crm/sales-progress/`（`units.ts`、`units-cts.ts`、`capacity.ts` 有效上限、`calc.ts`、`load.ts`、`types.ts`）；`src/app/dashboard/clients/[id]/sales-progress/page.tsx` + `_components/`；若有点开明细的取数接口：`src/app/api/clients/[id]/sales-progress/...`（每个自带 `requireBookingAccess`）；`__tests__`；客户首页入口卡片（`dashboard/clients/[id]/page.tsx` 一处）；台账卡。
- **PR C**：`scripts/import-march-bookings.ts`（新，本地运行）+ 单测（打码、只读查找、失败停止、撤回幂等）；台账卡。
- **不碰**：`booking-store-reads.ts` / `booking-overview-reads.ts` 的列清单；`tour-catalog/*`；`contacts` 写入路径；`me_sale_outcomes`。

### 11.3 迁移（PR A）SQL 骨架（**草案，未写入仓库迁移目录、未执行**）

```sql
-- 1) 新列（全部可空，不重写表；旧行不回填）
alter table public.crm_bookings
  add column origin_kind text check (origin_kind in ('company_confirmed','customer_stated','staff_entered')),
  add column evidence_ref text check (evidence_ref is null or (length(evidence_ref) between 3 and 40 and evidence_ref !~ '\s')),
  add constraint crm_bookings_company_confirmed_needs_evidence
    check (origin_kind is distinct from 'company_confirmed' or evidence_ref is not null);
-- 2) 发票号唯一（取消不占号）
create unique index crm_bookings_evidence_ref_active_uidx
  on public.crm_bookings (client_id, evidence_ref) where evidence_ref is not null and status = 'active';
-- 3) origin_kind / evidence_ref 建单后不可改的 BEFORE UPDATE 触发器（不拦 updated_at 触碰）
-- 4) create or replace crm_booking_audit_booking（保持 crm_booking_clear_settings() 调用与 return 路径不变；
--    created 事件加 origin_kind、has_evidence_ref；UPDATE 分支加两列 changed 判断）
-- 5) 新函数 crm_booking_create_with_origin(...)；不动旧 crm_booking_create 的签名
--    revoke all on function … from public, anon, authenticated; grant execute … to service_role;
```
发票号 5 位数字格式在**函数里**校验（CHECK 读不了客户配置）。

### 11.4 沙盘重放方案（本机 Postgres，不碰生产）

1. 按 `reference-local-postgres-replay-sandbox` 起本机 Postgres（手写 Supabase 桩）。
2. 依次重放：团目录迁移 → `20261012200000_crm_booking_tracker.sql`（原样）→ 订单与付款作者的 `supabase/tests/crm_booking_tracker.test.sql`，**必须仍是 278 PASS**（基线）。
3. 重放本迁移，再跑一遍 278 项（**必须全过**），再跑新增用例：旧 9 参 `crm_booking_create` 仍成功；`company_confirmed` 无发票号被拒；同一发票号取消后可重建、`active` 内不可重复；`origin_kind`/`evidence_ref` 建单后改写被拒；新函数 anon/authenticated 无执行权；`created` 审计事件含 `origin_kind` 与 `has_evidence_ref`，不含发票号原文；`duplicate_evidence_ref` 与 `duplicate_booking` 区分。
4. 沙盘输出（PASS 数、失败为 0）原样贴进 PR「当场试跑」。生产 apply 由 PM 回「同意」后才执行，**回读核对**列、约束、索引、触发器、函数权限。
5. **回滚**（迁移文件里同时带反向脚本，PM 批准 apply 时一并给）：去掉新触发器、新函数；还原审计函数为原版本（原文在原迁移里，保留逐字副本）；删新索引与新约束；列留着（可空，不影响旧行为）或确认无数据后删。

### 11.5 PR B / PR C 的当场试跑方案

- **PR B**：本机用合成的订单/出发日夹具起页面，截图贴 PR；生产上线后用只读核对「页面数字 = 数据库直接汇总」；因生产订单现为 0 行，首次上线页面是空的是预期，不算失败。
- **PR C**：先对一个测试客户跑完整「预览→导→撤回→重导」；对 CTS 真数据只跑**预览**（打码输出），**写入必须 PM 在对话里说「导」**；导入后回读：9 单、人数合计、定金已收、催款名单未多出这 9 单、`me_sale_outcomes` 行数不变。

### 11.6 费用与外发

迁移、页面、导入都不花钱、不外发、不触达任何客人；没有新的定时任务（每周对账是第 2 步，另案）。
