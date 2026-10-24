---
id: 2026-10-21-cts-own-domain-magicengine-cloud
title: 把 magicengine.cloud 登记为 CTS 的「自己人」邮箱域名，PM 的测试联系人（Big Ray Deng 等）不再混进客人名单
status: done
owner: agent
decided_on: 2026-10-21
source: session:96dc6edf
verify_by: 2026-10-24
verify_how: 读 CTS 的 clients.leads_config.own_email_domains 含 magicengine.cloud（已读回确认）；新代码部署后，「Magic Engine 智能」的两张名单里不再出现 hello@magicengine.cloud 的联系人；平铺名单里仍能找到他们
done_on: 2026-10-21
done_ref: commit:c8ea2f4a1
---
PM 回「排除」后执行，只改了这一个键，其他设置读回对比一致。写生产库一处（clients 表一行的设置字段）。
注意：只登记域名不够——「智能」视图原本不看这个设置；同一批改动里补了代码，让自己人域名的联系人不进两张名单（平铺名单不动）。代码上线前，页面表现不变。
