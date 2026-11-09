# CRM「订单与付款进度」设计稿 v0.1（草案，未动代码、未改库）

日期：2026-10-12 · 状态：待 PM 回答第 9 节问题后再冻结 · 风险级别：整体 A（新表 + 鉴权 + 会外发信号的自动勾选）
读取基线：`origin/main` = `3a70f6e58f3c`（本地分支落后，代码一律按 main 读）。生产库只做了 SELECT。
平台层级（已定）：L1 CRM 能力（订单 + 里程碑追踪，通用）· L2 旅游行业默认付款节奏 · L4 CTS 的数字与开关。

---

## 1 目的与不做什么

**目的。** CTS 员工在 CRM 里打开一位客人，就能看到「他订了哪个团的哪个班期、定金付了没、尾款哪天到期」，系统每天提醒谁该被催。

**v1 只追踪进度，不碰钱。**
- 不存任何金额、不开发票、不对账、不退款；钱仍在 CTS 自己的订单系统里。
- 不把团名、出发日期抄进订单：只存 ID，名字和日期每次从团目录现读。
- 不自动给客人发催款邮件（v1 只提醒 CTS 员工；对客人外发属以后阶段）。
- 不做「团目录里记订单」（团目录刻意不存订单/付款）。
- 不改现有 `contacts.stage`（已付定金/已付全款）的含义，订单进度是它的补充，不是替代（见 §2.1）。

---

## 2 现状事实

### 2.1 CRM 现在怎么存「已付」
- 人：`contacts`（`supabase/migrations/20260726000004_unified_contacts.sql`），带 `stage`、`stage_updated_at` 等列。**没有任何团/班期/订单列**。
- 阶段定义：`client_pipeline_stages`（按客户一套）。CTS 现有 9 档，其中 `deposit_paid 已付定金`（动作 `suppress`）、`paid_full 已付全款`（动作 `won`，终结）（`20260728000001_leads_pipeline_stages.sql`；库里已核）。
- 改阶段的唯一入口：`src/lib/crm/advance-contact-stage.ts`（先写 `contact_stage_events` 审计，再改 `contacts.stage`；有并发保护 `expectedFromStage`）。
- **生产数字（CTS，2026-10-12 查）**：联系人 1170 人；`new` 368 · `contacted` 564 · `quoted` 69 · `no_response` 79 · `deferred` 43 · `deposit_paid` 16 · `paid_full` 5 · `traveling_soon` 8 · `not_interested` 5 · 未标 13。付过款（定金或全款）共 21 人。
- 这 21 人的阶段是谁写的（`contact_stage_events`）：CTS 员工邮箱 3 次、PM 通过 Claude 手工核对 16 次、`system` 2 次。**没有一条来自邮件自动识别。**
- **有意义的坑**：`deposit_paid` 的动作是 `suppress`，`stageSuppressesWorklist()`（`src/lib/crm/pipeline.ts`）会把这类人**从「今天联系谁」名单里排除**。所以「尾款快到期要催」不能直接塞进现有名单，否则永远看不见这批人（见 §6）。

### 2.2 「今天联系谁」与待办管道
- 现有名单页是「全部客人」`src/app/dashboard/clients/[id]/crm/all/page.tsx`；旧的 `/crm` 页已改成跳转。点人从右侧抽屉 `_components/PersonDrawer.tsx` 打开（`?contact=<id>` 深链）。**没有独立的单人页**，抽屉就是「客人页」。
- 名单算法：`src/lib/crm/day-list.ts`、`decision-list.ts`、`next-action.ts`（只分「今天要联系 / 先放着」；PM 10-10 定：意向不排序）。
- 今日待办管道：`src/lib/pm-todo/manual-items.ts` 及子模块（`manual-crm-items.ts`、`tour-catalog-publish-request-items.ts`）。每条要有 what/how/href 三件套；样板是「拉模式」直接查库、读失败只告警不抛错。

### 2.3 谁能看 CRM、谁能改
- CRM 的所有路由用 `requirePaidClientAccess`（`src/lib/auth/client-access.ts`）：**ME 管理员或「付费客户」档的登录账号即可**，没有再细分的名单。CTS 员工现在就是这样在改阶段（上面的 3 次员工改动）。
- 团目录不同：`src/lib/tour-catalog/access.ts` 的 `requireCatalogAccess` 额外要求邮箱在 `tour_catalog_members` 名单里（CTS 现有 2 人），并按角色×能力表放行。
- 结论：订单块若沿用 CRM 的闸，**CTS 所有付费账号都能看和改**；比团目录宽。是否收窄见 §7 与问题 3。

