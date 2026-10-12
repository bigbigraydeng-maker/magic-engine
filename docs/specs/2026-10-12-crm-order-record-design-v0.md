# CRM「订单记录」与「销售进度」设计稿 v1.1（改为复用已上线的订单与付款进度，已并入第四轮、第五轮两审；v1.1 增加金额；PM 批准前不写代码、不改生产库）

日期：2026-10-13 · 风险级：**A**（给已上线的表加列 + 新读页 + 记钱相关的导入） · 起因：统筹转 PM 指派；PM 拍板「分开做」
窗口：CRM 窗口（唯一写入者）；与「订单与付款」窗口（CTS 会议总结：房型/客人档案/代金券，建了 crm_bookings 家族）已直接对接，三个口径问题它已答复（见 §8）。客户姓名等个人信息不进本文，一律用代号。

## 0. PM 版两句话

1. **不再新建一张订单表**：主干上已经有另一个窗口做好并上线的「订单与付款进度」（`crm_bookings` 一家子），我们复用它，只补两件它没有的东西：①每张订单的**来源标签和发票号**（证明是「公司确认」还是「客人自述」）；②一个**独立的只读「销售进度」页**，按出发日一行一行看：座位上限、已订多少、剩余多少。
2. **不做什么**：不改客人页、不改它的付款节点逻辑、不碰给 Meta 回传成交的线；金额**只出现在销售进度页**，它自己的付款总览、催款名单、客人抽屉一律不显示、不读金额。
3. **金额（v1.1 新增）**：PM 选了「要金额」（**依据：统筹转述 PM，2026-10-13**；订单与付款作者对此表示接受，但它没亲耳听到 PM）。所以订单上加「应收总价 + 币种」，付款节点上加「这一笔金额」，进度页按出发日、按定金/尾款分组显示已收/应收，**币种分开不相加**。这与订单与付款原来「只记进度、不记钱」的取向相反，已征得它同意（§3.2）。

**最小第一步**：给订单加「来源 + 发票号」两列（改已上线的表，A 级，先出方案等批准）+ 销售进度页（只读）+ 一个「先预览、你说『导』才写入」的导入工具，把 3 月四团邮箱摸出来的 9 单走它自己的建单函数录进去。

**PM 只需要看这几行（下面第 3 节往后是给技术复审看的，可以跳过）**：
- 页面第一次上线时是**空的**（订单表现在 0 行），要等 3 月 9 单导入后才有数，这是正常的，不是坏了。
- **金额**：依据是统筹转述 PM（2026-10-13），**批准前请 PM 亲口确认一句「要金额」**。3 月 9 单只有定金金额、没有总价，页面会显示「总价未填」；金额录错可以改，每次改动都留记录。
- 导入的 9 单会同时把「定金已收」标上，否则系统会当成欠款去催销售——这一步我们会在导入前列给你看。
- 录错了不能直接改发票号，只能「取消、重建」。
- 页面只有名单里的人能看，现在名单只有 2 个邮箱，要加销售得请订单与付款那位同事加。

## 1. 为什么改（v0.8 → v0.9）

2026-10-13 读主干代码时发现：订单与付款窗口已经做好 `crm_bookings`（一客一团一出发日一条订单、人数 `party_size`、取消、定金/尾款两个付款节点、只增审计日志、名单制权限、付款总览页），迁移 `20261012200000_crm_booking_tracker.sql` 已在生产库建好（读到：`crm_bookings` 0 行、`crm_booking_members` 2 行）。我 v0.1–v0.8 设计的 `crm_orders` 在「客人维度订单」上与它重复，违反复用优先（CLAUDE.md §0）。统筹同意：**撤掉自己的订单表，复用它**。

v0.8 之前两审（子牙+魏征，共三轮）里**仍然适用**的结论保留在本稿：座位上限读内部座位、保守的剩余口径、不进客人页、不写团目录、客人信息不进文档；**已作废**的是关于 `crm_orders / crm_order_departures / 批次表 / 事件表` 的全部设计（它们的需求被 `crm_bookings` + `crm_booking_events` 覆盖）。完整历史见 git 里 v0.2–v0.8 的各次提交。

## 2. 现状盘点（读真实代码和生产库得出）

| 零件 | 现状 | 我们怎么用 |
|---|---|---|
| `crm_bookings` | 列：`contact_id`（必填）、`tour_id`、`departure_id`、`departure_depart_on`（建单时抄的出发日快照）、`booked_on`、`party_size`（smallint 1–60，**可空**）、`status`（active/cancelled，取消必带 `cancel_note`）、`note`、`created_by`；同一客人同一团同一出发日只许一张 active（唯一索引）；**不存金额** | 订单的唯一来源 |
| `crm_booking_milestones` | 每单两个节点 deposit/balance，`state` unpaid/paid，`paid_source` staff/email，`paid_evidence_ref` = 邮件引用（有 CHECK、client 内唯一） | 只读：判「定金是否已收」；**不往里放发票号**（会撞它的规则） |
| `crm_booking_events` | 只增审计日志 | 新列要进它的 changed 列表 |
| 数据库函数 `crm_booking_create / update / set_paid / unset_paid` | 带乐观并发与审计，只给 service_role | 导入走它，不直接写表 |
| 权限 `requireBookingAccess(clientId, 'view')` | ME 管理员或 `crm_booking_members` 名单内（现为 2 个邮箱） | **销售进度页用同一道闸**，不用 `requirePaidClientAccess` |
| 付款总览页 + `booking-overview-*.ts` | 按出发日汇总订单张数、定金/尾款已收、全部订单；**不含座位数/上限** | 读逻辑复用其分组，不重写；座位上限这块归本设计（对方已确认不做） |
| `me_sale_outcomes`（成交记录） | 一行=一次到账，一批准就计入目标并可能真发给 Meta | **不连、不读** |
| `tour_catalog_departures` / `tour_catalog_tours` | 出发日表；`internal.capacity`（内部座位，不对外）；团级 `max_group_size`（**会对外**） | 只读，见 §3.3 |

