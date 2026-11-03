---
id: 2026-11-03-me-factory-variant-order-entry
title: ME 视频工厂页能直接下单做一条视频变体（照已有视频只改开场字或配乐），只到待审不发布
status: done
owner: agent
decided_on: 2026-11-03
done_on: 2026-11-03
done_ref: pr:3556
source: session:90a50c3b
verify_by: 2026-11-10
verify_how: 合并上线后，在 content_work_orders 查 angle_source->>source = 'me_variant_order' 且 ordered_by 不是 claude-74-trial 的单：①至少有一单是 PM 从后台页面下的；②这些单没有一张卡在 dead_letter，卡了就看 reject_reason（「乐库里找不到音乐文件」= 出片机本机镜像又缺曲子，先查 ~/Library/Application Support/magicengine/studio/Music）；③没有一张被自动发布（status 只能是 queued/claimed/producing/in_review 或 PM 自己审过的状态）。一单都没人下就回 PM 问是不是入口不好找。
---
PM 2026-11-03 说「我需要在 ME 内发布指令，制作视频」，再说「整合 ME 后台内视频工厂、生成单条内容和内容工厂的功能」，回「开始」。

本次只做第一步：视频工厂页的「下单做一条视频（照已有视频改一样）」。内容工厂卡片上的「生成视频」按钮没做——内容工厂（content_posts）和视频工厂（content_work_orders）是两条出片线，成片回哪张卡要先定，单独做。

当场试跑：用正式库下了一单（2a423cdf，上海明信片款换配乐 horizons-call），出片机前两次因本机镜像缺曲库 Music 文件夹那 12 首而失败，补铺后出片成功到待审，马良看图 pass。

已知限制：清单款视频（现在投的 winner 那种）系统不给换配乐，因为剪辑点卡在原配乐节拍上，曲库里没有既测过节拍又过人声核验的曲子；这类只能改开场字。