### 2.4 邮件付款识别（PR #2212 那套）
文件：`src/lib/conversions/payment-email-extract.ts`、`payment-email-detect-run.ts`、`payment-email-detect-wire.ts`。
- **开关现状：对 CTS 已经是开的。** 生产库 `clients.leads_config.payment_email_detect = {"enabled": true, "default_currency": "NZD"}`。（与「默认关」的说法不同：默认关，但 CTS 已打开。）每日由 `conversion-daily-pipeline`（Inngest）调用。
- **输出**：对每封确认信得到 `kind`（`deposit | full | balance | unknown`）、金额+币种、发票号、证据句。**它能区分定金和尾款**（看确认句里第一个名词），区分不了时给 `unknown`。
- **但它主动丢弃两类**：`balance`（计入 `balanceIgnored`，因 PM 决定「尾款不算成交」）和 `unknown`。也就是说**今天它根本不处理尾款确认信**。
- **它认的是「人」，不认「团」**：靠 `conversations.contact_id` 对到联系人，再用收件邮箱与联系人邮箱精确一致判定。全流程里没有任何团名/班期字段。确认邮件里即使写了团名，代码也不读。
- **产出去向**：写 `me_sale_outcomes`（成交记录，发 Meta 用）+ 审计 `me_conversion_audit`，并在自动车道里调用 `advanceStageForPayment` 把联系人阶段推到 `deposit_paid`/`paid_full`（仅当现阶段是 new/contacted/quoted/空）。
- **生产实测**：CTS 的 `me_sale_outcomes` 共 677 行，**全部是 `lead` 类、来源 `crm_sheet_sync`**；没有一条 `purchase`，没有一条带订单号。邮件识别尚未产出过任何成交记录。
- 每次最多自动发 10 条、单笔金额上限等安全闸，v1 订单勾选不应绕过也不需要碰（订单勾选不外发）。

### 2.5 团目录（要指向的对象）
- `tour_catalog_tours`（33 条）、`tour_catalog_departures`（34 条，全是 `open`，日期 2026-08-13 至 2027-11-14，只有 14 个团有班期）。未来 90 天内的班期仅 5 个。
- 班期列：`id, tour_id, depart_on, return_on, status`；`status` 只能是 `open | limited | sold_out | closed | cancelled`；`UNIQUE(tour_id, depart_on)`；`tour_id` 外键 `ON DELETE CASCADE`。
- 团时长只有文本列 `duration_text`（如「15 Days」「27 Days」）；**没找到**「是否邮轮」专用列（查过 `tour_catalog_tours` 全部列；`tags` 是 jsonb，里面是否放邮轮标记【假设】，未核）。班期有 `return_on`，可以算出真实天数。
- **班期会被硬删**：`tour_catalog_apply_batch`（`20261010300000_tour_catalog_access.sql`，撤销导入时 `delete from tour_catalog_departures`）。所以订单对班期的引用不能设成会连带删除的外键，也不能假设它永远存在。

### 2.6 可复用的模式
- 只增不改的变更日志：`tour_catalog_change_log` + 触发器 `tour_catalog_log_change()` + 阻止改删的触发器（`20261010150000` / `20261010300000`）。
- 乐观并发：改行前传 `p_expected_updated_at`，不一致抛 `conflict:modified`（同一份迁移里的 `tour_catalog_update_tour` / `save_departure`）。
- RLS 模板：`create policy ... for all to service_role using (true) with check (true)` + `revoke all ... from anon, authenticated`（`tour_catalog_members` 建表是现成样板）。
- 工作日计算：**没找到**。查过 `src/lib` 里 `businessDay|workingDay|addBusinessDays|public holiday`，仅有 `src/lib/locale/calendar.ts`（静态 AU/NZ 节日表，2026–2027，面向营销，含 `public_holiday` 类型）和 `src/lib/huatuo/seasonal-calendar.ts`。可复用节日数据但要自己写「加 N 个工作日」函数。

---

## 3 数据模型（提案）

两张新表 + 一个审计触发器。全部 service-role only（RLS：`for all to service_role using (true) with check (true)`，且 `revoke all ... from anon, authenticated`）。

