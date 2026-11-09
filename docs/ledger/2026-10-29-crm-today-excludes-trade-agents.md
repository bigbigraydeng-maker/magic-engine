---
id: 2026-10-29-crm-today-excludes-trade-agents
title: CRM「今天先联系」没有把同行（旅行社）排除，同行名单只对「全部客人」的筛选生效
status: decided
owner: pm
decided_on: 2026-10-29
source: session:96dc6edf
verify_by: 2026-10-31
verify_how: 打开 CTS「今天先联系」：同行域名名单里的人（如 Melissa Dodson，envoyage.co.nz）不在「等你回 / 排队」里，而在「先放着」，原因写「同行（旅行社 / 分销），不在今天要联系的散客名单里」；「全部客人」点「🤝 同行」仍能筛出他们
---
PM 2026-10-29 发现 Melissa Dodson 是同行，却出现在今天先联系里。查实：同行域名清单原来只用于「全部客人」的同行/终端客户筛选，「今天先联系」分段视图根本没读它（只排除了自己人）；另外她的公司域名 envoyage.co.nz 也没登记，已手动补进 CTS 同行清单。
修法：今天先联系把同行挪到先放着并写明原因，只挪不删。
当场试跑：生产库已补域名；单元测试（含路由接线）全过，手工变异均被抓到；上线后真实页面尚未看。