## 3. 设计

### 3.1 给 `crm_bookings` 增补两列（改已上线表；对方窗口已同意加在 bookings 上）

> 命名：来源列叫 **`origin_kind`**（不叫 `source`）——订单家族里 `crm_booking_events.source`（staff/email/system）、会话设置 `crm_booking.source`、`paid_source` 已占了这个词，且 HTTP 层 `FORBIDDEN_BODY_FIELDS` 会递归拒绝名为 `source` 的字段（第四轮子牙建议）。

- `origin_kind` text **null 允许**，CHECK ∈ `company_confirmed` / `customer_stated` / `staff_entered`。旧行与以后手工录的单，来源为空 = 页面显示「来源未标」，按「待核实」算，**不回填猜值**。表上再加 CHECK：`origin_kind is distinct from 'company_confirmed' or evidence_ref is not null`（不只靠函数）。
- `evidence_ref` text null，存**发票号**（CTS 发票号 = 5 位纯数字，由导入工具校验，数据库只约束长度与不含空白；归一化 = 大写 + 去掉空白和连字符，与付款邮件识别的发票号提取同一规则）。**部分唯一索引 `(client_id, evidence_ref) where evidence_ref is not null and status = 'active'`**——**取消的单保留发票号做审计，但不占号**，所以撤回后同一张发票可以重导、「挂错客人 → 取消 → 在正确客人名下重建」这条纠错路径走得通（魏征、子牙第四轮）。
- **建单后 `origin_kind`、`evidence_ref` 都不可改**（BEFORE UPDATE 触发器；不能拦住合法的 `updated_at` 触碰；`crm_booking_update` 是显式列更新，新列不会被它覆盖，已核对）。录错来源或发票号 = **取消、重建**。
- **不改现有 `crm_booking_create`**（第四轮两审一致：改签名会让 Postgres 同时存在 9 参与 11 参两个同名函数，PostgREST 对「界面加订单」的具名调用会报「选不出来」直接 500，且原有 revoke/grant 是按 9 参数写的）。改为**另建一个只给导入工具用的新函数** `crm_booking_create_with_origin`（内部复用 `crm_booking_check_refs`、同样的审计与乐观并发风格；`revoke … from public, anon, authenticated; grant … to service_role`，按新签名写全）。界面「加订单」第一步不暴露这两列。**测试**：旧的 9 参数调用依然成功；新函数 `company_confirmed` 不带发票号被拒。
- **唯一冲突按约束名拆开**：发票号冲突抛 `duplicate_evidence_ref`，同客人同团同出发日冲突仍抛 `duplicate_booking`；`mapRpcError` 认识新码。导入重跑时先**按发票号读回已有订单，核对联系人与出发日一致才算「已导」**，不一致进「待人判断」。
- **审计**：用 `create or replace` 替换 `crm_booking_audit_booking`：INSERT 的 `created` 事件 detail 加进 `origin_kind`、`has_evidence_ref`（**只存「有没有发票号」的布尔，不存发票号原文**——与现有迁移对邮件证据只存布尔的做法一致；发票号不可改地存在订单行上，要查直接查订单）；UPDATE 分支加这两列的 changed 判断（`evidence_ref` 不可改，只是兜底）。注意函数内 `set_config('crm_booking.source','staff')` 是审计来源标记，与新列无关，代码注释写清。
- **金额列（v1.1，见 §3.2）**：`crm_bookings.total_minor` + `currency`、`crm_booking_milestones.amount_minor`；新函数 `crm_booking_create_with_origin` 可带金额，另有受控改金额函数 `crm_booking_set_amounts`（必填原因、带 `expected_updated_at`、走现有 `conflict:stale` 机制、审计写 before/after、`revoke … from public, anon, authenticated`、只 grant service_role）。
- **写迁移时的两条硬要求（订单与付款作者 2026-10-13 提醒）**：①`create or replace crm_booking_audit_booking` 时**保持原有 `crm_booking_clear_settings()` 调用和 return 路径不变**（生产库不允许函数级 SET，它首次上线栽过），并在沙盘库重跑 `supabase/tests/crm_booking_tracker.test.sql`，必须仍是 **278 PASS**，再加新用例；②新函数 `crm_booking_create_with_origin` 同样 `revoke … from public, anon, authenticated`、只 grant 给 service_role，别漏。
- 迁移只含 `alter table … add column`（可空，不重写表）+ CHECK + 部分唯一索引 + 触发器 + 新函数 + 审计触发器替换；先在本机 Postgres 沙盘重放，**生产 apply 要 PM 回「同意」**；迁移 SQL 写完还要请订单与付款窗口的作者复核。

### 3.2 金额（v1.1：PM 选「要金额」；订单与付款作者已同意方案）

**依据**：PM 经统筹转述选「要金额」（2026-10-13）。订单与付款作者说明它之前对 PM 说过「不记金额」，现在取向变了，**接受**（只出设计、可逆），但**没有亲耳听到 PM**——所以这里写明依据来自统筹转述。

