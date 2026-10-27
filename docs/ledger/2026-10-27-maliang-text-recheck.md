---
id: 2026-10-27-maliang-text-recheck
title: 马良文字检查先忽略大小写和换行
status: done
owner: agent
decided_on: 2026-10-27
source: doc:docs/sops/2026-10-27-video-factory-template-playbook-v1.0.md
verify_by: 2026-10-29
verify_how: 用一条画面里已经有完整句子、模型却说少了一个词的片子跑文字复核，结果改判过关并写「已复核为模型误报」。句子真的少了词仍然标「马良没过」，留在审片收件箱，不自动驳回。
done_on: 2026-10-27
done_ref: pr:3337
---

比对前把大小写、空格和换行收成同一种写法。只有文字这一项没过、而且画面文字对得上工单原文时，才改判。工单原文按场景地点和句子整句保存，不截断。
