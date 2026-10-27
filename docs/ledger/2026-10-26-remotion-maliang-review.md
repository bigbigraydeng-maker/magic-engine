---
id: 2026-10-26-remotion-maliang-review
title: 模板出片完成后也走马良画面自检
status: decided
owner: agent
decided_on: 2026-10-26
source: doc:docs/sops/2026-10-27-video-factory-template-playbook-v1.0.md
verify_by: 2026-10-28
verify_how: 抽一条模板出片工单，确认 output 里有 maliang_check；没过时工单仍是待审，审片卡片有「马良没过」和原因；抛错或超时时 machine_reviewed 为 false
---
模板出片交付成功后发和 Creatomate 同一条自检事件。裁决写在工单 output.maliang_check，不加字段。
Ray 2026-10-27：马良判没过时工单仍留在审片收件箱，卡片显示「马良没过」和原因，由人通过或打回，不自动改成已驳回。自检过程失败或超时同样留在队列，并标未机器审。
