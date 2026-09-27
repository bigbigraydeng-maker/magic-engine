---
id: 2026-09-27-outward-write-gate-blind-spots
title: 「对外写必须经过内核」这道检查还有看不见的路：换成认得所有 import 写法的扫描器，并把 seo-fix 那条直接改客户网站的路登记或迁走
status: decided
owner: agent
decided_on: 2026-09-27
source: session:d1add426
verify_by: 2026-10-11
verify_how: 三条都在主干上成立才算成。①architecture.test.ts 的对外写 importer 检查改用同文件里的 scanModuleReferences / canonicalSpecifier（认得 import()、require、相对路径、src/ 开头、点段、import 类型引用），且 tsconfig.json 的 paths 别名被钉住（多一个别名测试就红）；②src/lib/cms/seo-fix-orchestrator.ts 要么出现在对外写豁免清单里，要么不再直接用 github-client 和 meta-patcher；③路径含 /__tests__/ 的非测试文件不再被 importer 检查整个跳过
---
来自 PR 2079 子牙、魏征复审。本卡只管上面三条；其余盲区写在 PR 2079 的「已知盲区」里：拿豁免文件当中转（例如三处在调 scheduleSocialPost）、在 capabilities 里包一层两跳绕过、不经那 10 个模块直接 fetch 写外部接口、把豁免文件登记成「模块」换个名义免检。
换成扫描器之后，再加「文件不再 import 对外写模块就逼删条目」那条；现在加会把改成盲区写法的文件洗白。