### 3.1 `crm_bookings`（一位客人订了一个班期）
| 列 | 类型 | 说明 |
|---|---|---|
| `id` | uuid pk | |
| `client_id` | uuid not null → `clients(id)` | 隔离键，所有查询都带 |
| `contact_id` | uuid not null → `contacts(id)` | 订的人（主联系人） |
| `tour_id` | uuid not null | 指向 `tour_catalog_tours.id`；**不设级联外键**（见下） |
| `departure_id` | uuid null | 指向 `tour_catalog_departures.id`；null = 只知道团、不知班期（允许，进度里显示「班期未定」，不算到期日） |
| `party_size` | smallint null check (1..60) | 人数（订金按人头收，员工要看）；不是金额 |
| `status` | text check in (`active`,`cancelled`) | 订单是否还有效；取消 = 员工手点，不删行 |
| `booked_on` | date not null | 预订日（到期日起点，员工填，默认今天，NZ 时区） |
| `is_cruise` | boolean not null default false | 员工勾选（团目录暂无邮轮标记，见 §4.2） |
| `note` | text null check (length <= 500) | 员工备注（不放金额、不放证件号） |
| `created_by`, `created_at`, `updated_at` | | `updated_at` 用于乐观并发 |
唯一约束：同客人同班期不能重复（`unique (client_id, contact_id, departure_id) where status='active' and departure_id is not null`）。

**为什么 `tour_id`/`departure_id` 不用外键。** 班期会被硬删（§2.5），`tour` 外键又是 `CASCADE`。若订单加外键，要么拦住团目录的撤销导入（伤到团目录），要么跟着被删（订单凭空消失）。所以只存 ID，**写入时由数据库函数核对存在**，读取时现查；查不到就显示警告（§3.4）。这符合「不抄、只指」。

### 3.2 `crm_booking_milestones`（订单的付款节点，一单两行）
| 列 | 类型 | 说明 |
|---|---|---|
| `id`, `booking_id` → `crm_bookings(id)`, `client_id` | | |
| `kind` | text check in (`deposit`,`balance`) | 行业通用的两节点；以后可扩 `final_docs` 等 |
| `due_on` | date null | **计算结果的缓存**（见 §4）；null = 算不出（班期未定/已失效） |
| `due_override_on` | date null | 员工手改的到期日（与计算值冲突时以它为准，并留痕） |
| `state` | text check in (`unpaid`,`paid`,`waived`) | 未付/已付/免付（员工点） |
| `paid_on` | date null | 实际付款日（员工填或取邮件日期） |
| `paid_source` | text null check in (`staff`,`email`) | 谁勾的 |
| `paid_evidence_ref` | text null | 邮件来源时的内部引用（`conversation_messages.id`）；**不存邮件原文、不存金额** |
| `updated_at` | | 乐观并发 |
唯一：`(booking_id, kind)`。

### 3.3 `crm_booking_events`（只增不改的审计表，照 `tour_catalog_change_log`）
列：`id, client_id, booking_id, milestone_kind null, action`（`created | edited | cancelled | milestone_paid | milestone_unpaid | milestone_waived | due_changed | auto_tick_proposed | auto_tick_rejected`）`, before jsonb, after jsonb, actor text, source`（`staff | email | system`）`, created_at`。
- 由数据库触发器在 `crm_bookings` / `crm_booking_milestones` 变更时写入，照 `tour_catalog_log_change()`；并加「不许改、不许删、不许清空」的触发器。
- `actor`：员工 = 登录邮箱（小写）；邮件识别 = 固定字符串 `auto:payment-detect`（与现有 `advanceStageForPayment` 的 `auto:payment-detect` 对齐）。
- 不写邮件原文、不写金额；只写邮件引用 id。

### 3.4 取消 / 关闭 / 被删班期时的行为（读时判定，不改订单）
读订单时服务端现查班期，得到一个 `departureHealth`：
- `ok`：班期存在且 `status in (open, limited, sold_out)`。
- `closed`：班期 `closed`。显示橙色「该班期已关闭，请确认客人是否已改团」。
- `cancelled`：班期 `cancelled`。显示红色「该班期已取消」。
- `missing`：班期查不到（被硬删或团被删）。显示红色「团目录里找不到这个班期」，并从 `tour_catalog_change_log` 读回删除前的出发日期供员工辨认（读取，不复制进订单）。
- `date_changed`：班期的 `depart_on` 与订单上次「确认过的出发日」不一致——为此订单要存一个 `confirmed_depart_on date`？**这是抄数据，v1 不做**；改为：到期日缓存 `due_on` 与现算值不一致时，视为「班期被改过」，显示黄色「出发日改过，到期日已按新日期重算，请核对」。
警告出现时，该订单的提醒仍然发出（不静默），文案加「班期有异常」。

