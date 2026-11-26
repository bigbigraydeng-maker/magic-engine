---
id: 2026-11-09-new-me-new-customer-cannot-self-serve-bind
title: 新版 ME 里，新客户今天不能自助注册、也不能自助绑定 Meta 和谷歌（PM 11-09 问「假设我是新客户能自助绑定并授权吗」的核实结论）
status: decided
owner: agent
decided_on: 2026-11-09
source: session:ea33d3d4
---
按 magic-engine-platform 代码核实（没有真注册一个新客户去试，因为注册本身是关的）：
1. 注册：app/portal/routers.py 的 SELF_SIGNUP = False（10-30 起），只能被邀请，新客户进不了门。
2. 绑 Facebook / Instagram / WhatsApp：一键跳转授权的做法代码里有（app/oauth/meta.py），但 11-05 起 META_SHARED_APP_ENABLED 默认关闭，改成要客户「关联自己的 Meta 应用」：自己在 developers.facebook.com 建应用、在商务平台建系统用户、生成永不过期令牌、复制应用编号和密钥填进控制台（docs/CUSTOMER-META-APP.md）。普通商家做不到。
3. 绑谷歌搜索后台 / 分析：有授权弹窗，但新版 ME 的谷歌登录应用还在测试状态，11-09 实测 PM 的两个谷歌账号（bigbigraydeng@gmail.com、hello@magicengine.cloud）都被挡（403 access_denied），只有加进测试用户名单才能授权。
结论：今天新客户只能由我们代接（FDE），或客户本人照教程手工填；对「自助试用 → 买额度」这条路是前置硬阻塞，除了注册关着，渠道连接也不通。代码没写 11-05 改成客户自有应用的原因，未核实。
没动：自助注册保持关闭（PM 11-09「先不开」）。
补（PM 追问「自助授权的前置条件是什么？我们公司要完成验证？」，11-09 用 Meta 开发者接口只读查「Magic Engine Portal」应用 3955651258064982）：应用已是上线状态；隐私政策、条款、数据删除链接都在（指向 magicengine.com.au）；公司验证检查项通过（business_verification_passes=true）；可以提交应用审核（can_submit=true）。但从没提交过应用审核（NO_SUBMISSION），没有任何一个权限拿到高级访问——所以现在只有在应用里有角色（管理员/开发者/测试员）的人能授权，陌生客户授权会被拒。联系邮箱 raydeng@workvisas.work 未验证。哪个应用是线上 META_APP_ID 没核实（还有 Magic Engine Connect / Messaging / Magic Engine 三个）；WhatsApp 嵌入式注册是否另需技术提供商资质没核实。谷歌一侧没法查（看不到谷歌云项目），按报错推断应用在「测试」状态，回调域名是 me2.cloud02.top 而不是 magicengine 域名，过验证时可能是个麻烦，未核实。
更正（11-09 晚，PM 让改联系邮箱时看开发者后台页面）：此前写「公司验证已通过」不对。开发者后台「Magic Engine Portal」应用页里，公司验证一栏对应的商务组合「Magic Engine」（编号 1265811139097132）状态是「审核中」。接口里 business_verification_passes=true 只表示「不挡提交应用审核」，不等于公司验证已通过；公司验证最终是否通过、还缺什么，没核实。
已做：Magic Engine Portal 应用联系邮箱 raydeng@workvisas.work → hello@magicengine.cloud，保存成功，接口回读确认；邮箱尚未验证（Meta 会往 hello@ 发验证信，需有人点）。其余 Magic Engine 应用联系邮箱：Messaging 本来就是 hello@magicengine.cloud；Connect 和「Magic Engine」是 bigbigraydeng@gmail.com，没动，等 PM 说。
PM 回「一起改」后：Magic Engine Connect（1867184534115905）和「Magic Engine」（1752513682785923）的联系邮箱也已从 bigbigraydeng@gmail.com 改成 hello@magicengine.cloud，接口回读确认。至此 4 个 Magic Engine 应用的联系邮箱全是 hello@magicengine.cloud，都显示「未验证」，Meta 的验证信要有人去 hello@ 点。
