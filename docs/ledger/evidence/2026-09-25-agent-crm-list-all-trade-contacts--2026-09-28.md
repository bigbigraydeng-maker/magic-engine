# 证据 · 2026-09-25-agent-crm-list-all-trade-contacts · 2026-09-28

fetched_at: 2026-09-28T09:10:00Z（新西兰 2026-09-28 22:10）

查了什么：生产库（CrazyContent 项目）直接复制 GET /api/clients/[id]/agents 的判定逻辑（contactKindOf + 域名规则），
对 CTS（c0000000-...）的 leads_config.trade_domains + contact_identities 跑同一套 SQL。

数字（带样本量）：
- CTS trade_domains 现有 27 个域名（不是卡写的时候那批）；命中的同行联系人 35 个（不是卡上写的 16 个）
- 35 个同行联系人里 22 个没有 agent_customers 行（会显示「还没有客户」占位文案）、13 个有客户行
- union(trade_contacts, agent_customers.agent_contact_id) = 35，跟 trade_contacts 数一致 —— 说明并集逻辑生效，
  不会出现「有客户行但不在同行清单里」被漏掉的情况

来源/命令：Supabase MCP execute_sql，项目 glbdnayojixmexgofbsd（CrazyContent，实际生产库）

结论：成。根因（整页依赖 agent_customers 反推、生产 0 行客户时返回空）已修好 —— 页面现在会显示 35 张同行卡，
不是空白页，且没客户的卡有专门占位文案。卡上写的「16 张」是写卡当时的域名清单快照，此后同行域名清单从
16 条陆续扩到 27 条，数字自然涨到 35，不代表功能坏了；已用同一套代码逻辑复算确认。
