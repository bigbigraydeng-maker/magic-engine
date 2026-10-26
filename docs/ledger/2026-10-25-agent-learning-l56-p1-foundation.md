---
id: 2026-10-25-agent-learning-l56-p1-foundation
title: 学习功能第一块地基写完：读专家文章、提炼候选规则、花钱有硬上限，未接线、未上线
status: done
owner: agent
decided_on: 2026-10-25
source: session:0255470c
verify_how: PR 3132 已合并后，在主干跑 npm test -- src/lib/agent-learning 全过且 tsc 退出码 0；试跑脚本 --llm=fake 退出码 0。线上行为不变，所以没有线上指标要看
done_on: 2026-10-25
done_ref: pr:3132
---
PR 3132 已于 2026-10-25 合并进主干（合并提交 720eab540）：只有纯函数、测试和只读试跑脚本，没有迁移、路由、定时任务，没有任何地方引用，线上行为不变。合并前 Codex 与 Claude Code 都已在最终提交 7b752a9be 上通过。
代码已做完并合并；合并后的验证（verify_how 那一条）还没跑。
已另开 PR 跟进：R8/R9（write-lesson 单次写入）；quote 与 authorClaims 的注入检查、契约默认模型名同步、本卡措辞更正。生产首次真实运行前须 Ray 看过试跑输出。
