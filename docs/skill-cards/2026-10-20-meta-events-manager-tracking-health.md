# Meta 事件管理工具追踪体检：读懂数据集、诊断警告、已连接集成、匹配质量
状态：candidate（读接口部分已验证；诊断警告与集成清单的读取接口未找到）     行业：通用（Meta 广告）     支柱：广告
来源：PM 2026-10-20 提供的屏幕录屏（约 55 秒，无旁白，语音识别无输出）+ 统筹当晚用 Meta Ads MCP 与 Graph 只读核对 | 可信度：Meta 官方界面与官方接口的实测，属一线实操证据；页面里的「降低单次成效费用 17.8% / 40.6%」是 Meta 宣传口径，未核实 | 读取方式：录屏每 4 秒抽一帧，共 14 帧，每帧均读过；帧间约 3 秒未逐帧看（页面切换过程可能漏看）

## 专家怎么做（自己的话）
PM 在事件管理工具里依次看了四处：数据集总览（各数据集近 28 天事件数、来源标签）、诊断工具（待处理警告）、集成工具（已连接的像素、转化 API、网关）、合作伙伴向导（连接数据）。他的判断：这些是合格的 Meta 广告 Agent 都要具备的读取能力。

## 数字与门槛
- 录屏没有给出规则阈值。录屏里 Meta 页面的两条「降低单次成效费用」数字（17.8%、40.6%）：Meta 自己的宣传文案，**未核实，不进规则**。
- Meta 通知：自 2026-11-12 起符合条件的像素将开始衡量客户设备上的转化（页面原文大意）：**待验证**，生效日后核对报表口径是否跳变。

## 适用条件 / 不适用（反例）
- 适用：任何用像素 / 转化 API 回传事件的客户，开投前、开投后和每周。
- 不适用于：只投「点击进官网」且完全不看转化的最短期试投（体检仍要跑，但留资类警告可标「当前目标不依赖」）。

## 对账（已有 / 冲突 / 全新 + 读过哪些文件）
- 已有：发布前追踪检查 `src/lib/ads-tracking-preflight/`（数据集、近 24 小时事件、像素在线、匹配质量、数据集对齐等门，通读 judge.ts 相关段落）；`me-ads-launch-flow` 第 4 步清单第 6 条（只写「测试线索已落表」）；卫青手册（通读相关节）。
- 全新：读「诊断警告」与「已连接集成清单」；把「多条服务器回传路径、来源不明」作为必查项；警告分类去向。
- 冲突（审查后如实列出）：③本技能不另设匹配质量阈值，而发布前追踪检查里有固定软线（`judge.ts` 的 `MIN_LEAD_MATCH_QUALITY = 7`，低于 7 判黄），两者并存：规则库 E-06 要求不借用无出处数字，该软线的出处待核。①本技能初稿把「单一服务器回传路径、默认保留 ME 自己的转化 API」写成所有客户的默认，与台账 `2026-10-20-meta-capi-single-path-decision`「只限某客户」冲突，且技术上站不住（ME 回传用自己的记录编号当 event_id，与浏览器事件不去重；某客户终态是 Meta 自动镜像的网页事件 + ME 回传成交两条来源并存），已改为「同一事件名至多一条服务器来源，保留哪条由 PM 按客户定」。②初稿「只能 PM 去点」的做法与「能自动化就自动化、不给 PM 排去点按钮」冲突，已改。
- 读过：`src/lib/ads-tracking-preflight/`（judge.ts、types.ts、collect.ts、meta-reader.ts 通读相关段落）、`me-ads-launch-flow`、`me-meta-ad-account-setup`（仅 grep，非通读）、`client-promo-readiness`（仅 grep T2/T3）、规则库 E-06 / E-07 / RL-06（通读相关行）、平台候选登记表「Meta 广告数据地基健康诊断」、台账 single-path 决定。

## 裁决（逐条）
| 条 | 裁决 | 理由 / 影响 | 谁拍板 |
|---|---|---|---|
| 四屏体检步骤 | 吸收 | 补 launch-flow 第 6 条的空白，只读，可逆 | PM 已定方向（10-20） |
| 经向导再加一条服务器回传 | 忽略 | 会重复计数（只限某客户：官方数据集已有 Meta 自动镜像） | PM 10-20（某客户） |
| 「保留 ME 自己的转化 API 作为默认」 | 不吸收为通用规则 | 只限某客户的决定，写在客户层；通用规则改为「同一事件名至多一条服务器来源，保留哪条由 PM 按客户定」 | PM 按客户定 |
| Meta 宣传口径 17.8% / 40.6% | 忽略 | 无证据，不进规则 | — |
| 用接口读诊断警告 / 集成清单 | 待验证（目前读不到） | MCP 无此项；Graph 试过 diagnostics、integrations、partner_integrations、owned_domains 均不存在或无权，`da_checks` 只返回目录类检查 | 122 号评估 |
| 2026-11-12 设备端转化衡量通知 | 待验证 | 生效满 7 天后（11-19）看报表口径 | 日历提醒 |

