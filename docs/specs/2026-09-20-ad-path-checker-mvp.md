# 广告到询盘体检器 · 免费公开入口

Ray 已确认设计并于 2026-09-20 指示开始。Figma: https://www.figma.com/design/DMunfGb0xovDOxpP1O4K6y?node-id=2-25

## 合同

- Remote fetched at 2026-09-19T16:37:46Z; origin/main `bd2d92515144c9dd44b8b61297f32023a23c254e`。
- 一个 writer / worktree / branch / draft PR。复用现有 Ads / 网站诊断能力、L3 `safeFetchText` 和追踪检测器；CTS 只是验收 URL，不进入规则。
- 风险 B：现有安全读取边界内的只读报告；SSRF 按专项安全验收，若需修改安全核心重新定级。
- 输入网站，可选 Facebook 链接。中文桌面 / 手机首页、真实等待、报告、证据、重试、明确标注的示例。
- 只读取公开 HTML 及有界同源脚本，不执行网页脚本，不提交表单、不调用付费模型 / provider、不写数据库。
- 最多一个输入页、一个联系页、三个脚本、一条 Facebook 公开链接。每项限制 DNS、请求时间、跳转、解码后的响应字节。沿用逐跳 DNS 全地址验证及 socket pinning。
- 输出只含结构摘要、追踪代码编号、已过滤的来源 URL；不返回正文、表单值、邮箱电话具体内容或异常原文。
- 浏览器运行、真实广告点击目的地、平台表单、内容匹配、CAPI、真人/询盘质量无法证实时必须明确 unknown。多个 Pixel 不直接判错。
- 无注册、分数、OAuth、CAPI 写入、数据库迁移、部署或生产配置变更。

## 验证与停止

安全 URL / 私网 / 重定向 / 超时 / 大响应 / 隐私 fixture；核心报告与 API 测试；既有 safe-fetch（含真实本地 socket）回归；type / lint / build；CTS 公开页桌面与手机 proof。
一次集中独立 review、一次集中 remediation。满足 Ray 可重复输入→扫描→中文报告就停止；普通 P2 延期。

## 发布边界

扫描 API 默认关闭，通过服务器 `AD_PATH_CHECKER_ENABLED=true` 才启用。当前只在本地开启。进程内全局并发/频率限制用于 MVP；公开多实例上线前须配置网关级限流并由 Ray 单独批准部署。不是部署完成状态。
