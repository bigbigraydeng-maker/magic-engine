# Meta Ads AI 邀请测试发布与回滚清单

适用范围：Magic Engine Meta Ads AI Connector V0.1 的邀请制测试。V0.1 只读，不包含创建广告、修改预算、暂停、发布、删除、CAPI 写入或 CRM 联系人读取。

当前决定（2026-09-21）：不轮换或使用此前暴露的 Anthropic key，不进行新的模型调用，不生成新报告。Preview 的 `sponsored_analysis_enabled` 必须保持 `false`；生产环境不得应用 migration、配置或部署。本清单只记录代码和测试环境的发布准备。

## 客户看到的流程

普通客户页面固定为：

1. 连接 Facebook；
2. 选择一个广告账户；
3. 生成近 7 天中文报告。

普通客户页面和邀请入口不得展示 MCP、HTTPS、Bearer、API key 或要求客户准备外部 AI 账号。开发者接口保留在内部技术文档和既有后端，不作为邀请客户操作步骤。

## 开放邀请前检查

- [x] Meta OAuth、广告账户 grant、tenant 和 principal 绑定继续复用既有基础设施。
- [x] 广告数据路径只允许 GET，并有广告写模块导入与请求方法测试。
- [x] Preview schema 已应用；生产 schema 未应用。
- [x] Preview 测试客户已完成 Facebook 授权和广告账户绑定。
- [x] 中文客户页、登录页、招募页和隐私页使用同一三步说明。
- [x] 招募页说明邀请额度、只读边界、无成交承诺和退出方式。
- [x] 隐私页说明读取指标、最小汇总数据外发、报告保存和删除方式。
- [x] `sponsored_analysis_enabled=false` 时生成按钮禁用，旧报告仍可查看。
- [ ] 提供稳定 HTTPS 测试域名，并在 Meta App 中登记完全一致的 OAuth callback；临时 Cloudflare URL 不用于邀请客户。
- [ ] 使用真实受邀账号完成稳定测试域名上的登录、Facebook 连接、账户选择、断开和重新连接。
- [ ] 核实 Meta Business Verification、`ads_read` Advanced Access / App Review、Live mode、Data Use Checkup、隐私、数据删除和解除授权 URL。
- [ ] 如果将来恢复新报告，必须先配置一把未暴露的模型密钥，再单独批准开启客户的赞助分析；当前决定下保持关闭。
- [ ] Product Owner 明确批准从候补招募进入真实客户连接；在此之前公开页面只收集候选申请。

## 功能开关

| 控制 | 安全状态 | 作用 |
| --- | --- | --- |
| `META_ADS_AI_ENABLED` | 未设置或 `false` | 阻止新 OAuth、账户发现/绑定和工具读取；保留状态查看与撤销能力。 |
| 客户 entitlement | `paused` / `revoked` / 过期 | 阻止该客户的新动作；终止后重新邀请会更换 revision，旧授权不能自动复活。 |
| `sponsored_analysis_enabled` | `false` | 禁止托管模型调用和新报告生成；连接与已有报告可以继续显示。 |
| `ANTHROPIC_API_KEY` | 空 | 当前要求。不得通过恢复旧值绕过赞助分析开关。 |

只有全局开关、有效邀请、有效连接、有效广告账户 grant 和对应 principal 全部匹配时，Meta 只读操作才可执行。只有额外满足赞助分析开关、预算预留和模型配置时，报告生成才可能执行。

## 回滚顺序

1. 先把受影响客户的 `sponsored_analysis_enabled` 设为 `false`，停止新的付费模型调用。
2. 如需停止全部 Meta 读取，把 `META_ADS_AI_ENABLED` 设为 `false`。
3. 保留新增 schema 和 receipt，不做破坏性 migration 回滚；已有客户仍可查看状态和执行撤销。
4. 对单一客户退出，撤销其 grant 或 connection；如需彻底撤销应用授权，同时指导客户到 Meta“业务集成”中移除 Magic Engine。
5. 不回滚到无法识别 `purpose`、principal、entitlement revision 或 grant revision 的旧应用版本。
6. 核对审计和费用 receipt 后再关闭测试入口；不要删除失败记录来掩盖问题。

## 当前验收证据

- Meta Ads AI 相关 Vitest、隔离 PostgreSQL 边界、migration 重放、RLS / SECURITY DEFINER 不变量和正式构建均已通过；精确数量以 Draft PR #1843 最新描述为准。
- Preview 曾完成真实 CTS Meta 只读读取和一份托管中文报告；当前不重复模型调用。
- 2026-09-21 再次执行 Preview Meta GET-only smoke：连接为 active、purpose 为 `meta_ads_read`、token 未过期、grant 账户与 provider 返回账户一致，币种 NZD、时区 Pacific/Auckland；`sponsored_analysis_enabled=false`，未调用模型。
- 2026-09-21 浏览器复核邀请入口登录页：三步中文说明显示正确，MCP、HTTPS 和 AI 密钥不再出现。当前本地浏览器 session 已过期，因此没有冒用凭据重复登录；完整已登录流程仍列为稳定测试域名门禁。
- 当前测试环境的模型密钥为空，客户赞助分析关闭。
- 生产 Supabase、生产部署和广告写操作均未执行。

## 当前剩余门禁

稳定测试域名、Meta 公共权限核验和真实受邀账号的完整浏览器复测仍未完成。当前可以继续收集候选申请；在这些门禁完成前，不应向种子客户承诺已经可以生成新报告。
