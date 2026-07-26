-- 爆款库补「分镜头配方」字段 [P21.J]
--
-- 为什么:库里已有 705 条爆款,却**没有一个结构数字** —— 无时长、无镜头数、
-- 无切点频率。存的全是 "fast cut" / "visual shock" 这类文字描述。
-- 后果:被问「单镜头应该几秒」时答不出来,而 shot-recipes.ts 里的 3.6 / 2.8 秒
-- 全是手写猜测。记了 705 条爆款,一条都没量过。
--
-- 存 jsonb 而不是拆成 8 个列:结构会演进(以后要加文字时间轴、音频节拍),
-- 每次演进都开 migration 不划算;而且这是分析产物,不做关系查询。
-- 需要按数字筛选时用表达式索引(见下方 median_shot_seconds 的例子)。
--
-- 内容形状(shot-structure.ts 的 ShotRecipe):
--   { duration_seconds, shot_count, cut_times[], shots[{start,duration}],
--     rhythm:{median_shot_seconds, shortest, longest, cuts_per_second},
--     hook:{shots_in_first_3s, first_cut_at},
--     measured_with:{scene_threshold, method} }
-- 测量失败时存 { error, measured_at } —— 区分「没量过(null)」和「量过但失败」。

ALTER TABLE viral_reference_library
  ADD COLUMN IF NOT EXISTS shot_recipe jsonb;

COMMENT ON COLUMN viral_reference_library.shot_recipe IS
  'ffmpeg 实测的分镜头结构(镜头数/切点/节奏/开场)。null=未测量;含 error 键=测量失败。measured_with 记录测量口径,不同阈值的数字不可直接比较。';

-- 常用筛选:找出「已量到结构」的样本做汇总
CREATE INDEX IF NOT EXISTS idx_viral_ref_measured
  ON viral_reference_library ((shot_recipe -> 'rhythm' ->> 'median_shot_seconds'))
  WHERE shot_recipe IS NOT NULL AND shot_recipe ? 'rhythm';
