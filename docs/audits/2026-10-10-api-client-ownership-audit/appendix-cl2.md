# 附录 · clients-成员已有守卫-第2组（逐接口明细，原始清查输出）

> 来源：66号窗口只读清查，2026-10-10。路径省略 `src/app/api` 前缀。分类 A=归属守卫已覆盖 B=仅登录 C=无守卫 D=自定义校验 E=仅管理员。

# result_cl2：clients/[id]/** 带守卫函数名的 handler 检查（129 个）

只读检查，未改任何文件、未请求线上。守卫类别：A=归属守卫覆盖；D=另有自定义校验。客户号来源默认=URL 路径 id。表中“OK”行统一理由：守卫用 URL id 且在 requirePaid/Dashboard/OnboardingClientAccess 后所有读写都带 client_id（子记录 cid/itemId/memId/logId 等均按 client_id 联合过滤）。

| 路径 | 方法 | 类别 | 读写删 | 表 | 客户号来源 | 问题/风险(人话) | 严重度 | 谁能打到 | 修法 |
|---|---|---|---|---|---|---|---|---|---|
| /api/clients/[id]/crm/contacts | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/crm/contacts | POST | A | 写 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/crm/contacts/[cid]/dnc | POST | A | 写 | contacts / contact_touchpoints | URL id+cid(已校验归属) | 任何付费成员可撤销“别再联系”标记(有留痕)。合规上敏感(撤销退订)，但属客户自己的数据且有留痕。 | 低(可疑) | ②付费成员 | 可保留；建议要求更高角色或二次确认 |
| /api/clients/[id]/crm/contacts/[cid]/email | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id；子记录已联合校验归属 | OK | — | — |
| /api/clients/[id]/crm/contacts/[cid]/important | PATCH | A | 写 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id；子记录已联合校验归属 | OK | — | — |
| /api/clients/[id]/crm/contacts/[cid]/messenger | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id；子记录已联合校验归属 | OK | — | — |
| /api/clients/[id]/crm/contacts/[cid]/pin | PATCH | A | 写 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id；子记录已联合校验归属 | OK | — | — |
| /api/clients/[id]/crm/contacts/[cid]/segment-feedback | POST | A | 写 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id；子记录已联合校验归属 | OK | — | — |
| /api/clients/[id]/crm/contacts/[cid]/snooze | PATCH | A | 写 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id；子记录已联合校验归属 | OK | — | — |
| /api/clients/[id]/crm/contacts/[cid]/stage | PATCH | A | 写 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id；子记录已联合校验归属 | OK | — | — |
| /api/clients/[id]/crm/contacts/[cid]/timeline | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id；子记录已联合校验归属 | OK | — | — |
| /api/clients/[id]/crm/contacts/[cid]/whatsapp | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id；子记录已联合校验归属 | OK | — | — |
| /api/clients/[id]/crm/today | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/crm/touchpoints | POST | A | 写 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/crm/touchpoints/batch | POST | A | 写 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/diagnostic/baseline | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/diagnostic/latest | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/diagnostic/report | GET | A但子记录没校验 | 读 | diagnostic_runs/diagnostic_narratives | query run_id | 带 ?run_id=他人 run 的UUID 时：run 行(分数、基线等 select *)和 AI 叙述(narratives)只按 runId 读取，不核对 client_id（findings/prescription 倒是按 client_id 过滤，所以只泄一部分）。 | 中 | ②付费成员(需知道对方run_id) | generateReport 内先 select diagnostic_runs where id=runId and client_id=clientId，不匹配就 404；loadNarrativesForRun 也加 client_id |
| /api/clients/[id]/diagnostic/report/docx | GET | A但子记录没校验 | 读 | 同上 | query run_id | 同上，且会生成可下载 Word 报告。 | 中 | ②付费成员(需知道run_id) | 同上(同一个 generateReport 的修法一处解决两个接口) |
| /api/clients/[id]/diagnostic/run | POST | A | 写 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/diagnostic/runs | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/diagnostic/runs/[runId]/status | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id；子记录已联合校验归属 | OK | — | — |
| /api/clients/[id]/diagnostic/runs/[runId]/synthesize | POST | A | 写 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id；子记录已联合校验归属 | OK | — | — |
| /api/clients/[id]/domain | PATCH | A+D | 写 | clients.domain | URL id | 自助成员可改客户网站域名；若新域名有 META_SYSTEM_USER_TOKEN_<域名> 则要求全局管理员(设计得好)。但没限制“把别客户已用的域名”设给自己，也没挡“把已绑定令牌的域名改走”。 | 低 | ②含self_serve | 建议域名唯一性校验；已绑令牌的客户当前域名变更也需全局管理员 |
| /api/clients/[id]/email/conversations/[conversationId]/reply | POST | A | 外发 | conversations/conversation_outbound_log(+Graph发邮件) | URL id；sendMailReply 内核对 convo.client_id | 归属校验在 sendMailReply 内(convo.client_id !== clientId→403)，且有 DNC 闸与审计。付费成员以客户邮箱身份发邮件——设计如此。 | OK | ②付费成员 | — |
| /api/clients/[id]/excluded-topics | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/excluded-topics | PATCH | A | 写 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/execution | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/execution | POST | A | 写 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/execution/[itemId] | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id；子记录已联合校验归属 | OK | — | — |
| /api/clients/[id]/execution/[itemId] | PATCH | A | 写 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id；子记录已联合校验归属 | OK | — | — |
| /api/clients/[id]/execution/[itemId] | DELETE | A | 删 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id；子记录已联合校验归属 | OK | — | — |
| /api/clients/[id]/execution/[itemId]/log | POST | A | 写 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id；子记录已联合校验归属 | OK | — | — |
| /api/clients/[id]/execution/[itemId]/luban | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id；子记录已联合校验归属 | OK | — | — |
| /api/clients/[id]/execution/[itemId]/luban | POST | A | 写 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id；子记录已联合校验归属 | OK | — | — |
| /api/clients/[id]/execution/docx | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/execution/manual | POST | A | 写 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/facebook-page | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/facebook-page | PATCH | A+全局admin | 写 | clients.facebook_page_id | URL id | requireDashboardClientAccess 后再 requireGlobalAdmin，只有内部管理员可改。 | OK | ③ | — |
| /api/clients/[id]/factory-config | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/factory-config | PATCH | A(守卫对,但级别太低) | 写 | clients.factory_config | URL id | 只要是该客户的任何登录成员(含最低档 self_serve)就能改“视频工厂配置”：发布主页(publish_target)、自动排产开关(auto_order_enabled，每天自动花钱出片)、对外价格/电话(verified_offer/verified_cta)、Creatomate 模板。facebook-page 绑定明明限定仅全局管理员，这里却能绕过去改发布目标。 | 高 | ②含self_serve | 改成 requireGlobalAdmin(或至少 requirePaidClientAccess+global admin 才能动 publish_target/auto_order_enabled/verified_*)；GET 可留 Dashboard |
| /api/clients/[id]/flywheel/gsc-attribution | POST | A+D | 写 | flywheel_actions/outcomes | URL id；另需 Bearer INTERNAL_API_KEY | 除付费守卫外还要内部 API key(未配置则 500 fail-closed)，浏览器侧基本调不了；守卫的客户号即实际取数客户号。 | OK | ②+需内部key | — |
| /api/clients/[id]/flywheel/metrics/trend | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/ga4-properties | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/ga4-properties | PATCH | A(onboarding) | 写 | client_connectors | URL id | 校验该客户 Google 令牌对该 property 有权限(verifyGa4PropertyAccess)，所以不能指向别家。 | OK | ②含self_serve(设计如此) | — |
| /api/clients/[id]/ga4/snapshots | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/ga4/sync | POST | A | 写 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/gbp/locations | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/gbp/locations | PATCH | A(admin) | 写 | platform_oauth_connections(location_name) | URL id | tier==="admin"；受限管理员只能改自己客户，且校验“门店已被别客户占用”。 | OK | ③及本客户受限管理员 | — |
| /api/clients/[id]/gbp/reviews | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/geo | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/geo/[directiveId] | PATCH | A但子记录没校验 | 写 | geo_directives | URL directiveId，update 只按 id，没有 client_id | 可改写任意客户的 GEO 指令(主推荐/场景/受众/定位文案)；之后会被生成片段/部署用到客户网站。 | 中 | ②付费成员(需知道对方directiveId) | .update(...).eq(id).eq(client_id, URL id) |
| /api/clients/[id]/geo/[directiveId]/activate | POST | A | 写 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id；子记录已联合校验归属 | OK | — | — |
| /api/clients/[id]/geo/deployments | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/geo/deployments | POST | A | 写 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/geo/generate | POST | A | 写 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/geo/snippet | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/goals | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/goals | POST | A | 写 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/goals/active | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/goals/active-list | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/google-ads-customer-id | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/google-ads-customer-id | PATCH | A(级别低) | 写 | clients.google_ads_customer_id | URL id | 任何成员(含 self_serve)可把自己客户绑定到任意 10 位 Google Ads 账号号码；之后 keyword-ideas、广告自动化都会用 ME 共用凭据读/操作那个账号。对比 meta-ad-account / facebook-page 绑定都限定全局管理员或走“申请”。 | 高 | ②含self_serve | 改为 requireGlobalAdmin(或像 meta-ad-account 那样非员工只记“申请”)；GET 可留 |
| /api/clients/[id]/google-ads/campaigns | GET | A但客户号没绑 | 读 | (Google Ads API，用ME共用MCC凭据) | query 参数 google_ads_customer_id，不是该客户自己的 | 守卫只证明“你是客户A的付费成员”，但要查哪个 Google Ads 账号由请求里的 google_ads_customer_id 决定，且用 ME 共用的开发者令牌+刷新令牌去查：任何付费客户成员可以读到任意其他客户(只要在 ME 的 MCC 下)的广告系列、预算、花费。 | 高 | ②付费成员 | 忽略 query 参数，用 resolveCustomerId(supabaseAdmin, clientId) 取该客户自己的 customer id；传入值必须等于它，否则 403 |
| /api/clients/[id]/google-ads/execute | POST | A但客户号没绑 | 写/花钱 | (Google Ads API)+flywheel_actions | body.google_ads_customer_id + body.campaign_id | 同上：可对任意 Google Ads 账号的任意广告系列执行 暂停/重启/改预算(±20%)/加否定词，全部走 ME 共用凭据；审计记录还会被记到 URL 里的客户名下，事后查不出真正被改的是谁家。 | 高 | ②付费成员 | 用 resolveCustomerId 校验 body.google_ads_customer_id 属于该客户，再校验 campaign 属于该账号；否则 403。建议同时收紧为需要“广告授权” |
| /api/clients/[id]/google-ads/keyword-ideas | POST | A | 写 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/gsc/index-request | POST | A | 外发(调谷歌) | (Google Indexing API) | URL id；body.url 任意网址 | 付费成员可让客户的 Google 令牌对任意 URL 发“请求收录”(谷歌只会对该令牌已验证的站点生效，所以实际影响有限)；另 playbook 记着 Indexing API 对非招聘/直播页属违规用法。 | 低 | ②付费成员 | 校验 url 的主机名属于 clients.domain |
| /api/clients/[id]/gsc/sites | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/gsc/snapshots | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/gsc/sync | POST | A | 写 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/health-score | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/industry | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/industry | PATCH | A | 写 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/initiatives | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/intelligence/insights | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/intelligence/narrative | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/intelligence/summary | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/intelligence/trends | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/knowledge/confirmers | GET | A | 读 | client_knowledge_confirmers | URL id | self_serve 可读确认人邮箱列表(很小的信息)。 | 低 | ②含self_serve | 改 requirePaidClientAccess 或保留 |
| /api/clients/[id]/knowledge/confirmers | POST | A+全局admin | 写 | client_knowledge_confirmers | URL id | isGlobalAdminEmail 校验，仅内部管理员。GET 对 self_serve 开放(只读确认人邮箱，低)。 | OK | ③ | — |
| /api/clients/[id]/knowledge/confirmers | DELETE | A+全局admin | 删(撤销) | client_knowledge_confirmers | URL id | 同上。 | OK | ③ | — |
| /api/clients/[id]/leads-config | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/leads-config | PATCH | A | 写 | clients.leads_config / mailchimp_audience_id | URL id；body.mailchimpAudienceId | 付费成员可把客户的 Mailchimp audience 编号改成任意值(只校验是6-20位十六进制)，meta-lead 入库后会把新线索(客人邮箱/姓名)推到那个 audience；ME 账号下共用，可造成把客户线索灌进别家名单。也能改通知邮箱(客人线索通知发给谁)。 | 中 | ②付费成员 | audience 编号与 notifyEmails 的修改限定全局管理员，或需校验该 audience 在 ME 账号里归属本客户 |
| /api/clients/[id]/light-brief | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/light-brief | POST | A | 写 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/listings | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/listings | POST | A | 写 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/listings/[listingId]/assets | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id；子记录已联合校验归属 | OK | — | — |
| /api/clients/[id]/locale | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/locale | PATCH | A | 写 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/luban | GET | A(级别低) | 读 | luban_project_messages | URL id | self_serve 能读项目鲁班对话历史(通常为空)。 | 低 | ②含self_serve | 同上，改 requirePaidClientAccess |
| /api/clients/[id]/luban | POST | A(级别低) | 写/花钱 | luban_project_messages/execution_items(AI工具会改执行项) | URL id | “项目鲁班”AI 对话用 requireDashboardClientAccess(self_serve 可调)，AI 有工具可批量改执行项状态/标题，且是 Claude 调用费用、未走 MTC 计费；同类的单项鲁班(execution/[itemId]/luban)是 requirePaidClientAccess。 | 中 | ②含self_serve | 改成 requirePaidClientAccess(与 execution/[itemId]/luban 一致)；GET 同改 |
| /api/clients/[id]/marketing-plan | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/marketing-plan/[planId] | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id；子记录已联合校验归属 | OK | — | — |
| /api/clients/[id]/marketing-plan/[planId] | PATCH | A | 写 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id；子记录已联合校验归属 | OK | — | — |
| /api/clients/[id]/marketing-plan/[planId] | DELETE | A但子记录没校验 | 删 | execution_items(先删)→marketing_plans | URL planId，直接传给 revokePlanTasks(planId) | 先调用 revokePlanTasks(planId) 删除该 plan 下所有“待开始”的执行项，此函数不看 client_id；之后才做带 client_id 的归档更新(找不到就报错，但删除已经发生)。付费客户 A 知道客户 B 的 planId(UUID)就能删光 B 的待办执行项。 | 高 | ②付费成员(需知道对方planId) | 先查 marketing_plans WHERE id=planId AND client_id=URL id，查到再 revokePlanTasks；或给 revokePlanTasks 加 clientId 参数并 .eq(client_id) |
| /api/clients/[id]/marketing-plan/[planId]/approve | POST | A | 写 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id；子记录已联合校验归属 | OK | — | — |
| /api/clients/[id]/marketing-plan/generate | POST | A | 写 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/marketing-plan/generate-focus | POST | A | 写 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/memory/[type]/[memId] | PATCH | A | 写 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id；子记录已联合校验归属 | OK | — | — |
| /api/clients/[id]/memory/[type]/[memId] | DELETE | A | 删 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id；子记录已联合校验归属 | OK | — | — |
| /api/clients/[id]/memory/annotate | POST | A | 写 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/memory/export | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/memory/extract | POST | A | 写 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/memory/list | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/messenger-agent/kill-switch | POST | A(admin) | 写 | knowledge/AI 回复开关 | URL id | tier==="admin"：全局管理员或仅绑本客户的受限管理员；受限管理员只能关/开自己那个客户。scoped_admin 没有 API 能写入，只能手工设。 | OK | ③及本客户受限管理员 | — |
| /api/clients/[id]/messenger/conversations | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/messenger/conversations/[conversationId]/drafts | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id；子记录已联合校验归属 | OK | — | — |
| /api/clients/[id]/messenger/conversations/[conversationId]/messages | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id；子记录已联合校验归属 | OK | — | — |
| /api/clients/[id]/messenger/conversations/[conversationId]/reply | POST | A | 外发 | conversation_reply_drafts/conversations(+Messenger发送) | URL id；草稿查询带 client_id+conversation_id | 同上，sendReply 核对 client_id，草稿审批按 client+conversation 过滤且原子条件更新。 | OK | ②付费成员 | — |
| /api/clients/[id]/messenger/unclaimed | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/messenger/unclaimed/claim | POST | A | 写 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/meta-ad-account | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/meta-ad-account | PATCH | 全局admin/申请 | 写 | clients.meta_ad_account_id/绑定申请 | URL id | 先试全局管理员；不是员工则必须是该客户成员，且只“记一条申请”，不会真的绑定。 | OK | ③ 真绑定；②仅提申请 | — |
| /api/clients/[id]/meta-ads/actions | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/meta-ads/boost-post | POST | A | 写 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/meta-ads/draft | POST | A | 写 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/meta-ads/draft-listing | POST | A | 写 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/meta-ads/snapshots | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/meta-ads/sync | POST | A | 写 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/mtc/monthly-spend | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/onboarding/complete | POST | A | 写/花钱 | diagnostic_runs(AI诊断)/clients/fde_work_logs | URL id | 自助成员完成引导时会自动起一次 full 诊断(花数据/AI费用)，靠 onboarding_completed_at 防重；并发两次请求可能起两个。 | 低 | ②含self_serve | 先 stamp 再起诊断(原子 update where onboarding_completed_at is null) |
| /api/clients/[id]/onboarding/status | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/pages/[pageId]/upgrade | POST | A | 写 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id；子记录已联合校验归属 | OK | — | — |
| /api/clients/[id]/pipeline-stages | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/pipeline-stages | PATCH | A | 写 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/pipeline-stages/[stageKey] | DELETE | A | 删 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id；子记录已联合校验归属 | OK | — | — |
| /api/clients/[id]/platform/ga4 | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/platform/ga4 | DELETE | A | 删 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |
| /api/clients/[id]/platform/gbp | GET | A | 读 | — | URL id | OK：守卫用 URL id，取数/写入均带 client_id | OK | — | — |

