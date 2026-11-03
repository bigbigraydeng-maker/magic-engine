---
id: 2026-10-29-cts-meta-cycle-generator-sees-original
title: CTS 自动改标题一个月一页没改成，修写文案那一步（先看原文、品牌词不算事实）
status: decided
owner: agent
decided_on: 2026-10-29
source: session:2cd3c621
verify_by: 2026-11-03
verify_how: 合并上线后，11-02 周一那轮标题周循环跑完：CTS 至少 1 页改动不再因 fact_contradiction_detected 被拦并真的上线；打开那一页的线上源码，核对新标题和描述是人话、没丢原文里的具体事实。一页都没上线就先看那轮回执里每页的 skipReason。
---
根因：生成新文案时系统还没读原文；且客户品牌词（如 CTS）被当成必须保留的事实，而品牌语气配置又要求不写品牌后缀。
10-29 当场用真实大模型对三个连续被拦的页面试生成：硬规则和 AI 判官都通过（证据见 PR 正文）。
