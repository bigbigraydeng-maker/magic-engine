# 每日计划现状盘点与最快上线路径（只读，2026-10-07）

基线：`origin/main` = `bdfde6e1c`（刚 fetch）。数据来自生产库只读查询（SELECT）+ 代码阅读。没有改任何代码、没有写任何数据。
读过：CLAUDE.md、STATE.md、PITFALLS、两张 10-06 台账卡、10-06 方案、`playbook-social-general`、`project-daily-plan-campaign-split-paused`、`feedback-status-field-as-authorization-leaks-gates`、`feedback-readonly-api-investigation-standing-ok`；已过 `me-platform-tier-gate`（Inline：归位既有「社媒」支柱 + 既有发布 Connector，无新能力，无需登记）。

## 1. 每日计划现状（一句话：有审核台和发布出口，但没有「每天自动出计划」的那一段）
- **入口**：`/dashboard/clients/<客户id>/daily-plan`（9/29 拆成独立页，PR 2197）。页面 = 七日格子（Post/Story/Reel）+ 推广活动「视觉方向」+ 逐条审核。
- **每天怎么生成**：**没有自动生成**。计划是 PM 对窗口说一句话，agent 整理成指令，POST 写进 `social_plans`（`plan_kind=campaign_daily_v1`）。每份只覆盖一周，写完不会自己续。
- **怎么审**：管理员逐条 PASS/要改 + 清单（`post-review`）。**怎么发**：审完 → `publish-queue` 生成「待发回执」（事件 `daily_plan.publish_queue.ready`）→ `publish` 必须同时带「已批准」「发布授权」两个 true 才真发，默认只演练；发出去后事件 `daily_plan.post.published`，T+4h/T+72h 自动测量，可撤回。
- **只支持「图 + 文」的 Facebook Post**（走 `publishPagePhotoPost`，每条必须挂一张客户素材库的图）；纯文字发不了。Story、Reel 只有文案草稿，**不发布**。Reel 的 `media_status` 只有 NO_MEDIA/DRAFT_MEDIA。
- **生产里真实用量（SELECT 实测）**：整个系统只有 **4 份**每日计划，涉及 **3 个客户**（CTS 2 份、East Inter 1 份、NM Medspa 1 份）。CTS 第一份（9/3–9/9）7 条排进 Facebook，**6 条随后被撤回、只留 1 条**（撤回原因本次没查）；CTS 第二份（9/17–9/23）只审了 1 条 PASS，**从没发过**；East、NM 的计划**一条都没审过**。四份的日期**今天全部已过期**。
- **没通的环节**：①每周自动出计划；②Reel 自动带视频（R2b 零件已合并 #2301 但无人调用，R3 推迟到 10-20）；③「转投广告」是不能点的占位；④Instagram 没接；⑤**每日计划的发布出口没接 9/28 之后的「价格检查」**——`judgeOutgoingPost` 只挂在 Publer 的三个路由上，每日计划 `publish` 只靠人工审核清单（本次 grep 实测）。

## 2. 各客户卡点一览（active 客户 + 生产实测）
| 客户 | 每日计划 | 品牌手册(VI) | 推广活动 | 素材 | 主页 | 卡在哪 |
|---|---|---|---|---|---|---|
| **CTS** | 有 2 份，都过期、都没发成 | 有（active） | 2 个进行中到 12/22（Visa-free Nov–Dec；China Discovery） | 57 | FB ✓ IG ✗ | **不卡技术**：缺的是「出下一周计划 + PM 审」；缺价格检查闸（见上） |
| **East Inter** | 1 份，未审，已过期 | **无 VI** | 两个活动都已过期（9/28、10/5） | 7 | FB ✓ | 缺 VI + 缺新活动；9/28 事故客户 |
| **NM Medspa** | 1 份，未审，已过期 | 手册是 **draft** | 活动 10/4 过期 | 25 | FB ✓ | 手册没转正 + 缺新活动 |
| **Roman HU** | 无 | **无 VI** | 无 | 0 | FB ✓ | 缺 VI、缺素材、缺活动 |
| **New Asian Logistics** | 无 | 有 | 5 月后无新活动 | 1 | FB ✓ | 素材只有 1 张 |
| **Oztop** | 无 | 有 | 7 个都是 SEO 类 | 38 | **无 FB 主页** | 没有可发的主页，只能走 SEO，每日计划不适用 |
| NZCPE 2026 / Magic Lab Class | 无 | 有 / draft | — | 0 | FB ✓ | 非营销优先客户，本轮不排 |
| Magic Engine / Magic Lab | — | 无 | — | — | 无 | 内部，不排 |

