---
id: 2026-10-20-domain-match-at-sign-in-path-judged-owned
title: 「网址属于哪个客户」的判断函数有漏洞：别家网址的路径或参数里带客户域名的「@」会被判成自己家
status: decided
owner: agent
decided_on: 2026-10-20
source: session:ec90bb17
verify_by: 2026-11-10
verify_how: 在 src/lib/clients/domain-match.ts 的 bareHost 里只在「主机部分」（第一个斜杠、问号、井号之前）才剥 @ 前面的用户名；单测覆盖三种写法——路径里带 @、参数里带 @、锚点里带 @——都返回别家的域名而不是客户域名；四个调用方（跨客户审计、CMS 复测、CMS 连接存储、页面优化定位）的现有测试仍全绿
---
2026-10-20 审查 PR 2943 时，审查官实测并经代码核对：整条网址直接喂给 bareHost，会取「最后一个 @ 之后」当主机，所以 https://别家域名/x@客户域名 和 https://别家域名#@客户域名 都被判成「自己家」。
带邮箱的链接（例如参数里的 email）在真实网址里并不罕见；四个调用方里包括自动改客户官网文案的定位（page-optimization/resolve）。
优先级按 §11：频率低 / 闭环关键度中 / 收入关联低 → 有两项低，P3，先记账；改动只有几行，谁下次碰这个文件顺手修。
