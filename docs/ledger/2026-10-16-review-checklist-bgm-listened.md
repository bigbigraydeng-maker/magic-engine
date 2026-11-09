---
id: 2026-10-16-review-checklist-bgm-listened
title: 审片清单加一项「我已开声音听过，背景音乐里没有人声」，PM 点通过才真算听过
status: decided
owner: agent
decided_on: 2026-10-16
source: session:ec90bb17
verify_by: 2026-10-23
verify_how: 合并后在审片页打开一条在审片：一键通过面板必须先勾「已开声音听过」才能点通过；展开逐项里「全部标为通过」不会替你勾这一项；通过后库里 review_ref.checklist_human 含 bgm_listened_no_vocals=PASS；老的已通过未发布单（9 项清单）仍能正常发布。
---
背景：Tale 三条带着地产人声被人审通过，说明「点通过」不等于「听过声音」。本卡是人声闸（PR 2718）之外的人这一侧：新通过的单必须带这一项；老的 9 项回执继续有效（humanKeysForStored）。
