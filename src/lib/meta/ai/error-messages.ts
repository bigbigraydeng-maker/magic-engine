/** Shared client-facing Chinese copy for Meta Ads AI error codes — used by both the connect/bind
 * screen and the report view, so a code added for one surface reads correctly on the other. */
export const META_ADS_AI_MESSAGES: Record<string,string> = {
  account_unavailable:'该广告账户已绑定到其他客户，或当前无法连接。请联系 Magic Engine 支持。',
  reconnect_required:'Facebook 授权已取消、已过期或未完成，请重新连接 Facebook。',rate_limited:'请求过于频繁，请等待一分钟后重试。',
  permission_required:'Meta 未授予广告数据读取权限，请重新连接并允许读取广告数据。',not_available:'邀请测试暂未开放。',
  provider_unavailable:'暂时无法连接 Meta，请稍后重试。',request_failed:'操作失败，请重试。',
  service_paused:'测试服务目前已暂停。你仍可查看状态、断开连接和停止旧版外部访问。',pilot_required:'该客户尚未获得邀请测试资格。',
  invitation_required:'该客户尚未获得邀请测试资格。',invitation_inactive:'邀请测试资格目前未启用。',invitation_expired:'邀请测试资格已到期。',
  invitation_changed:'本次邀请已经结束。重新受邀后，请重新连接 Facebook 并选择广告账户。',
  connection_owner_required:'请使用最初完成 Facebook 授权的 Magic Engine 账号操作。',disconnect_not_found:'该连接不存在、已被撤销，或不属于当前账号。',
  sponsored_analysis_unavailable:'当前邀请尚未开通免费分析额度，请联系 Magic Engine 支持。',sponsored_budget_exhausted:'本月免费分析预算已用完。',
  analysis_too_large:'当前广告数据量超过邀请测试版上限，请联系 Magic Engine 支持。',analysis_failed:'分析暂时失败，请稍后重试。',
  analysis_incomplete:'本次报告生成时被截断，未保存半份报告。广告数据已保存，请稍后重试。',model_unavailable:'AI 模型暂时无法响应，广告数据已保存。请稍后重试以生成中文报告。',
  authorization_changed:'Facebook 授权或广告账户权限已经变化，请刷新后重试。',
}