- **列**（两处都放，作者同意）：①`crm_bookings.total_minor` bigint 可空（整单应收总价，最小货币单位）+ `currency` text 可空；**约束（第五轮更正）**：`total_minor` 有值则必须大于 0 且不超过上限（防荒谬值），币种大写三字母（口径照 `me_sale_outcomes`），**`total_minor` 有值则 `currency` 必须有值，但 `currency` 可以单独有值（总价可空）**——否则 3 月 9 单「只有定金金额、总价未知」无处存币种；币种白名单（NZD/AUD/CNY/USD）在函数里校验，防录成 `NZS` 这种合法格式的错币种。②`crm_booking_milestones.amount_minor` bigint 可空、> 0（这个节点——定金或尾款——的金额）；**节点没有自己的币种，沿用订单币种，同一订单两个节点必然同币种**（写明）。订单币种只在该订单没有任何已填金额的已收节点时才允许改。
- **「金额不一致」的判据（第五轮更正）**：只在「节点金额之和 **>** 总价」，或「两个节点都有金额且之和 ≠ 总价」时标；**只填了一个节点（典型：只有定金）不标**，否则每张订单天天误报。不强制节点金额之和等于总价（分批、折扣常见）。
- **谁能写、怎么写**：只经新函数；界面「加订单」和现有 `crm_booking_update` 第一步不动、不暴露金额字段。建单带金额走 `crm_booking_create_with_origin`；更正走 `crm_booking_set_amounts`。
- **`crm_booking_set_amounts` 的并发与返回（第五轮更正，子牙、魏征的两种意见取其合：令牌各管各的）**：订单和节点各有自己的 `updated_at` 令牌（现有函数就是这么用的）。改总价/币种必须带**订单令牌**；改某个节点的金额必须带**该节点令牌**；一次两样都改就两个令牌都验；加锁顺序与现有函数一致：先锁订单行（`for update`，要求订单仍是 active），再锁节点；任一令牌不符抛 `conflict:stale:<id>`（与现有 `mapRpcError` 的前缀兼容）。两个人改**不同**节点互不覆盖（各改各的行），改**同一**节点会冲突；改订单总价会刷新订单令牌，界面该刷新就刷新，属预期。新旧值全相同则不写、不刷令牌、不写审计。**返回值只给 `{changed, id}`，不返回整行**（现有函数返回 `to_jsonb(v_row)`，加列后会带出金额）。必填原因。
- **审计怎么落地（第五轮必改）**：现有两个审计触发器都是按列白名单写 detail，金额变了**一条审计都不会留**。所以同一份迁移里：①`create or replace crm_booking_audit_booking`：`total_minor`、`currency` 变化进 `changed_fields`，detail 写 old/new；②`create or replace crm_booking_audit_milestone`：`amount_minor` 变化写 old/new；③`crm_booking_events.action` 的 CHECK 白名单放宽（先 drop 再重加，**重加时必须包含现有全部取值**（`created/edited/cancelled/milestone_paid/milestone_unpaid/due_overridden/departure_confirmed/auto_tick_proposed/auto_tick_rejected/milestone_created/milestone_deleted/booking_deleted/actor_erased`），`create or replace` 改不了约束）加 `milestone_amount_set`；④两个函数都保持原有 `crm_booking_clear_settings()` 调用和 return 路径不变；⑤沙盘必须有「只改金额也会多一行事件、old/new 正确」的用例，旧的 278 项仍全过（已核对旧测试没有 detail 全等断言，往 detail 加键不会破坏）；`set_amounts` 的「原因」通过事务内会话设置传给触发器写进 detail。
- **建单后**：金额允许更正（只走受控函数 + 原因 + 审计）；`origin_kind`/`evidence_ref` 仍不可改；两者互不依赖（`company_confirmed` 不要求金额）。`set_paid` 不要求金额；不加任何自动对账（金额不进邮件自动勾选）；对方的 278 个沙盘测试必须仍全过。
- **页面怎么算**（每个出发日、每种币种各算一份，**币种不相加**）：**定金**：已收 = 状态为已收的定金节点的 `amount_minor` 之和 / 应收 = 全部**有效**订单（`booking.status='active'`，节点要 join 订单才知道有效；取消流程不动节点，漏了 join 会多算）的定金节点 `amount_minor` 之和；**尾款**同理；另显示整单应收总价合计（`total_minor`）。**不推算、不按 0 计**。
- **不许把「没填」显示成「已齐」（第五轮必改）**：金额旁必须带「不含 N 单未填」；该栏只要有未填的单，**不许出现「已齐」「100%」或单独的「差额 0」**；已收节点没填金额的单单独计数「已收但金额未填 N 单」（不要和「金额未填」混成一个数）；尾款金额全空时显示「尾款金额未填」，不显示「已收 0 / 应收 0」。订单币种缺失的单（节点金额无币种可归）不计入任何币种，进「币种未填」。**已取消但节点已收**的单（定金可能已收）单列一行「已取消但已收 N 单（金额另列）」，免得这笔钱在页面上无声消失。
- **历史已收会随更正回溯变化**（`set_paid` 不快照金额），靠审计可追溯，写在这里提醒。
- **权限**：名单制已够严（名单里只有 2 个邮箱），现在**不**新增单独的「看金额」能力（过度设计）；等 PM 要把销售加进名单、又不想让他们看钱时再拆，那时是 A 级改动。**硬要求**：金额只出现在销售进度页的接口响应里；订单与付款自己的 overview / list / drawer 接口一律不 select 金额列，**我要加测试：这些路由的响应不含 `total_minor` / `amount_minor`**，对方也会在它那边的 route-capabilities / access-gate 测试里加断言。
- **审计里的金额与抹除（已核对对方迁移与设计稿 §7.3）**：`crm_booking_events` 的 `booking_id` 是普通 uuid（无外键、不含联系人 id、姓名、备注原文），联系人被删时订单与节点随之级联消失、审计保留；对方设计稿 §7.3 原来的前提是「审计表不含金额」，**加了金额之后这个前提要更新**：审计 detail 里的金额挂在订单 id 下，**不含姓名等直接标识**（审计里发票号也只存「有没有」的布尔），**决定保留金额**；但金额叠加出发日在小团里可能间接识别到人，所以**不写成「匿名」**。要求对方把 §7.3 的这句话改为「不含客人姓名、备注原文、发票号原文；含金额（订单 id 下的数字，小团中可能间接识别）」，**并在它的设计稿里落笔**，不只口头同意。保存期单独另议，**本设计不假设**。
- **3 月 9 单怎么填**：发票上只有定金（每人 NZ$1000）；导入时把「定金节点金额」按发票金额填，订单币种单独填 NZD（所以币种允许单独有值），**整单应收总价暂空**（草稿里没有总价，不猜），页面显示这 9 单「总价未填」「尾款金额未填」；待 CTS 销售给出总价或尾款金额后用 `crm_booking_set_amounts` 补。金额录错 = 用 `set_amounts` 更正（留记录）；订单整体录错（如币种）= 取消重建。

