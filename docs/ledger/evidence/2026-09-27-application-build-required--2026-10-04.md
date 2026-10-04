# 证据 · 2026-09-27-application-build-required · 2026-10-04
fetched_at: 2026-10-04T21:34+1300
查了什么：必过清单与 bypass_actors，以及最近合并 PR 的必过检查。
数字（样本=1 个规则集 + PR 2219，两边取数均成功）：gh api repos/bigbigraydeng-maker/magic-engine/rulesets/20550157：required_status_checks 含 ai-orchestrator-tests / Ledger entries valid / Code change has ledger entry / Ledger refs exist / ops-review-loop-tests / Kernel architecture test / Application build（均 integration_id 15368），bypass_actors 字段存在且为 []；gh pr checks 2219 --required（2026-10-04 07:51Z 合并的主干 PR）里 Application build、Kernel architecture test 均有结论 pass。
来源/命令：gh api ...rulesets/20550157；gh pr checks 2219 --required
结论：成。Application build 已在必过清单且有结论，原有各道仍在，无绕过名单。
