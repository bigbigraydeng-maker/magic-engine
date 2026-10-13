---
id: 2026-10-14-payments-row-tint-opacity-fix
title: 付款总览「过期行淡红」实际没显示（样式写成 /8，系统没有这一档，背景是透明）→ 改成 /10
status: done
owner: agent
decided_on: 2026-10-14
done_on: 2026-10-14
done_ref: pr:2567
source: session:1a85e0eb
verify_by: 2026-10-21
verify_how: 登录后打开付款总览，有过期的出发日整行是淡红底；上线前我在 PM 的 Chrome 里量过计算后的背景色是透明
---
外观调整（PR 2561）上线后，在 PM 的 Chrome 里量出过期行背景是透明：Tailwind 的透明度只认固定档位，/8 不在其中。测试只查了类名，没查到。改成 /10 并在上线后再量一次计算后的颜色。全客人页等其它处也有同样的 /8 写法，本次未动（已记在 PR 说明）。