### 3.3 销售进度页（独立只读页）

- **位置**：`/dashboard/clients/[id]/sales-progress`（服务端页；客户首页入口卡片、Tour 目录页页头链接留后续步骤）。不放进客人页，不放进 Tour 目录页（目录页页头写明不记订单、权限是另一份名单、81 号窗口正在改它）。
- **权限**：`requireBookingAccess(clientId, 'view')`（名单制；底下依次过「付费客户」「名单」「该客户启用订单与付款配置」三道，没启用返回 404，非旅游客户进不去）。它返回的是 `NextResponse`，服务端页面要自己转成 `notFound()` 或「无权限」提示。页面、每个取数接口各自带同一道闸；**测试里照现有 `access-gate.test.ts` / `route-capabilities.test.ts` 的范式，断言每个新路由都调用了这道闸**；无权限账号/别的客户 id 取不到。名单里的人 `view` 与 `edit` 同权，本页只读，无风险；上线时能看的人 = 名单现有 2 个邮箱，要加销售请订单与付款窗口加。
- **读哪一层**：页面自己查一次 `crm_bookings`（只取需要的列，含新列）+ 出发日表 + 复用现有付款节点读函数；**不改**共享的 `BOOKING_COLUMNS` 清单和 `BookingRow` 类型（会牵动既有测试）。总览页的分页上限（50 条/`OVERVIEW_HARD_CAP`）要核对，超过上限时**不能悄悄少算**，必须显示「只读了前 N 条」。
- **共享代码里只认「销售单元」**：适配器接口 `listSalesUnits(clientId) → [{unitId, label, date?, capacity?, capacityNote?, unitStatus}]`；CTS 适配器读 `tour_catalog_departures`（只读，不写，不读 `internal` 其他键）；旅游词（团、出发日、座位）只在适配器与文案配置里。换成地产（楼盘/户型）或物流（发运批次）时外壳不改。
- **一行（一个出发日）显示**：
  1. **座位上限**：主来源 = 该出发日的 `internal.capacity`（内部座位，**不对外**；3 月四团均为 20）；若该团另有对外的团级 `max_group_size`（公开口径，上海周边团官方 18），**取两者较小者**并标注「内部 20 / 官方 18，按 18 算」。**不往 `max_group_size` 写 20，也不改任何对外字段**（CTS 红线：对外不出现人数上限；`max_group_size` 在发给官网的数据里，而 `internal` 不进任何输出）。都没有 = 「上限未设置」，剩余显示「上限未设置」，不默认 20。适配器只取 `internal.capacity` 这一个键，读后丢弃整个 `internal`。
  2. **已订人数**（只统计 `status=active`，人数 = 各单 `party_size` 相加）：**公司确认**（`source=company_confirmed`）｜**客人自述**（`customer_stated`）｜**待核实**（`staff_entered` 与来源未标）。**对外只说「公司确认」一栏。**
  3. **人数未填 N 单**：`party_size` 为空的订单单列，**不按 1 计**（订单窗口确认员工不一定都填）。
  4. **剩余**（保守算法，避免第一批全是待核实时高估空位而超卖）：上限 − （三栏之和）；旁小字「仅算公司确认：N」；若还有人数未填的单，加提示「另有 N 单人数未填，剩余可能更少」。**未归属的人数**（订单没挂出发日 `departure_id` 为空，或出发日行已被团目录硬删而 `departure_id` 悬空，靠订单上的出发日快照 `departure_depart_on` 认出）按团单列，并在该团每一行的剩余旁提示「另有 N 人未归属出发日，剩余可能更少」；测试加这两个夹具。已订 > 上限显示红字「超订 N 人」，不显示负数；只提示不拦截，文案写明「系统不会拦截，请销售自行把关」。
  5. **付款进度与金额**：已收定金 N 单 / 已收尾款 N 单；定金与尾款各自的已收/应收金额（按币种分开，算法见 §3.2）；「金额未填 N 单」「金额不一致 N 单」。
  6. **证据强度**（由现有列推出，一行取最弱）：**强** = 公司确认且定金已收；**弱** = 公司确认但定金未收；**未核实** = 客人自述 / 待核实。
  7. 每个数字可点开看是哪几张订单（只显示发票号、日期，不显示姓名电话）。
  8. 页头「数据截至 xx 时刻」；订单与出发日同一次查询读取。已取消的订单不计入任何栏；`cancelled/closed` 的出发日不进主列表，上面挂着的有效订单单列一行；`sold_out/limited` 要显示，不能当关闭。订单联系人被删会连带删订单（外键级联），座位数会无声减少——页头用「数据截至」并在订单数比上次少时提示。
