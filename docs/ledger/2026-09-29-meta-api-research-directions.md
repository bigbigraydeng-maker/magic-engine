---
id: 2026-09-29-meta-api-research-directions
title: PM 过了一遍 Meta 开发者平台调研——批 Meta 业务插件(自动化onboard)+内容效果对比测试，弃商品橱窗/广告透明度库
status: decided
owner: pm
decided_on: 2026-09-29
source: session:5b9407a2
verify_by: 2026-10-13
verify_how: "看 docs/registry/platform-candidates.md 或对应设计稿是否已经为「Meta 业务插件」开出一份可执行的方案（含：联系 Meta 代表申请白名单的进度、企业验证②③步骤是否已推进、选哪个『垂直领域』注册）；「内容效果对比测试」是否已排进社媒支柱的待办。两条都还没推进则转 ROADMAP 待认领"
---

扫了 Meta 开发者平台 43 个产品，PM 拍板：
- **深入研究「Meta 业务插件」（Meta Business Extension）**——目标是提升 ME 自动化 onboard 客户的效率，一次弹窗帮商家把公共主页/像素/目录/商务管理平台/广告账户全部连好，不用 ME 逐个对接。**硬门槛**：必须先联系 Meta 代表申请加入白名单才能开发（不是纯自助接口）；前提条件（应用挂在已认证企业名下、拿到高级访问权限）跟 NAL 连接问题那条"开发者申请四级台阶"②③步骤完全复用，不是另起一套。
- **「内容效果对比测试」（Organic A/B Testing API）方向 OK**——官方自带的发帖 A/B 测试工具，排进社媒支柱当候选。
- **弃**：「商品橱窗」（Commerce）、「广告透明度库」（Ad Library API，查证后发现新西兰/澳洲普通商业广告本就不在它的覆盖范围内，名不副实）。
- Messenger / Marketing / WhatsApp 三个官方 API 是 ME 现有 Meta 集成的地基，本轮没查到新的、还没用上的能力。