---

## 4 到期日计算

### 4.1 三层放哪
- **平台通用（L1）**：纯函数 `computeMilestoneDueDates(rule, { bookedOn, departOn, durationDays, isCruise, holidays })`，只认「规则对象」，不认任何客户名/数字。放 `src/lib/crm/booking-schedule.ts`（拟）。
- **行业默认（L2）**：旅游行业规则**形状**（两个节点：定金 = 预订后 N 个工作日；尾款 = 出发前 M 天，M 随团长/邮轮分档）。放行业 Playbook/Profile（拟 `src/lib/crm/industry/travel-booking-rule.ts`，只给形状与占位，**不含 CTS 数字**）。
- **客户配置（L4）**：CTS 的数字放在 `clients.leads_config.booking_schedule`（`leads_config` 就是 CRM/线索类配置所在，已有 `payment_email_detect`、`own_email_domains` 等键；与 `payment_email_detect` 同一处）。拟结构：
  `{ "enabled": true, "deposit_due_working_days": 3, "balance_lead_days": { "standard": 90, "long_or_cruise": 120 }, "long_tour_min_days": 16, "holiday_region": "NZ" }`
  （数字由 PM 在问题 1 确认后写入；上线前不写进代码。**定金金额「每人 NZD 1,000」不进配置**：v1 不存金额。）
- 没配 `booking_schedule` 的客户：订单块不出现（fail-closed），不套用别人的数字。

### 4.2 怎么算
- 定金到期 = `booked_on` 之后第 3 个**工作日**（工作日 = 周一至周五且不是新西兰公共假日；假日表复用 `src/lib/locale/calendar.ts` 的 NZ `public_holiday`，只覆盖 2026–2027，需每年补；缺年份时**不静默按无假日算**，而是标「假日表缺失，到期日可能偏早」）。【假设】CTS 说的「3 working days」按新西兰奥克兰工作日理解。
- 尾款到期 = `depart_on` 减 90 或 120 天（日历天，非工作日；落在周末/假日是否顺延见问题 2）。
- 档位判定：天数 = `return_on - depart_on + 1`（班期有 `return_on` 时），否则退而解析 `duration_text`；**天数 ≤ 15 且非邮轮 → 90，否则 120**。「邮轮」目前没有结构化标记，v1 由员工在订单上勾「邮轮」（`crm_bookings.is_cruise boolean default false`，相当于补一列）或之后由团目录补字段——见问题 4。
- 到期日是**现算**：读订单时按当时的班期日期重算；`due_on` 列只是缓存，供「今日提醒」用 SQL 一次扫出。班期日期变了，下一次读/每日扫描会刷新缓存并记 `due_changed` 事件。

### 4.3 边界：预订时已经太近
- 现算尾款到期日 **早于或等于预订日** → 不报「已逾期」，而是置 `due_on = booked_on + 定金到期规则`（即与定金同日到期），状态标「一次性全款」，提示「这单预订时已进入尾款期，请按全款处理」。显示上合并成一个「全款」节点。这是约定，需 PM 确认（问题 2）。
- 预订日在尾款到期日之前但不足定金工作日：两节点各自独立算，可同日到期。
- 班期为 null：不算到期日，提醒文案「班期还没定，补上班期才有到期日」。
- 员工手改到期日：写 `due_override_on`，事件里记前后值与改的人；之后系统重算不覆盖手改值，只在界面提示「与按规则算的日期不同」。

---

## 5 自动勾选（邮件识别 → 订单）

**原则：能对上就勾，对不上就进人工待办，绝不猜。**

### 5.1 能识别什么、不能识别什么
- 能给到：`联系人`（已有）、`kind`（定金/全款/尾款/不明）、收款确认邮件的 id。
- 给不到：**哪一个团/班期**（§2.4 已证实）。订单要对上，只能靠「这位客人当前有几张有效订单」。