- 另放两行小字：「订单未挂出发日」条数、「CRM 里阶段为已付但没有订单」的人数（只读差额，不联动）；3/25 等上限、3/27 日本团无上限的显示规则同上。
- 「公司确认」口径、剩余算法写在页面的服务端常量 + 测试里，第一步不做配置界面。
- **测试**：无权限账号/别的客户 id 取不到；金额只在进度页响应里，订单与付款的 overview/list/drawer 路由响应不含金额列；多币种分开不相加；节点金额缺失不按 0 计、该栏带「不含 N 单未填」且不出现「已齐」；只有定金的订单不标「金额不一致」；已取消订单的节点金额不入账、但进「已取消但已收」那一行；store 层断言 `createBooking`/`setPaid` 的返回里没有金额字段；对 `BOOKING_COLUMNS`/`MILESTONE_COLUMNS` 字面量断言不含 `total_minor`/`amount_minor`/`currency`（理由：现有读路径全是显式列清单，这是不让以后有人改成透传整行）；适配器无 `insert/update/delete/rpc` 且返回值里无 `internal` 其他键（用含航司航线的夹具断言）；内部 20 + 官方 18 → 按 18 并带差异说明；上限都缺 → 上限未设置；`party_size` 空的单不进人数、进「未填」；取消的单不计；剩余保守算法与超订显示。

### 3.4 3 月四团的数据怎么进来（导入工具）

- 来源：邮箱只读摸出的草稿（本地 Dropbox，含客人信息，**不进仓库**）；3/11 共 8 单 15 人、3/18 共 1 单 2 人、3/25 与 3/26 暂 0 单；全部是定金；CTS 销售对 8 条问题的核对回复后再定稿。
- 工具：本地脚本（不进生产服务）。**预览**：按电话/邮箱只读查 `contacts`（`select id` + `client_id` 过滤，电话用同一套归一化比较、邮箱小写比较；**不调 `resolveContact`**——它会在没命中时建人、命中时改最近接触时间）；命中 0 或 ≥2 的进「待人判断」，不自动建、不自动合并；输出打码清单 + 汇总，并**列出「导入后付款催办名单上会多出几条」**。→ **PM 在对话里说「导」**才执行。
- **应用，每单两步**：①调 `crm_booking_create_with_origin`（带 `origin_kind`、`evidence_ref`；`departure_id` **必须**用团目录里真实的出发日 id，不许导成「未挂出发日」；`booked_on` **显式传发票日期**，不用默认的今天）；②对**已确认收到定金**的单，再调现有 `crm_booking_set_paid`（deposit 节点，`paid_source='staff'`，**不带** `evidence_ref`——`email` 来源留给服务端邮件识别，导入工具不能用；`paid_on` 取发票或到账日）。不做第②步，这 9 单会被当成「欠定金」进催款名单、证据强度全显示「弱」，还会烧掉 CTS「每人每周最多 2 封」的额度。这 9 单的「已收」是员工代标的，审计里来源是 `staff`，页面文案不要写成「邮件核实」。
- 每单一个事务、带审计；任一单失败立即停止并报告已成功几单；脚本在本地写一份**只含订单 id 和发票号**的进度文件，重跑以它对账（并按发票号读回核对，见 §3.1）。
- **撤回**：对已导入的单调现有的 **`crm_booking_cancel`**（不是 `crm_booking_update`——它不允许改状态），需先逐单读出 `expected_updated_at`，`cancel_note` 写「导入批次 <日期> 撤回」（≤200 字）；已取消的单（报 `booking_not_active`）算「已撤回」，不算失败；不删行。取消后发票号释放（§3.1），可重导。
- 同一客人同一团两张发票（定金一张、尾款一张）：**不自动判断**，进待人判断由人选（尾款 → 在原单上用现有「已收款」操作；另一批人 → §8 的取舍）。**第一步每单只存一个发票号**（第一张）；尾款发票号第一步不进系统，只在备注里写（`paid_evidence_ref` 是邮件专用，不能混放）。
- 个人信息：原件不复制进仓库；脚本输出一律打码；PR/文档只出现代号。

### 3.5 「报价与付款」里的「报价」

订单从**发票**起算（`evidence_ref` 是发票号）。报价单号（如 `CTS4270406-…` 形状）是另一种编号，建单后 `evidence_ref` 不可改，报价→发票是两个编号，硬放同一行会冲突；报价阶段仍由 CRM 现有阶段承载。PM 若要在订单里看报价，另议。

## 4. 分步

| 步 | 内容 | 风险 |
|---|---|---|
| **1a** | 方案 + 迁移（给 `crm_bookings` 加 `origin_kind`、`evidence_ref`、CHECK、部分唯一索引、不可改触发器、新函数 `crm_booking_create_with_origin`、审计触发器替换），本机沙盘重放（含「旧 9 参调用仍成功」）；订单与付款作者复核；**PM 批准后**才在生产 apply | A |
| **1b** | 销售进度页（只读）+ 适配器 + 测试（可与 1a 并行开发，依赖 1a 的列才能显示来源栏；没有来源列时全部归「待核实」） | A（读客户订单数据、新页面） |
| **1c** | 导入工具 + 3 月 9 单（等 CTS 销售核对回复、PM 说「导」） | A（写订单） |
| 2 | 每周自动对账邮箱收款邮件（订单与付款窗口已有 P3/P4 自动勾选设计，本设计不另造）；待办落点复用其机制 | A |
| 3 | Tour 目录页页头加「查看销售进度」链接（先与改该页的窗口协调）；客人抽屉里一行只读证据行 | B |

## 5. 资源优先级（ENGINEERING_QUALITY_GATES §11）

频率高（3 月四团在售，每天问「这团几个人」）/ IMPACT 高（Measure 事实源，决定各团广告与跟进力度；第一步本身不连广告）/ 收入高（直接关系销售跟进与超订风险）→ **零低三高 → P0**（以 PM 最新指示为准）。

## 6. 风险与防线