## 3. 视频自动化：后台现在能用到什么程度
- **工厂审核页 `/dashboard/factory` 已能**：看片、一键确认、驳回/对话改、看「发布去向」状态（Facebook ✓ / Instagram ✗ / TikTok ✗ / 广告 ✗ / 每日计划 ✗）、下载成片、工单号复制。
- **真在跑的证据**：CTS 近两天 Remotion 工单 11 张：2 张已发 Facebook Reel（10/5、10/6 各 1），**8 张在等审**（积压），其余更早。**瓶颈已经是审片，不是出片**。
- **每日计划能不能自动带视频**：不能。零件 R2b（服务端生成视频参数）已合并但没人调用；R3（点一下→建工单→回写）按 PM 10/6 推迟到 Remotion 在 CTS 跑稳两周（10/20）。
- **提前做 R3 的代价与最小路径（供 PM 拍板，我不改范围）**：①先要把官网事实快照 PR 2270（草稿、狄仁杰安全审还没走）转正，否则没有真实价格/团期可喂；②R3 本体是 A 级：一个管理员接口 + 一个 Inngest 函数 + 回执，DeepSeek 写、我审、子牙+魏征双审；③试跑必须在生产库建一张草稿测试工单（要 PM 点头）；④代价 = 打破「瘦身」口径、占用审查带宽，且**视频越多审片积压越重**。我的建议：**不提前**，每日计划先用「图文」跑起来；视频仍走工厂审核页发。

## 4. 最快上线路径（三维打分，§11）
| 事项 | 频率 | IMPACT 关键度 | 收入关联 | 结论 |
|---|---|---|---|---|
| CTS 本周起每日「图文」计划（含价格检查闸） | 高（每天） | 高（卡在 Act，闭环里 Measure 已通） | 高（付费 growth 客户，直接影响线索） | **P0** |
| 提前 R3（每日计划自动带视频） | 高 | 高 | 中 | 高 2、低 0 → P1，但受 PM 范围与 10/20 约束，**交 PM 拍板** |
| East Inter 恢复每日计划 | 中 | 中 | 低（starter） | **P2**（先补 VI + 新活动） |
| NM Medspa 恢复每日计划 | 中 | 中 | 低（starter） | **P2**（先把手册转正） |
| Roman / NAL | 低 | 低 | 低 | **P3**（缺素材/VI，登记待认领） |
| Oztop | — | — | — | 不适用（无主页） |

**按客户的「一件事」**
- **CTS**：PM 做一件——回我「开 CTS 本周计划」并指定用哪个进行中活动（建议 Visa-free Nov–Dec）；系统做一件——DeepSeek 把「每日计划发布」接上价格检查闸（A 级，需你回「合」），同时由我按官网事实生成未来 7 天图文计划草稿给 PM 审。
- **East Inter**：PM 一件——提供/确认品牌色与 logo（现无 VI）；系统一件——据此补 VI 后另开新活动。
- **NM Medspa**：PM 一件——确认手册转正；系统一件——转正后出计划。
- **Roman / NAL**：PM 一件——给素材（Roman 0 张、NAL 1 张）；系统暂不动。

## 5. 红线对表
对外内容先对官网（CTS 价格团期只取官网/事实快照，不用 brief）；视频只走工厂；发布仍需 PM 授权事件，fail-closed 不变；客户事实只进配置/事实表，不进共享代码；Remotion 只做 CTS 一两个模板。**本盘点未写代码、未改数据库、未发任何东西。**

## 6. 未验证 / 注意
CTS 9/3 计划 6 条撤回的原因没查；各客户 VI 是否「够用」只看了字段是否有值，没逐字核；生产页面没在浏览器里点过（后台需登录，本窗口没有登录会话）。
