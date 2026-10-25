---
id: 2026-10-18-ci-docs-only-skip-118
title: 只改文档的 PR 不再跑类型检查和构建（任务内早退，必过检查照常成功）以省 GitHub 分钟
status: done
owner: pm
decided_on: 2026-10-18
source: pr:2826
verify_by: 2026-10-22
verify_how: GitHub 账单恢复后：开一个只改一行文档的 PR，三个必过检查（CRM focused tests / Type-check / Application build）为绿且步骤摘要写 docs_only=true、记录步骤写 SKIPPED；再看本 PR 自身（含代码）摘要为 docs_only=false 且全套照跑。一周后对比文档 PR 的计费分钟是否下降
done_on: 2026-10-18
done_ref: pr:2826
---
PM 10-18 回「做，节省开支」；统筹 18 号安排；A 级草稿 PR，待子牙+魏征审（已审）与 PM 本人回「合 2826」。
账单故障期间无法当场试跑，恢复后必须补两次试跑才能说可上线。设计与估算见 docs/specs/2026-10-18-ci-cost-reduction-design.md。