1. **错数**：对外只说「公司确认」；每单可点开看发票号；来源缺失一律按待核实；`party_size` 空不当 1；剩余用保守算法；同一发票号只能进一次（部分唯一索引）。
2. **钱与外发**：本设计没有任何到 `me_sale_outcomes`/Meta 的路径；金额是**记账用的数字**，不进邮件自动勾选、不进任何回传；金额只在销售进度页接口里出现（有「其他路由不含金额」的测试守着）。
3. **不往对外字段写座位**：上限只读内部座位；`max_group_size` 只读不写；适配器测试断言。
4. **个人信息与权限**：页面名单制闸 + 取数接口各自同闸；号码/姓名不出现在进度页；导入原件不进仓库。
5. **改已上线表**：只加可空列 + CHECK + 部分唯一索引 + 触发器 + **新函数（不改现有函数签名）**；迁移先在沙盘重放；生产 apply 要 PM 同意；回滚 = 清空新列并去掉触发器/索引/新函数（列可空，旧数据不受影响）。数据库层的触发器挡得住应用层和 service-role，挡不住数据库 owner（迁移/SQL 通道），那一层靠「生产写入必须 PM 说同意/导」。
6. **与订单与付款窗口的边界**：本设计不改它的付款节点、提醒、自动勾选逻辑；只加两列和一个读页；加列的迁移由我出方案，**它的作者复核**（对方已同意方向，未复核具体 SQL）。

## 7. Reuse Statement

- 复用：`crm_bookings` 家族（订单、节点、审计、数据库函数）、`requireBookingAccess`、`booking-overview-*.ts` 分组逻辑、团目录出发日只读数据、`internal.capacity`。
- 新增：给订单加来源与发票号两列（platform-shared，列名中性）；销售进度页外壳（通用，只认「销售单元」适配器）；CTS 适配器与「公司确认」口径（L4，旅游词只在这里）。
- 行业专属：无。客户专属：发票号格式（5 位数字）、团号、座位数字。
- shared runtime 里有无客户名/ID/行业判断：无。
- 决策时分类与落点一致性：决策为「复用既有订单家族 + 通用只读外壳 + CTS 适配器」，实现落点按此，交付时对账。
- 层级判定：L1（既有 CRM/订单能力的扩展，证据只有 CTS 一家，按默认降级登记为候选，待 PM 一句「记」）。

## 8. 与订单与付款窗口的约定，以及需要 PM 回答的问题

**已由对方窗口答复（2026-10-13）**：①同意把来源 + `evidence_ref` 加在 `crm_bookings` 上（列名已按第四轮建议改为 `origin_kind`，需告知对方）（不放节点表）；旧行允许 null，不回填；新列进审计；②9 单走它的数据库函数（先对到 `contact_id`，不直接写表、不绕审计），导入属 A 级先出方案；③`party_size` = 「这单占几个座位」，可空，空的单列「人数未填」不按 1 计；取消 = `status='cancelled'`；尾款是同一订单的 balance 节点；「另一批人」现在建不了第二张，不要私自放宽索引；④销售进度页同走 `requireBookingAccess`，**不要**用 `requirePaidClientAccess`；它没有计划做座位/上限页。

**我的技术取舍（不抛 PM）**：「另一批人」第一步用**同一单把 `party_size` 加大 + 在备注里写明**，不改唯一索引；等真出现这种单、PM 要在系统里分开看时再出方案。

**要 PM 回答的问题（一次一条）**：
- **Q3（已答）**：PM 选「要金额」（统筹转述，2026-10-13），方案见 §3.2，订单与付款作者已同意。
- **Q5（已答，统筹转述 PM，2026-10-13：「就这两个」）**：销售进度页（含金额）只给 `crm_booking_members` 名单里现有的 2 个邮箱（info@ctstours.co.nz、ctstours1@chinatravel.co.nz）加 ME 管理员，**不扩名单**；权限沿用 `requireBookingAccess` 名单制。另：PM 在统筹窗口原话说过「60 CRM 需要显示金额」，已由统筹转给订单与付款窗口作依据（金额的依据因此有两处转述，仍以批准前请 PM 亲口确认一句为准）。
- ~~**Q5（原问题）：谁要看进度页？**~~ 现在名单里只有 2 个邮箱，CTS 销售不在里面就没人能用；要加的话请订单与付款窗口按名单加进 `crm_booking_members`。
- 后续（不一次抛）：Q4 对外只显示「公司确认」栏、「客人自述/待核实」只内部看，是否同意；Q6 外部下单系统上线后谁是准的；Q7 订单要不要也存「报价」。

## 9. 已知缺口（诚实声明）

- `crm_bookings` 现在 0 行：进度页第一版上线时全部是「还没人录」，要等 1c 导入（需 CTS 销售核对 + PM 说「导」）才有数。
- 生产库数字（出发日 34 行、`internal.capacity` 23 个为 20、3 月四团均 20、`crm_bookings` 0 行、`crm_booking_members` 2 行）是我读到的，未经第二人核对。
- 迁移 SQL 还没写：加列、新函数、触发器、审计替换都是方向性设计；v0.9 复用方案已过第四轮两审（带条件通过，条件已并入 v1.0），**迁移 SQL 写完还要订单与付款窗口作者复核，PM 批准后才能 apply**。
- 「公司确认」口径：由导入时声明 + PM 说「导」决定，不是逐单销售确认。
- 联系人合并后订单分叉、客人要求删除个人信息时订单怎么处理：沿用订单与付款窗口的既有处理（其设计稿 §7.3），本设计不另造。
- 3 月草稿里 9 单的核对（8 条问题）还在等 CTS 销售回复，最终数以回复为准。

## 10. 第四轮复审（只核对 v0.9 变更）处理对照

子牙 Round 4：带条件通过（4 必改 + 8 建议）；魏征 Round 4：带条件通过（8 必改 + 7 建议）。已全部并入 v1.0：

