---
id: 2026-10-10-viral-references-log-check-after-fix
title: 爆款库接口修好上线后，查服务器日志有没有外部人用过这个漏洞
status: decided
owner: pm
decided_on: 2026-10-10
source: session:34af475f
verify_by: 2026-10-13
verify_how: 修复 PR 2432 合并上线后，查日志里 viral-references 那组接口有没有非内部来源的写入请求；有可疑就换全部密钥。需要 PM 先给日志访问权限
---
修复在 PR 2432（草稿，A 级，等三位审查和 PM 回「合」）。漏洞上线前已敞开一段时间，本窗口只读了代码，没看过日志。
库里现有数据已只读查过，没有可疑网址。
