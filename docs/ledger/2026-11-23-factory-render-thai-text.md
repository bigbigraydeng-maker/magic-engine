---
id: 2026-11-23-factory-render-thai-text
title: 视频工厂出片机能正确显示泰文了：泰文用 Kanit 字体、标题按泰文词语换行，不再把声调符号拆到下一行
status: done
owner: agent
decided_on: 2026-11-23
source: doc:docs/clients/pj-international/2026-11-23-thai-content-generation-assessment.md
verify_by: 2026-12-07
verify_how: 出片电脑更新到含本改动的版本后，第一条带泰文标题的成片逐帧看开头大字和片尾按钮：泰文是 Kanit 字体、没有方块、没有行首孤立的声调符号、换行落在词与词之间；没有泰文工单就写「判不了」，不算成
done_on: 2026-11-23
done_ref: commit:4a42b428b82f5be6b5af80b276aebd5068707f17
---
PM 2026-11-23 回「修」。只修了字体和标题换行；泰语配音、泰语听写字幕仍写死中文，没在这次修。
本机真渲染 3 帧（开头大字 ×2、片尾按钮）已自检通过；出片电脑还没更新，所以仍是 done 不是 verified。