## 验证（怎么验、结果、日期）
2026-10-20 只读实测（工具：Meta Ads MCP `ads_get_dataset_details`、`ads_get_dataset_quality`；Graph v19.0 `GET /{数据集}/da_checks`；用该客户的系统用户令牌只读，未发任何事件）：①`ads_get_dataset_details` 能读名称、是否活跃、最近触发时间、服务器事件最近触发时间、网关状态；②`ads_get_dataset_quality` 能读逐事件的匹配质量分、匹配键覆盖率、上传频率；③Graph `GET /{数据集}/da_checks` 返回 200，但只有目录 / 动态广告类 2 项检查，**读不到**录屏里的 3 条诊断警告；④页面显示网关「已连接」而接口返回「未接入」：**未查清**。122 号页面所见：网关指向另一个从未收到事件的数据集；魏征用接口未能印证（两个数据集都读到未接入、`openbridge_configurations` 为空）；集成页是商业账号级、接口是数据集级，可能并不矛盾。官方数据集上的服务器事件，122 号判断是 Meta 自动开启的「转化 API（仅限网页）」镜像（去重在事件详情页看，符合最佳实践），魏征用二手来源只能印证该功能存在。另验证（魏征复核）：按来源拆分的事件量可由 `ads_get_dataset_stats` 读到；去重覆盖率可由 Graph `dataset_quality` 读到（`dedupe_key_feedback`）；`openbridge_configurations` 能调用（只见过空列表）；`server_last_fired_time` 在 Graph v19/v21/v25 都报不存在，换版本号没用。集成清单与诊断警告接口：未找到。

## 落点
- skill：`.claude/skills/me-meta-tracking-health/SKILL.md`（新）；并入 `me-ads-launch-flow` 第 6 条与复盘模板；卫青手册 `docs/agents/11-weiqing.md` 职责 / 工具 / 判据 / 停手条件。
- capability 代码（读诊断警告 / 集成清单 / 自动回执）：台账 `2026-10-20-ads-agent-read-meta-events-manager-health`，P2，另走 tier-gate 与 Build Gate，派 DeepSeek。
- 备选验收（接口确实读不到诊断警告和集成清单时）：页面只读读取（PM 登录态）+ 广告总控每周读一次并写体检回执，并在台账卡 `2026-10-20-ads-agent-read-meta-events-manager-health` 里写明放弃代码化的理由；读取代码化时并入平台候选「Meta 广告数据地基健康诊断」，不另起一套。
- 客户层：具体数据集、警告、匹配质量在各客户目录（`docs/clients/<客户>/` 下的追踪体检发现），不进共享位置。

## 效果回写
（待用过之后回写：谁在哪次开投前用了、查出什么。）

## 机器索引
<!-- 给 ME 后台「Agent 学习库」页读的。state 词表见 docs/skill-cards/README.md。 -->
```json
{
 "points": [
  {
   "key": "four-screens-readonly-check",
   "text": "开投前、开投后、每周读事件管理工具四个屏并出体检回执（只读）",
   "state": "pm_decision",
   "note": "并入 me-ads-launch-flow 第 6 条；PM 合并本 PR 即视为拍板，之后另开台账卡登记规则库编号"
  },
  {
   "key": "one-server-source-per-event-name",
   "text": "同一事件名在一个数据集上至多一条服务器来源（保留哪条由 PM 按客户定）",
   "state": "already_in_me",
   "rule": "E-07"
  },
  {
   "key": "block-launch-on-red-or-gray",
   "text": "体检红或没法证明不开投，除非 PM 书面接受风险（回执 risk_acceptance）",
   "state": "pm_decision",
   "note": "新增挡开投规则，规则库 E-07 只写季度体检"
  },
  {
   "key": "read-diagnostics-and-integrations-by-api",
   "text": "用接口读诊断警告和已连接集成清单",
   "state": "cannot_check",
   "note": "MCP 没有此项；Graph 试过 diagnostics、integrations、partner_integrations、owned_domains 均不存在或无权；da_checks 只返回目录类检查；目前只能页面只读"
  },
  {
   "key": "read-dedupe-evidence-by-api",
   "text": "用接口读事件去重覆盖率和按来源拆分的事件量",
   "state": "learning",
   "note": "Graph dataset_quality 的 dedupe_key_feedback 与 MCP 的 ads_get_dataset_stats 按来源拆分可读，尚未做成代码"
  },
  {
   "key": "meta-marketing-claims-17-8-40-6",
   "text": "Meta 页面宣传数字：设置转化 API 后单次成效费用降 17.8%、接 GTM 降 40.6%",
   "state": "not_applicable",
   "note": "Meta 自己的宣传口径，无证据，不进规则"
  },
  {
   "key": "on-device-conversion-notice-1112",
   "text": "Meta 通知：2026-11-12 起像素开始衡量客户设备上的转化",
   "state": "verifying",
   "handoff": "2026-10-20-meta-on-device-conversion-notice-1112-check"
  },
  {
   "key": "partner-wizard-third-path",
   "text": "经 Meta 向导再加一条服务器回传",
   "state": "not_applicable",
   "note": "只限某客户：官方数据集已有 Meta 自动镜像且去重正常；其它客户按事件名是否重复判断"
  }
 ]
}
```
