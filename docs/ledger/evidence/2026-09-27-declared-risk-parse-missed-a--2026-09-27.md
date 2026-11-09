# 证据 · 2026-09-27-declared-risk-parse-missed-a · 2026-09-27
fetched_at: 2026-09-27T23:19:19+13:00
查了什么：#2121 合并后（main a6def71c），在草稿探测 PR #2130（只改 src/lib/crm/contact-model.ts 一行注释，按文件算 B）上逐一换正文，看主干 Risk gate 的判级。每次改正文后等这一次运行结束再改下一次，一次运行对应一种写法。
数字（带样本量、两边取数状态）：
- 「## 风险级」+ 空行 +「**A 级**」（照抄 #2075）→ A，理由「PR 自报 A 级，高于 diff 算出的 B 级」（run 36312007442，取数成功）
- 「风险级：A」（照抄 #2061）→ A，同上（run 36312036324，取数成功）
- 「风险级别：见下表」→ A，理由点名这一行「读不懂…按 A 处理」（run 36312060287，取数成功）
- 另测「风险级别为 A」→ A（首次开 PR 时 github-actions[bot] 的判级评论，取数成功）
- 共 4/4 符合 verify_how 预期。
来源/命令：gh pr edit 2130 --body …；gh run list --workflow pr-risk-gate.yml --branch feat/probe-2121-declared；gh run view <run> --log | grep 合并闸/自报/读不懂。结果评论见 PR #2121。
结论：成——两种出过事故的写法和读不懂的写法，在主干上都判 A。
