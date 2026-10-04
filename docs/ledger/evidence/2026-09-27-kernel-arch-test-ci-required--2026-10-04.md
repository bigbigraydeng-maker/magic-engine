# 证据 · 2026-09-27-kernel-arch-test-ci-required · 2026-10-04
fetched_at: 2026-10-04T21:34+1300
查了什么：同上规则集与 PR 2219 必过检查。
数字（样本=1 个规则集 + PR 2219）：gh api repos/bigbigraydeng-maker/magic-engine/rulesets/20550157：required_status_checks 含 ai-orchestrator-tests / Ledger entries valid / Code change has ledger entry / Ledger refs exist / ops-review-loop-tests / Kernel architecture test / Application build（均 integration_id 15368），bypass_actors 字段存在且为 []；gh pr checks 2219 --required（2026-10-04 07:51Z 合并的主干 PR）里 Application build、Kernel architecture test 均有结论 pass。 补查：同一规则集 rules 类型回读为 deletion / non_fast_forward / pull_request / required_status_checks，四条均在。
来源/命令：gh api ...rulesets/20550157；gh pr checks 2219 --required
结论：成（核心两条：Kernel architecture test 已必过且接上、bypass_actors=[]）；deletion / non_fast_forward / pull_request 三条规则也已回读确认仍在。
