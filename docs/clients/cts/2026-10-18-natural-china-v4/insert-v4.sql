-- Natural China v4 (replaces cc876dc3): same picture and copy, music swapped to a registered vocal-free track, cuts re-snapped to its beat grid.
-- NOT SUBMITTED. Run only after the worker is upgraded (PM authorization) and PM allows the trial.
insert into content_work_orders (client_id,goal_id,master_brief_id,order_type,angle,angle_source,rationale_one_liner,brief,budget_cap_usd,status)
select client_id,goal_id,master_brief_id,order_type,
 'Natural China v4: price-suspense reel with jade_river_journey (replaces cc876dc3 / founders-at-dawn)',
 jsonb_set(angle_source,'{note}','"v4：只换音乐（jade_river_journey，登记无人声，窗口≤20s）并重新对齐节拍；画面与文案沿用 cc876dc3；只出到待审，不发布；旧 cc876dc3 在 v4 到待审后标 superseded，Facebook 草稿不删"'),
 'Natural China v4：换曲（同曲在主页已公开多条，违反相邻不同曲规则）；其余不变；只存草稿。',
 jsonb_set(jsonb_set(jsonb_set(brief,'{remotion,props,musicFile}','"music/jade_river_journey.mp3"'),'{remotion,props,musicStartSec}','0.1333'),'{remotion,props,beats}','[0.031, 0.94, 1.849, 2.303, 3.212, 4.576, 5.485, 6.849, 7.758, 9.122, 10.031, 10.94, 11.394, 11.849, 12.758, 13.212, 13.667, 14.122, 15.031]'::jsonb),
 budget_cap_usd,'queued'
from content_work_orders where id='cc876dc3-5776-4c3a-becb-4dda36b57137' returning left(id::text,8) id;
