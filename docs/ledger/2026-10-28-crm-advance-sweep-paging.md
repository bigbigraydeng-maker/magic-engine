---
id: 2026-10-28-crm-advance-sweep-paging
title: CRM「新线索自动改已联系」每小时任务只看前 200 个新线索，排在后面的人轮不到
status: decided
owner: pm
decided_on: 2026-10-28
source: session:96dc6edf
verify_by: 2026-10-30
verify_how: 合并后等每小时那一轮跑完，打开 CTS 客人 Yvonne McDiarmid：阶段应是「已联系」；CTS 里「阶段是新线索、系统放进去的、且有人回过邮件或打通过电话」的人应为 0（现在是 34）
---
问题：上线后实测，CTS 有 321 个新线索，那一步每轮只取前 200 个，不满足条件的人永远占着前面，排在后面该改的人轮不到（还剩约 34 位，含 Yvonne McDiarmid）。
修法：按 id 往后翻页，一轮最多翻 5000 人、最多改 200 人。
当场试跑：生产只读查询确认 321 个新线索里仍有 34 位符合条件；合并后第一轮应全部改完，尚未跑。
