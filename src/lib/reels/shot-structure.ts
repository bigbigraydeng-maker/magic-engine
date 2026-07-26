/**
 * 分镜头结构测量 —— 把一条爆款视频量成「可执行的剪辑配方」。
 *
 * 🔴 为什么必须有(2026-07-26 PM 点破):
 * 爆款库已经记了 705 条,却**没有一个结构数字** —— 没有时长、没有镜头数、
 * 没有切点频率、没有文字时间轴。存的全是 "fast cut" / "visual shock" 这类文字描述。
 * 后果:分析 agent 被问「单镜头应该几秒」时只能回答「库里没有这个字段,我不编」,
 * 而 shot-recipes.ts 里那些 3.6 / 2.8 秒**全是手写的猜测**。
 * 记了 705 条爆款,一条都没量过。
 *
 * 🔴 为什么用 ffmpeg 测而不是问模型:
 * 我们缺的正是**真数字**。让 Gemini「看视频估计几秒一刀」等于用猜测替换猜测。
 * 场景切换检测是像素级客观测量,同一个文件跑两次结果一样,可复现、可对账。
 * 模型只负责它擅长的语义部分(画面里是什么、文字写了什么),不负责数数。
 *
 * 本模块是**纯函数**:输入 ffmpeg 的 stderr 文本 + 时长,输出结构。
 * 不碰网络、不碰文件 —— 好测,也便于拿真实样本回归。
 */

/** 场景切换检测阈值。0.3 是常用默认;必须连同结果一起存,否则跨样本数字不可比。 */
export const DEFAULT_SCENE_THRESHOLD = 0.3

export interface ShotSlice {
  /** 该镜头起始秒 */
  start: number
  /** 该镜头时长秒 */
  duration: number
}

export interface CutRhythm {
  /** 中位单镜头时长 —— 比均值抗离群(片尾一个长镜头会把均值拉飞) */
  median_shot_seconds: number
  shortest_shot_seconds: number
  longest_shot_seconds: number
  /** 每秒切几刀 —— 跨不同时长的片子做比较时用这个 */
  cuts_per_second: number
}

export interface ShotRecipe {
  duration_seconds: number
  shot_count: number
  /** 切点时刻(秒),不含 0 */
  cut_times: number[]
  shots: ShotSlice[]
  rhythm: CutRhythm
  /** 开场 3 秒:爆款的生死线,单独拎出来 */
  hook: {
    /** 前 3 秒里有几个镜头 */
    shots_in_first_3s: number
    /** 第一刀落在第几秒(没有切点则为 null) */
    first_cut_at: number | null
  }
  /** 测量口径,必须存:不同阈值测出来的数字不可直接比较 */
  measured_with: { scene_threshold: number; method: 'ffmpeg_scene_detect' }
}

/**
 * 从 ffmpeg `select='gt(scene,X)',showinfo` 的 stderr 里抠出切点时刻。
 *
 * ffmpeg 把 showinfo 写在 stderr,每个命中帧一行,含 `pts_time:12.345`。
 * 容错:行里可能夹杂其他 pts_time(别的滤镜也会打),所以只认 showinfo 那种行。
 */
export function parseSceneTimestamps(stderr: string): number[] {
  const out: number[] = []
  for (const line of stderr.split('\n')) {
    if (!line.includes('Parsed_showinfo')) continue
    const m = line.match(/pts_time:\s*([0-9]+(?:\.[0-9]+)?)/)
    if (!m) continue
    const t = Number(m[1])
    if (Number.isFinite(t) && t >= 0) out.push(t)
  }
  // 去重 + 升序:同一时刻偶尔会打两行
  return Array.from(new Set(out)).sort((a, b) => a - b)
}

/** 保留 2 位小数,避免 jsonb 里全是 3.0333333333 */
const r2 = (n: number) => Math.round(n * 100) / 100

function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * 把「时长 + 切点」组装成分镜头配方。
 *
 * 边界处理(都踩过或可预见):
 * - 无切点 → 整条是一个镜头(这正是我们自己成片的病:24 秒 1 个切点)
 * - 切点落在 0 或 ≥ 时长 → 丢弃(检测器偶尔在首尾帧误报)
 * - 时长 ≤ 0 → 返回空配方,不炸(ffprobe 偶尔取不到时长)
 */
export function buildShotRecipe(params: {
  durationSeconds: number
  cutTimes: number[]
  sceneThreshold?: number
}): ShotRecipe {
  const dur = Number(params.durationSeconds)
  const threshold = params.sceneThreshold ?? DEFAULT_SCENE_THRESHOLD
  const measured_with = { scene_threshold: threshold, method: 'ffmpeg_scene_detect' as const }

  if (!Number.isFinite(dur) || dur <= 0) {
    return {
      duration_seconds: 0, shot_count: 0, cut_times: [], shots: [],
      rhythm: { median_shot_seconds: 0, shortest_shot_seconds: 0, longest_shot_seconds: 0, cuts_per_second: 0 },
      hook: { shots_in_first_3s: 0, first_cut_at: null },
      measured_with,
    }
  }

  // 只保留落在片内的切点(不含首尾)
  const cuts = Array.from(new Set(params.cutTimes.filter((t) => Number.isFinite(t) && t > 0 && t < dur)))
    .sort((a, b) => a - b)
    .map(r2)

  const bounds = [0, ...cuts, r2(dur)]
  const shots: ShotSlice[] = []
  for (let i = 0; i < bounds.length - 1; i++) {
    const d = r2(bounds[i + 1] - bounds[i])
    if (d > 0) shots.push({ start: bounds[i], duration: d })
  }

  const lens = shots.map((s) => s.duration)
  return {
    duration_seconds: r2(dur),
    shot_count: shots.length,
    cut_times: cuts,
    shots,
    rhythm: {
      median_shot_seconds: r2(median(lens)),
      shortest_shot_seconds: lens.length ? r2(Math.min(...lens)) : 0,
      longest_shot_seconds: lens.length ? r2(Math.max(...lens)) : 0,
      cuts_per_second: r2(cuts.length / dur),
    },
    hook: {
      // 前 3 秒里的镜头数 = 落在 3 秒内的切点数 + 1(开头那个镜头)
      shots_in_first_3s: cuts.filter((t) => t < 3).length + 1,
      first_cut_at: cuts.length ? cuts[0] : null,
    },
    measured_with,
  }
}

/**
 * 把一批配方汇总成「这一类爆款该怎么剪」的目标值。
 *
 * 用途:替换 shot-recipes.ts 里手写的猜测时长。
 * 用中位数而不是均值 —— 爆款样本里总有几条 60 秒的长片,均值会被拖偏。
 */
export function summariseRecipes(recipes: ShotRecipe[]): {
  sample_size: number
  median_duration_seconds: number
  median_shot_count: number
  median_shot_seconds: number
  median_cuts_per_second: number
  median_shots_in_first_3s: number
} {
  const usable = recipes.filter((r) => r && r.shot_count > 0)
  return {
    sample_size: usable.length,
    median_duration_seconds: r2(median(usable.map((r) => r.duration_seconds))),
    median_shot_count: r2(median(usable.map((r) => r.shot_count))),
    median_shot_seconds: r2(median(usable.map((r) => r.rhythm.median_shot_seconds))),
    median_cuts_per_second: r2(median(usable.map((r) => r.rhythm.cuts_per_second))),
    median_shots_in_first_3s: r2(median(usable.map((r) => r.hook.shots_in_first_3s))),
  }
}