## 统计
- handler 总数 130；严重度分布 {'高': 5, '中': 5, '低': 5, 'OK': 114, '低(可疑)': 1}；类别分布 {'A': 111, 'A但子记录没校验': 4, 'A+D': 2, 'A+全局admin': 3, 'A(守卫对,但级别太低)': 1, 'A(onboarding)': 1, 'A(admin)': 2, 'A(级别低)': 3, 'A但客户号没绑': 2, '全局admin/申请': 1}

## 可疑但不确定
- crm/contacts/[cid]/dnc：付费成员可撤销“别再联系”，有留痕；若 PM 认为退订合规需更高角色，需决策。
- meta-ads/draft：付费成员可在客户自己的 Meta 广告账户建“暂停的草案”(≤$50/日、≤30天)，body 展开到 AdDraft 但 clientId/pageId 已被覆盖；没发现越权，只是外部写动作。
- meta-ads/sync：用共用 META_SYSTEM_USER_TOKEN + 客户自己的 meta_ad_account_id 取数；若 meta_ad_account_id 被绑错(见 google-ads-customer-id 类问题)会读到别人账户——这里本身 OK。
- meta-ads/sync 的 body.production_package_id 直接写进快照，不核对该 production package 属于本客户(低)。
- memory/annotate：execution_item_id 只存为 source_id，不核对归属(低，只是引用)。
- marketing-plan/generate：body.initiative_id 直接写入新 plan 不核对归属(低)。
- gsc/sync、ga4/sync、diagnostic/run、geo/generate、marketing-plan/generate、memory/extract 都会花第三方/AI 费用，但均已限付费成员或 onboarding；是否要接 MTC 计费未核。
- crm/touchpoints POST、dnc、snooze：clientRef 幂等键由前端给，未核对格式(低)。
- 未读完 crm/today 全文(879 行)，只核了全部 .from/.eq 均带 client_id 并仅有 GET。