### 5.2 对订单的匹配规则（全部满足才自动勾）
1. 联系人已被识别（`cand.contactId`，且 `do_not_contact` 不挡——勾选不是外发）。
2. 该联系人**恰好 1 张** `status='active'` 的订单（0 张或 ≥2 张 → 不自动，进待办）。
3. 邮件 `kind` 为 `deposit` 且订单的定金节点 `unpaid`，或 `balance` 且尾款节点 `unpaid`；`full` 视为两个节点都勾（仅当两个都 `unpaid`）；`unknown` 不勾。
4. 订单班期健康（`departureHealth = ok`）。
5. 同一封邮件（`paid_evidence_ref`）没勾过任何节点（防重放）。
满足：写 `state='paid'`、`paid_source='email'`、`paid_on` = 邮件发送日（NZ 日期）、事件 `milestone_paid`（actor `auto:payment-detect`）。
**自动勾可撤销**：界面上员工点「这个勾错了」→ 改回 `unpaid`，事件 `milestone_unpaid`，并把该联系人 30 天内该邮件记入「拒绝」不再自动勾。

### 5.3 对不上时
任何一条不满足 → 不写节点，写事件 `auto_tick_proposed`（带联系人、邮件引用、原因：`no_booking` / `multiple_bookings` / `kind_unknown` / `already_paid` / `departure_unhealthy`），并进今日待办「🙋 需要你动手」（what：谁的哪封确认信没法对上订单；how：打开该客人，选订单点「已付」；href：`/dashboard/clients/<id>/crm/all?contact=<contactId>`）。待办按联系人去重，处理后（勾了或标「无关」）消失。

### 5.4 接入点（最小改动）
在 `payment-email-detect-run.ts` 的 `processOne` 里，`kind === 'balance'` 与 `unknown` 被丢弃之前，**只读地**把 `{contactId, kind, messageId, sentAt}` 交给一个新的 `matchEmailToBooking()`（放 `src/lib/crm/`）。**不改**现有「尾款不入成交表、不发 Meta」的决定：订单勾选与 Meta 回传是两条独立支路。也不改自动阶段推进。
- 因为识别器只在开关为真时运行，订单勾选自动继承这个开关；另加一个独立开关 `leads_config.booking_schedule.auto_tick_from_email`（默认 false），先只勾 `auto_tick_proposed` 提案、不真勾，观察后再开（见 §8 P3）。
- 重要副作用提醒：识别器目前对 `dryRun` 有全局支持；匹配函数必须同样尊重 `dryRun`（不写）。

---

## 6 界面（文字线框）

### 6.1 客人抽屉里的「订单与付款」块
位置：`PersonDrawer.tsx` 里「到哪一步了」那一行与 `MarkWonPanel` 之间（`stage-line` 之后）。仅当该客户配了 `booking_schedule` 才显示。

```
订单与付款                                  [＋ 加订单]
┌────────────────────────────────────────────────────┐
│ 新西兰南北岛 14 天 · 2027-03-12 出发 · 2 人            │
│ ⚠ 该班期已关闭，请确认客人是否已改团                   │
│ 定金   ✅ 已付 10月08日（员工 anna@…）                  │
│ 尾款   ⬜ 未付 · 到期 2026-12-12（还有 61 天）  [标已付]  │
│ [改到期日] [取消订单] [历史记录]                        │
└────────────────────────────────────────────────────┘
```
- 文案只写日期与状态，没有金额。「历史记录」展开事件表（谁、什么时候、来源=员工/邮件）。
- 加订单：先选团（搜团目录，只读），再选班期，填预订日（默认今天）、人数、是否邮轮；提交即建一单两节点。
- 并发：点「已付」时带 `expected_updated_at`，别人刚改过就提示刷新（沿用阶段修改的做法）。
- 自动勾选的节点带标记「邮件自动」+「勾错了」按钮。

### 6.2 「今天联系谁」提醒
**独立一个分段，不混进现有冷热名单**（理由：已付定金者动作是 `suppress`，会被名单排除，§2.1）。放「全部客人」页的段头旁，名称「付款要催」：
```
付款要催（4）
 🔴 已逾期  Wang · 定金 · 到期 10月09日 · 新西兰南北岛 2027-03-12
 🟠 3天内到期  Li · 尾款 · 到期 10月15日 · …
 🟡 14天内  …
```
- 取数：一次 SQL 扫 `crm_booking_milestones` where `state='unpaid'` and `due_on <= today+14`，联系人 join、剔除订单已取消、剔除 `do_not_contact`。
- 点一行 → 打开该人的抽屉（`?contact=`）。
- **同一客人 7 天内群发不超过 2 封**的规则（PM 10-08）只管给客人发邮件；v1 提醒只给员工看，不触发邮件，故不适用；以后做对客人催款时必须遵守。

