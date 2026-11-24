---
id: 2026-11-25-tailor-made-cover-thumbnails-disney
title: 定制行程单换封面改成缩略图点选，上海迪士尼单独一张封面，9 张封面换成 11-16 新下载的照片
status: done
owner: agent
decided_on: 2026-11-25
source: session:b7dcb14a
verify_by: 2026-11-28
verify_how: 上线后用 CTS 后台打开任意一份定制行程单，点「换一张…」看到缩略图网格；选「上海 · 迪士尼城堡」后封面变成城堡图；新建一份路线含 Shanghai Disneyland 的行程，系统自动选的是迪士尼城堡而不是迪士尼+环球拼图
---
CTS 2026-11-25 要求：Tailor Made 页面要一张单独的上海迪士尼封面；所有封面做成缩略图效果；换上最近下载的抓眼球照片。

做了什么：
- 换封面从纯文字下拉框改成缩略图网格（新组件 HeroPicker，缩略图 320×200 单独存在 heroes/thumbs/）。
- 新增封面 shanghai-disneyland（CC0，Riku Lu）；行程写到 Disney / 迪士尼 自动选它；北京环球影城仍用原来的亲子拼图。
- 换成 iStock 11-16 批次新图：桂林（象鼻山）、漓江（竹筏夕阳）、张家界（袁家界峰林）、丽江（古城与雪山）、颐和园石舫、胡同屋顶、大雁塔航拍、西安城墙航拍。来源记在 heroes/CREDITS.json。
- 没动：确认单（Confirmation）那边的封面下拉框仍是文字版。

另：同一窗口先误改了 CTS 官网 /tailor-made 页面（chinatravel 仓本地分支 feat/tailor-made-thumbnails，未推送、不上线）。