| 来源 | 要点 | 处理 |
|---|---|---|
| 子牙 M1 | 撤回要用 `crm_booking_cancel`（需 expected_updated_at；已取消算已撤回） | 采纳（§3.4） |
| 子牙 M2 / 魏征 1 | 改 `crm_booking_create` 签名会让界面「加订单」500 | 采纳：不改旧函数，另建 `crm_booking_create_with_origin`，测试旧 9 参仍成功（§3.1） |
| 子牙 M3 / 魏征 4 | 导入单定金默认未收，会进催款名单、证据强度全弱 | 采纳：create 后对已收定金的单 `set_paid`（staff，不带 evidence），预览列出催款名单变化（§3.4） |
| 子牙 M4 / 魏征 2 | 取消后发票号永久占用，无法重导 | 采纳：唯一索引限定 `status='active'`（§3.1） |
| 魏征 3 | 所有唯一冲突都报 duplicate_booking | 采纳：发票号冲突单独抛 `duplicate_evidence_ref`，重跑按发票号读回核对（§3.1） |
| 魏征 5 | `company_confirmed` 只靠函数、来源可被直写改 | 采纳：表上 CHECK + 来源与发票号都不可改（§3.1） |
| 魏征 6 | 未挂出发日/悬空订单让剩余高估 | 采纳：按团单列并在剩余旁提示（§3.3） |
| 魏征 7 / 子牙建议 1 | 审计触发器要扩 | 采纳（§3.1） |
| 魏征 8 / 子牙建议 3 | 每个新路由都要有同闸断言；`requireBookingAccess` 返回 NextResponse；名单只有 2 人 | 采纳（§3.3、§0、Q5） |
| 子牙建议 2 | `source` 与既有概念撞名 | 采纳：改名 `origin_kind`（需告知对方） |
| 子牙建议 4 / 5 / 6 / 8 | 不改共享读清单；级联删除；尾款发票号不进系统；`sold_out/limited` 要显示 | 采纳（§3.3、§3.4） |
| 魏征建议 4 / 5 / 6 / 7 | PM 话术、Q3 代价、录错=取消重建、页面上线是空的 | 采纳（§0、§8） |

不再做第五轮完整复审；若 PM 或统筹要求，只核对本表。**批准前不写代码、不改生产库。**

## 10b. 第五轮复审（只核对 v1.1 金额变更）处理对照

子牙 Round 5：带条件通过（3 必改 + 建议）；魏征 Round 5：带条件通过（5 必改 + 建议）。已并入：

| 来源 | 要点 | 处理 |
|---|---|---|
| 子牙 M1 / 魏征 4 | 两个审计触发器按列白名单、action CHECK 无金额动作，金额变更一条审计都不留 | 采纳（§3.2「审计怎么落地」） |
| 子牙 M2 / 魏征 5 | 改金额函数的并发令牌 | 采纳；两位意见取其合：订单、节点令牌各管各的；是否刷新订单令牌取子牙方案（不刷），理由见 §3.2 |
| 子牙 M3 | 取消订单的节点要 join 订单才知道有效 | 采纳（§3.2 算法） |
| 子牙 S4 / 魏征 1 | 3 月 9 单只有定金金额、没有总价，同有同无约束写不进去 | 采纳：币种可单独有值（§3.2） |
| 魏征 2 | 没填会被显示成已齐 | 采纳：「不含 N 单未填」、不许出现已齐/100%/差额 0（§3.2） |
| 魏征 3 | 「金额不一致」天天误报 | 采纳：改判据（§3.2） |
| 子牙建议 / 魏征建议 | 审计留发票号会连回客人；取消订单已收金额消失；回溯变化；PM 话术；返回整行；列清单字面量断言；币种白名单；币种改动限制；幂等无变化 | 全部采纳（§0、§3.1、§3.2、§3.3 测试） |

不再做第六轮完整复审；若 PM 或统筹要求，只核对本表。**批准前不写代码、不改生产库。**

## 11. 历史与复审记录（简）

v0.2–v0.8 经子牙 + 魏征三轮复审（带条件通过，条件均已并入当时的稿子）；其中关于座位上限不写对外字段（v0.8）、销售进度页独立只读、剩余保守算法、证据强度、行业/权限闸的结论沿用到本稿。v0.9 因发现与已上线的订单与付款进度重复而改为复用，第四轮复审结果见 §10。

## 12. 实现计划（草案；设计稿批准前不写进 `supabase/migrations`、不动库）

### 12.1 分三个 PR（各自过风险闸，按顺序）

| PR | 内容 | 风险 | 谁写 | 前置 |
|---|---|---|---|---|
| **A 迁移** | 给 `crm_bookings` / `crm_booking_milestones` 加列、约束、索引、触发器；新函数 `crm_booking_create_with_origin`、`crm_booking_set_amounts`；替换两个审计触发器；放宽 `crm_booking_events.action` CHECK | **A**（改已上线表 + 记钱，且迁移 apply 是不可逆动作） | Claude Code 自写（例外②：A 级安全核心 / 数据库函数，PR 里写原因） | 设计稿 PM 批准；PM 亲口确认「要金额」；订单与付款作者复核 SQL |
| **B 销售进度页** | 适配器、纯函数（剩余/已收/不一致/强度算法）、服务端页、取数函数、测试 | **A**（读客户订单与金额、新页面、名单制鉴权）| DeepSeek 写（Claude 出每轮指令 + 审 diff），鉴权与金额漏出相关由 Claude 复核 | PR A 的列在库里（页面在列不存在时全部降级为「来源未标/金额未填」，不报错） |
| **C 导入工具** | 本地脚本：预览（只读联系人查找）→ PM 说「导」→ 应用（逐单 `create_with_origin` + `set_paid`）→ 撤回（`crm_booking_cancel`） | **A**（写订单与金额） | DeepSeek 写，Claude 审 | PR A 已 apply；CTS 销售 8 条核对回复；PM 说「导」 |

### 12.2 文件清单（预计）