### 6.3 今日待办（PM 管道）
只放两类（符合「今日待办只留 5 类」）：①§5.3 对不上订单的付款邮件；②订单班期取消/删除（客人要被安排）。**日常「X 号到期」不进 PM 待办**（那是员工的活，在 §6.2）。每条带 what/how/href。接入方式：新文件 `src/lib/pm-todo/booking-items.ts`，照 `tour-catalog-publish-request-items.ts`（拉模式、读失败只告警）。

---

## 7 权限与审计

- **看 / 改订单**：沿用 CRM 的 `requirePaidClientAccess`（admin 或付费客户档）。CTS 员工今天就在用这个闸改阶段，订单块不增加新的暴露面。**所有 API 路径带 `client_id`，所有查询带 `client_id` + 联系人属于该客户的校验**（照 `advanceContactStage` 的 IDOR 闸）。
- **更严的可选项**（问题 3）：只允许某些员工勾付款（类似 `tour_catalog_members`）。若要，复用同一张成员表思路，另建 `crm_booking_members`，不并入团目录名单（两者语义不同）。
- **团目录只读**：搜团、读班期通过服务端读 `tour_catalog_*`，不要求员工在 `tour_catalog_members` 名单里；不调用团目录的编辑接口。
- **登录邮箱 = 操作人**：身份只取会话邮箱，不读请求体里的「操作人」。
- **审计**：§3.3 的 `crm_booking_events`，数据库触发器写（应用层写漏不了），只增不改不删。事件三要素：谁（actor）/什么时候/来源（staff|email|system）。
- **隐私**：订单与事件里不放邮件原文、不放金额、不放证件号；邮件证据只存内部 id。删除个人信息请求：联系人被抹除时，订单随 `contacts` 的现有流程处理（拟：`contact_id` 外键 `ON DELETE CASCADE`；审计表因只增不删，需单独的脱敏流程——待定，问题见 §9）。
- 新路由：`/api/clients/[id]/crm/bookings/...`（GET 列表/POST 建单/PATCH 节点/PATCH 取消），沿用 `contacts/[cid]/stage/route.ts` 的写法（鉴权 → 解析 body → 调 lib 函数）。写操作走数据库函数（带乐观并发与存在性核对），不在路由里拼多步写。

---

## 8 分阶段交付

| 阶段 | 内容 | 风险 | 测试要点 |
|---|---|---|---|
| **P1 最小可用** | 两张表 + 审计表 + 触发器；到期日纯函数；`booking_schedule` 配置读取；抽屉里的订单块（加单/手勾/改到期日/取消）；班期健康警告 | **A**（新表、新路由、鉴权） | 迁移预演（本机沙盘，不碰生产）；RLS 与 `revoke` 断言（匿名读写必须被拒）；跨客户读写被拒；乐观并发 409；到期日边界（周末、新西兰假日、年份缺失、预订太近、班期 null）；审计触发器不可改删；班期被删/取消/关闭的警告三态；**变异探针**：把 90/120 互换、把工作日算成日历日，必须有测试变红 |
| **P2 提醒** | 「付款要催」分段；今日待办两类条目；每日刷新 `due_on` 缓存 | B | 分段穷尽（每条未付节点恰好落一档）；已取消/拒联/已付不出现；**当场试跑**：用 CTS 测试订单手动触发一次，贴扫出条数 |
| **P3 邮件自动勾（先只提案）** | `matchEmailToBooking()` 接进识别器；先只写 `auto_tick_proposed` + 待办，不真勾 | **A**（影响识别器、生产有数据） | 恰好 1 单/0 单/多单/已付/kind=unknown/班期异常 各一条；`dryRun` 不写；重复邮件不重复勾；在 CTS 上用 `dry_run` 跑出对上/对不上数量给 PM 看 |
| **P4 邮件自动真勾** | 打开 `auto_tick_from_email`；员工「勾错了」撤销 | A | 撤销后 30 天不再对同一封自动勾；对客户开关前先看 P3 的数量 |
| **以后（不在本稿）** | 对客人自动催款邮件（要遵守 7 天 2 封）；团目录补「邮轮」结构化标记；订单从 CTS 订单系统导入 | — | — |

