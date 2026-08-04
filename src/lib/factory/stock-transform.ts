/**
 * 抓图 → **AI 改图** → 图转视频,这条链的中间那段。
 *
 * PM 反复要求的路径:「抓图,用 ai 改图(防止版权问题),从图再升视频」。
 * 此前**这一步完全不存在** —— 抓来的图要么原样用(别人的作品,有版权风险),
 * 要么根本进不了成片。这个模块补上它。
 *
 * 做什么:把 stock-harvest 抓来的原图交给 gpt-image-1 重绘 —— 同场景、同构图,
 * 但像素全部重新生成 = **衍生创作,不是原图搬运**。产出另存为新的 clip 行,
 * 标 `is_ai_transformed: true`,并用 `derived_from` 指回原图以便溯源。
 *
 * 🔴 红线(evaluate 侧配套执行):**只有改过的图能进 sourceImagePool**。
 * 原图只作为改图的输入留在库里,永远不进成片 —— 这是版权隔离的落点,
 * 不能因为「改图失败了就先用原图顶上」而放宽。
 */

/** 每张原图改一次就够;改多次是重复花钱(gpt-image-1 单张约 $0.04) */
export const TRANSFORM_COST_USD = 0.04

/**
 * 改图指令。
 *
 * 三条硬要求,每条都有事故背景:
 * ① **保留场景与构图** —— 改成另一个地方就失去了「抓这张图」的意义,
 *    而且可能编造出客户根本不去的目的地(踩「绝不编客户业务事实」红线)。
 * ② **保持真实摄影质感** —— 2026-07-26 首测用 "painterly" 出来是金色油画,
 *    放进旅游广告像插画不像实拍,观众一眼觉得假。
 * ③ **不要文字/logo/水印** —— 生成的文字必然是乱码,而且会跟装配层压上去的
 *    字幕和品牌 logo 打架。
 */
export function buildTransformPrompt(params: {
  /** 原图标题(抓取时带的,用于提示场景内容) */
  title?: string | null
  /** 客户风格倾向(creative_profile.look,如 golden_hour) */
  look?: string | null
  /** 场景语义提示(scene_tag 之类) */
  sceneHint?: string | null
}): string {
  const { title, look, sceneHint } = params
  const subject = title?.trim() ? `Subject: ${title.trim().slice(0, 120)}. ` : ''
  const lookLine = look?.trim()
    ? `Grade toward ${look.trim().replace(/_/g, ' ')}. `
    : 'Natural daylight grade. '
  const scene = sceneHint?.trim() ? `${sceneHint.trim()}. ` : ''

  return (
    `Recreate this photograph as an original cinematic travel still. ` +
    `${subject}${scene}` +
    // ① 保场景保构图
    `Keep the same scene, subject placement and camera angle. ` +
    // ② 真实摄影质感,不要插画感
    `Photorealistic, shot on full-frame camera, natural textures, realistic depth of field. ` +
    `${lookLine}` +
    `Not an illustration, not a painting, no oil-paint or watercolour look. ` +
    // ③ 无文字无 logo
    `No text, no letters, no watermark, no logo, no signage with readable words. ` +
    // 竖屏成片用
    `Vertical 9:16 composition with clean space in the upper third for caption overlay.`
  )
}

/** 改图产物的 source_meta(纯函数,便于测) */
export function buildTransformedMeta(params: {
  sourceClipId: string
  sourceUrl: string | null
  prompt: string
  query: string | null
}): Record<string, unknown> {
  return {
    origin: 'stock_transformed',
    // 🔴 版权隔离的证据:这张是 AI 重绘的衍生图,不是抓来的原件
    is_ai_transformed: true,
    is_still_image: true,
    is_real_footage: false,
    // 溯源:出问题能查回是哪张原图、用什么指令改的
    derived_from_clip_id: params.sourceClipId,
    derived_from_url: params.sourceUrl,
    transform_prompt: params.prompt.slice(0, 500),
    query: params.query,
    transformed_at: new Date().toISOString(),
  }
}
