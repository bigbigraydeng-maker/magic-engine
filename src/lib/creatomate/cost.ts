// Creatomate credit 计费公式的唯一实现处（spec §3.4/§7）。禁止别处重算——魏征在复审里
// 抓出 v1 把官方文档自己没取整的示例数字（37.3）原样抄进了容量测算，这里统一用 Math.ceil。
//
// 来源：creatomate.com/llms/credits.md（2026-09-09 实测抓取）
//   视频 = ⌈width × height × frame_rate × duration(秒) ÷ 100,000,000⌉
//   图片 = 固定 1 credit
//
// Essential 档 $54/月 = 2,000 credits/月（PM 2026-09-09 确认已订阅）。
const ESSENTIAL_MONTHLY_USD = 54
const ESSENTIAL_MONTHLY_CREDITS = 2000
export const USD_PER_CREDIT = ESSENTIAL_MONTHLY_USD / ESSENTIAL_MONTHLY_CREDITS

export function creditsForVideo(width: number, height: number, frameRate: number, durationSec: number): number {
  return Math.ceil((width * height * frameRate * durationSec) / 100_000_000)
}

export function creditsForImage(): number {
  return 1
}

export function creditsToUsd(credits: number): number {
  return credits * USD_PER_CREDIT
}

// 每镜头假定占用的画面时长——跟 scene-assets.ts::prepareOneScene 里 imageToClip() 不传
// durationSec 时的默认值（6 秒，broll-clip.ts）保持一致口径。真实合成时长由模板的转场/
// 静态图停留时间决定，这里给的是**估算**，不是精确值——第二轮复审指出 v1 完全没记这笔钱
// （cost.ts 写了但零调用方，Creatomate credits 恒记 0），有估算好过没有。
const ASSUMED_SCENE_SEC = 6
const DEFAULT_OUTPUT = { width: 1080, height: 1920, frameRate: 30 } as const

/** 估算一次渲染的 Creatomate credits 花费（USD）。维度取模板契约声明值，未声明按
 *  spec 全篇示例口径（1080×1920@30fps）算。 */
export function estimateCreatomateCostUsd(
  contract: { outputWidth?: number; outputHeight?: number; outputFrameRate?: number },
  sceneCount: number,
): number {
  const width = contract.outputWidth ?? DEFAULT_OUTPUT.width
  const height = contract.outputHeight ?? DEFAULT_OUTPUT.height
  const frameRate = contract.outputFrameRate ?? DEFAULT_OUTPUT.frameRate
  const durationSec = Math.max(1, sceneCount) * ASSUMED_SCENE_SEC
  return creditsToUsd(creditsForVideo(width, height, frameRate, durationSec))
}
