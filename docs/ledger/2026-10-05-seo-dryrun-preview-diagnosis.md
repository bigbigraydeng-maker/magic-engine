---
id: 2026-10-05-seo-dryrun-preview-diagnosis
title: 试跑预览里直接写明"这页的谷歌搜索词有没有取到"，方便当面确认线上读取是否正常
status: done
owner: agent
decided_on: 2026-10-05
source: session:cdd5dbf9
verify_by: 2026-10-06
verify_how: 合并部署后再用手动试跑入口跑一次只演练，预览每行含"诊断：…｜该页搜索词已取到/没取到"
done_on: 2026-10-05
done_ref: pr:2235
check_note: 线上只演练预览 5 项，仅前 2 项带「诊断：…｜该页搜索词已取到」，其余因每次最多读 3 页而无诊断，未满足「每行含诊断」判据；证据见 evidence/2026-10-05-seo-weekly-list-live-dryrun--2026-10-05.md。保留待验，需改判据为「读到诊断的行都带词状态」或让每项都产出文字后再判 verified
---
线上第一次只演练时发现输出看不出诊断是否真的读到了谷歌数据，补这一行。不改网站、不写库。
