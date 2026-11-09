---
id: 2026-11-03-crm-contacted-needs-human-outbound
title: AI 读对话判阶段时，没有真人联系记录就不许落「已联系 / 已报价」，Facebook 表单自动生成的那句私信不算客人开口
status: decided
owner: pm
decided_on: 2026-11-03
source: session:96dc6edf
verify_by: 2026-11-10
verify_how: 合并后一周内，查 contact_stage_events 里 changed_by 为 ai:conversation-read 且 to_stage 为 contacted 的新增行：每一位都应能在触点或私信里找到真人联系记录；若发现仍有只引用表单自动生成那句话的，回头改判据。历史上被误改的 297 位（其中 89 位库里查不到任何真人联系）不在本卡，另开卡并等 PM 批准才能改线上客人数据。
---
生产 CTS 实测：297 位客人被 AI 读对话改成已联系，依据只是表单提交后平台在私信里自动生成的那句话；其中 89 位在库里查不到任何真人联系（电话没入库的可能存在，不能说没联系）。本卡只改往后，不动历史。
设计背景见 docs/specs/2026-10-30-crm-ai-next-action-design-v0.md 第 9 节与 2026-09-27-crm-contacted-means-a-human-did-it.md。
