# 页面就绪回执自动读回 + 违禁词单一源头 · 设计 v0.3（增量稿）· 只设计，未写代码 · 119 号 · 2026-10-21

> 在 `…-v0.2.md` 之上的增量：**冲突处以本稿为准**。吸收子牙+魏征对 v0.2 的复审。风险级含 A（新表、对外只读接口、进开投闸）。官网（121）与 ME 都等审后再开工。

## 1. 当前状态表的写保护与开投闸判定（两位）

v0.2 说「唯一写入者靠全仓扫描测试」太弱：表若是 `FOR ALL TO service_role`，Oztop 插件存着 service_role 总钥匙，任何拿到它的人都能改成 `ready`；「人工首份由人写入」也是第二个写入者。按台账 v0.7 同级处理：
1. **撤销 `service_role` 对 `landing_readiness_current` 的 INSERT/UPDATE/DELETE**，只保留一个 `SECURITY DEFINER` 函数 `landing_readiness_upsert_v1(...)` 写入；函数体内校验：页面路径在登记表里、`checked_by` 取值属于封闭集合（`me_readback` 或 `human:<邮箱>`，人只能经管理员会话路由调用）、字段形状合法；**常驻权限断言**（迁移后 CI 里查 `has_table_privilege('service_role', …, 'INSERT')` 必须为 false）。人工首份通过同一函数、同一校验，不是第二写入者。
2. **开投闸不信 `status` 列，也不信 `expires_at`**：闸读该行的 `fields`（各项读回结果）与 `checked_at`，**用平台层纯函数现场重算 `status`**；过期按 `checked_at + 有效期` 自己算。
3. **有效期由 24 小时收紧为 3 小时**（每小时刷新一次，所以正常有 2 次余量）；并且**闸在启用广告的那一刻现场重读一次页面**（一次 `landing-probe` + 一次状态接口），不用库里的旧行放行。
4. **闸核「广告实际落地 URL」**：取广告创意的实际落地链接（`call_to_action.value.link`），跟随跳转到最终地址，规范化出路径，必须与登记的页面路径一致（处理 `utm` 参数、尾斜杠、大小写、跳转）；对不上 → 拦。
5. **写明限度**：页面从 ready 翻红时，**已经在投的广告不会被自动停**，只出待办（要停需要走暂停通道，由人决定）；这道闸只管「开投前」。

## 2. 删掉「状态翻转追加台账回执」（子牙倾向，我同意）

v0.7 的 14 个阶段、9 个 actor 的写权限矩阵里没有「页面就绪变了」，`ads-landing-readiness-watch` 没有对应 actor；`landing_ref` 在 v0.7 和仓库里都不存在；追加回执要新增阶段/actor，会扩大台账的攻击面和复杂度。
- **删除** v0.2 §1.3 里「追加一条普通回执」这一句。状态翻转**只出待办**（what/how/href）+ 更新当前状态表。
- **页面清单只用追踪体检已有的 `LandingTarget` 配置**（`ads-tracking-preflight/client-config`），不再读台账里 page 请求的 `landing_ref`。台账与页面就绪**解耦**；开投闸只读当前状态表。

## 3. 读回的盲区与交叉核对（魏征）

写明 `landing-probe` **不执行 JavaScript**，所以：
- **客户端渲染的文案（倒计时、"weeks left"）抓不到**——这是已知盲区。缓解：①官网把这类文案做成服务端渲染是官网的事（121 稿已有「模板页价格只经团数据」）；②`copy_clean` 的规则里「countdown/weeks left」等词，在官网**源码层**由官网 CI 的测试（`facts.ts` 逐句检查）兜；ME 侧读回只覆盖服务端渲染出来的 HTML。**不声称覆盖客户端渲染。**
- **可见文本范围扩大**：除剥掉 script/style 后的正文外，还要检查 `<img alt>`、`title` 属性、`<meta name=description>`、Open Graph（`og:*`）、`application/ld+json`（JSON-LD）里的文字，一并跑违禁词规则。
- **页面班期/价格文字与接口交叉核对**：状态接口增加 `departure_dates[]`（规范化后的未出发班期日期）与 `from_price`（规范化数字）；ME 从渲染 HTML 里抽取页面显示的班期日期/价格，**必须与接口返回一致**，不一致 → `not_ready`（`page_state_mismatch`）。这样「接口说有班期、页面其实显示别的」会被发现。
- **`generated_at` 证明不了数据新**（官网自己盖章只说明请求是新的）：接口返回 `tour_data_version`，同时**页面 HTML 里放一个 `<meta name="tour-data-version" content="…">`**（官网实现）；ME 核对两者相等，证明页面与接口读的是同一份数据；`tour_data_version` 变化也写进 `state_hash`。
- **`terms_in_sync` 要比「线上在跑的那版」，不是仓库主干**：状态接口与页面 meta 同时给出 `terms_version`（运行时加载的词表版本）；ME 与自己当前导出的规则集版本比对（且 ME 拉主干副本重算哈希，二者都满足才算同步）。
- **范围规则遇 `offer_ref` 为空**：若规则集里存在 `scope: {offers:[…]}` 的规则而该页面没有 `offer_ref`，**判 `not_ready`**（不是跳过）。

## 4. 对 v0.2 的撤销/改动清单
- §1.3：状态表改为「写入走 `SECURITY DEFINER` 函数 + 权限断言」；删除「追加台账回执」；有效期 3 小时；闸现场重算+现场重读+落地 URL 核对。
- §1.1/§1.2：新增 `departure_dates[]`、`from_price`、`terms_version`、页面 meta `tour-data-version`、扩大可见文本范围；`copy_clean` 的盲区写明。
- 页面清单来源：只用 `LandingTarget`。
- 迁移清单：新表 `landing_readiness_current`（撤销直接写权限）、函数 `landing_readiness_upsert_v1`、登记表（或沿用 `LandingTarget` 配置，实现设计里定）。

## 5. 未核实 / 待决
- 官网是否便于在页面 `<head>` 放 `tour-data-version`/`terms-version` meta（121 判断）；`from_price` 的规范化口径（币种/千分位）要与官网 `displayPrice` 对齐。
- 3 小时有效期是我的取值，待 74/PM 确认；闸现场重读会让启用多几秒、依赖官网可用——官网故障时开投被拦（方向安全）。