- **PR A**：`supabase/migrations/<时间戳>_crm_booking_origin_and_amounts.sql`（新）；`supabase/tests/crm_booking_origin_and_amounts.test.sql`（新，沙盘用）；`src/lib/crm/booking-http.ts`（`mapRpcError` 认识 `duplicate_evidence_ref`、`conflict:stale:` 已有）；对应单测；台账卡。
- **PR B**：`src/lib/crm/sales-progress/`（`units.ts` 适配器接口、`units-cts.ts` CTS 适配器、`calc.ts` 纯函数、`load.ts` 取数、`types.ts`）；`src/app/dashboard/clients/[id]/sales-progress/page.tsx` + `_components/`；若有点开明细的取数接口：`src/app/api/clients/[id]/sales-progress/...`（每个自带 `requireBookingAccess`）；`__tests__`（含「每个新路由都调同一道闸」、金额只在本页响应里、适配器无写调用、`internal` 其余键不出适配器、算法夹具）；客户首页入口卡片（`dashboard/clients/[id]/page.tsx` 一处）；台账卡。
- **PR C**：`scripts/import-march-bookings.ts`（新，本地运行，不进生产服务）+ 单测（打码、只读查找、失败停止、撤回幂等）；台账卡。
- **不碰**：订单与付款的 `booking-store-reads.ts` / `booking-overview-reads.ts` 列清单；`tour-catalog/*`；`contacts` 写入路径；`me_sale_outcomes`。

### 12.3 迁移（PR A）SQL 骨架（**草案，未写入仓库迁移目录、未执行**）

```sql
-- 1) 新列（全部可空，不重写表；旧行不回填）
alter table public.crm_bookings
  add column origin_kind text check (origin_kind in ('company_confirmed','customer_stated','staff_entered')),
  add column evidence_ref text check (evidence_ref is null or (length(evidence_ref) between 3 and 40 and evidence_ref !~ '\s')),
  add column total_minor bigint check (total_minor is null or (total_minor > 0 and total_minor <= 100000000000)),
  add column currency text check (currency is null or (currency = upper(currency) and length(currency) = 3)),
  add constraint crm_bookings_total_needs_currency check (total_minor is null or currency is not null),
  add constraint crm_bookings_company_confirmed_needs_evidence check (origin_kind is distinct from 'company_confirmed' or evidence_ref is not null);
alter table public.crm_booking_milestones
  add column amount_minor bigint check (amount_minor is null or (amount_minor > 0 and amount_minor <= 100000000000));
-- 2) 发票号唯一（取消不占号）
create unique index crm_bookings_evidence_ref_active_uidx
  on public.crm_bookings (client_id, evidence_ref) where evidence_ref is not null and status = 'active';
-- 3) origin_kind / evidence_ref 建单后不可改的 BEFORE UPDATE 触发器（不拦 updated_at 触碰）
-- 4) crm_booking_events.action：drop 旧 CHECK，重加（含现有全部 13 个取值 + 'milestone_amount_set'）
-- 5) create or replace crm_booking_audit_booking / crm_booking_audit_milestone（保持 crm_booking_clear_settings() 调用与 return 路径不变；
--    created 事件加 origin_kind、has_evidence_ref；金额变更写 old/new + 原因）
-- 6) 新函数 crm_booking_create_with_origin(...) / crm_booking_set_amounts(...)；不动旧 crm_booking_create 的签名
--    revoke all on function … from public, anon, authenticated; grant execute … to service_role;
```
币种白名单、发票号 5 位数字格式在**函数里**校验（CHECK 读不了客户配置）；`set_amounts` 的令牌/锁序/返回见 §3.2。

### 12.4 沙盘重放方案（本机 Postgres，不碰生产）

1. 按 `reference-local-postgres-replay-sandbox` 的做法起本机 Postgres（手写 Supabase 桩：`auth`/`service_role` 角色等）。
2. 依次重放：团目录迁移 → `20261012200000_crm_booking_tracker.sql`（原样）→ 订单与付款作者的 `supabase/tests/crm_booking_tracker.test.sql`，**必须仍是 278 PASS**（基线）。
3. 重放本迁移，再跑一遍 278 项（**必须全过**），再跑新增用例：旧 9 参 `crm_booking_create` 调用仍成功；`company_confirmed` 无发票号被拒；同一发票号取消后可重建、`active` 内不可重复；`origin_kind`/`evidence_ref` 建单后改写被拒；总价有值而币种空被拒；币种单独有值（总价空）可写；只改金额也多一行审计且 old/new 正确；`set_amounts` 令牌不符抛 `conflict:stale:`；两个人改不同节点互不覆盖、改同一节点冲突；新旧值相同不写不刷令牌；新函数 anon/authenticated 无执行权。
4. 沙盘输出（PASS 数、失败为 0）原样贴进 PR 的「当场试跑」。生产 apply 由 PM 回「同意」后才执行，**回读核对**列、约束、索引、触发器、函数权限。
5. **回滚方案**（迁移文件里同时带反向脚本，PM 批准 apply 时一并给）：去掉新触发器、新函数；还原两个审计函数为原版本（原文在原迁移里，保留逐字副本）；还原 `action` CHECK 到原 13 个取值；删新索引与新约束；列留着（可空，不影响旧行为）或在确认无数据后删。

### 12.5 PR B / PR C 的当场试跑方案

- **PR B**：本机用合成的订单/节点/出发日夹具起页面，截图贴 PR；生产上线后用只读核对「页面数字 = 数据库直接汇总」；因生产订单现为 0 行，首次上线页面是空的是**预期**，不算失败。
- **PR C**：先对一个测试客户跑完整「预览→导→撤回→重导」；对 CTS 真数据只跑**预览**（打码输出），**写入必须 PM 在对话里说「导」**；导入后回读：9 单、人数合计、定金已收、催款名单未多出这 9 单、`me_sale_outcomes` 行数不变。

### 12.6 费用与外发

迁移、页面、导入都不花钱、不外发、不触达任何客人；没有新的定时任务（每周对账是第 2 步，另案，不在本计划内）。