交付纪律：P1 用 `feat/` 分支（`claude/*` 有文件数上限）；A 级由机器不合，PM 回「合」才合；写代码交 DeepSeek，Claude 只审与跑测试（CLAUDE.md §5）。P2/P3 涉及「以后才自动跑」的东西，交付前必须当场手动触发一次，PR 里写「当场试跑」一段。

---

## 9 风险与未决问题（需要 PM 回答，每条一句话可答）

1. **数字确认**：定金「预订后 3 个工作日」、尾款「出发前 90 天（≤15 天且非邮轮）/ 120 天（其余）」，是 CTS 官网条款原样吗？回 `对` 或写出正确数字。
2. **预订太近怎么办**：如果客人预订时已经进了尾款期（例如离出发只剩 60 天），是「按全款一次性收、与定金同一天到期」吗？回 `对` 或说你们实际怎么做。
3. **谁能点「已付」**：CTS 所有付费账号都能点，还是只限几个人（像团目录那样一份名单）？回 `都能` 或给名单。
4. **邮轮怎么认**：团目录里没有「邮轮」标记，v1 让员工建单时手勾可以吗？回 `可以`，或告诉我哪些团是邮轮（我去补团目录）。
5. **尾款到期日落在周末/假日**：到期日顺延到下个工作日，还是按原日期算？回 `顺延` 或 `不顺延`。
6. **一位客人多个团**：同一人同时订两个团是常见的吗？（决定「只有 1 张订单才自动勾」会多常卡住。）回 `常见` 或 `少见`。
7. **订单谁来录**：员工在客人页手工建单（v1 做法），还是你希望以后从 CTS 订单系统批量导入？回 `手工先上`。
8. **客人要求删除个人信息时**：订单与审计记录里只有内部 id、没有姓名金额，可以保留审计记录吗？回 `可以保留`。

**技术风险（我自己负责，不需要你拍）**
- 邮件识别器对 CTS 已开启，接线必须守 `dryRun`，否则试跑会写库（P3 测试覆盖）。
- 假日表只覆盖 2026–2027，缺年份要显式提示，不静默。
- 订单不加外键给班期，靠写入核对 + 读时警告；若团目录以后改成软删，可再补外键。
- `claude/*` 分支有文件数闸，用 `feat/` 前缀。

---

## 10 Reuse Statement

**复用了什么已有平台能力**
- 联系人与身份：`contacts`、`contact_identities`；改阶段与审计：`advance-contact-stage.ts` / `contact_stage_events`（不改，只并存）。
- 鉴权：`requirePaidClientAccess`（`src/lib/auth/client-access.ts`）；IDOR 闸写法照 `advanceContactStage`。
- 审计与并发：`tour_catalog_change_log` 触发器 + 只增不改触发器 + `p_expected_updated_at` 乐观并发（照搬模式，不引用表）。
- RLS 模板：`tour_catalog_members` 建表写法。
- 邮件付款识别：`payment-email-extract.ts` 的 `kind` 与 `payment-email-detect-run.ts` 的联系人匹配（只读接入）。
- 待办管道：`pm-todo/manual-items` 子模块写法；团目录读取：服务端读 `tour_catalog_*`。
- 节日数据：`src/lib/locale/calendar.ts`（NZ `public_holiday`）。

**新增里哪些是平台共享（L1）**：`crm_bookings`/`crm_booking_milestones`/`crm_booking_events` 三张表；`computeMilestoneDueDates` 纯函数；「订单与付款」块与「付款要催」分段；`matchEmailToBooking` 的匹配规则（只认联系人、节点类型、订单数量）。表里没有任何客户名/客户 ID/金额。

**行业专属（L2 旅游）**：「定金 + 尾款，按出发前天数分档」的规则形状与默认字段名；以后地产版（如定金 + 交割）用另一份行业规则，复用同一套表与函数。

**客户专属（L4 CTS）**：`leads_config.booking_schedule` 里的 3 / 90 / 120 / 15 天分界与 `holiday_region: NZ`；`auto_tick_from_email` 开关。**没有把 CTS 的名字、ID、数字写进共享代码**；未配置的客户整块不出现。

**学习沉淀**：本稿不产生跨客户学习；订单事件是 CTS 私有记录。若多个旅游客户证明「预订太近→全款」成立，再升到行业 Playbook。

**快速自检**：把 CTS 换成另一家旅行社，只改 `leads_config.booking_schedule` 的数字；换成悉尼地产客户，只换行业规则文件，表与界面不改。
