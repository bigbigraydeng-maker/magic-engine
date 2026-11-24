---
id: 2026-11-25-tailor-made-cover-thumbnails-disney
title: 定制行程单换封面改成缩略图点选，上海迪士尼单独一张封面，8 张封面换成 11-16 新下载的照片
status: done
owner: agent
decided_on: 2026-11-25
done_on: 2026-11-25
done_ref: pr:3941
source: session:b7dcb14a
verify_by: 2026-11-28
verify_how: 上线后用 CTS 后台打开任意一份定制行程单，点「换一张…」看到缩略图网格；选「上海 · 迪士尼城堡」后封面变成城堡图；新建一份路线含 Shanghai Disneyland 的行程，系统自动选的是迪士尼城堡而不是迪士尼+环球拼图
---
CTS 11-25 要求：Tailor Made 页面单独一张上海迪士尼封面、封面做成缩略图效果、换上 11-16 新下载的抓眼球照片。
做了：换封面改成缩略图网格（HeroPicker，小图在 heroes/thumbs/）；新增 shanghai-disneyland 封面（CC0），写到迪士尼自动选它，环球影城仍用拼图。
换成 iStock 新图的 8 张：桂林、漓江、张家界、丽江、颐和园、胡同、大雁塔、西安城墙；来源在 heroes/PHOTO-ATTRIBUTIONS.json。
没动：确认单页面的封面下拉框仍是文字版。另：先误改了 CTS 官网 /tailor-made（chinatravel 本地分支，未推送、不上线）。
