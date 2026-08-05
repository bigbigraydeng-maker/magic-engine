// 人像取景 —— 决定竖屏录像裁成「下半屏」时该保留哪一条。
//
// 走过的弯路(都记下来，别再试第三次):
// ① 固定取正中间 → 客户在车里录、脸偏上，成片里脸掉到很低(PM 反馈)
// ② 问视觉模型「脸在画面高度百分之几」→ **它在猜**。同一条录像两次给的值不同，
//    有一次直接回一个可疑的整数 0.500，而实际脸稳定在 0.35 —— 结果构图比①还差。
//    花钱、不稳定、每次结果不一样，这条路作废。
// ③ 现在:确定性默认值 + 客户可调 + 系统记住他的选择。
//    手机自拍/车里录的说话视频，脸几乎都落在画面上三分之一附近，这个默认值比「中间」准得多；
//    真不合适时客户拨一下，之后这个客户就一直按他的来。

// 默认值取中性(0.5),因为不同录像里人在自己镜头里的位置差别很大——
// 车里手持和桌面架机完全不是一个位置。每个客户的实际值存他自己的偏好里,调一次记住。
// 放大 1.2 倍:不放大的话人在画面里偏小、背景占一大片,脸没分量(实测 1.45 会切头)。
export const DEFAULT_FACE_Y = 0.5
export const DEFAULT_ZOOM = 1.2

/**
 * 把脸的中心换算成裁切窗口的起点 y(像素)，并夹在画面内。
 * 脸不放正中间——留头顶空间比留下巴空间重要，所以脸略偏窗口上方(0.42)。
 */
export function bandTopForFace(faceY: number, frameH: number, bandH: number): number {
  const safeFaceY = Math.min(Math.max(faceY, 0), 1)
  const top = safeFaceY * frameH - bandH * 0.42
  return Math.max(0, Math.min(Math.round(top), Math.max(0, frameH - bandH)))
}

/**
 * 这条片该用哪个取景位置:客户调过就用他的，没调过用经验值。
 * 不做自动识别——试过，模型是在猜(见文件头)。
 */
export function resolveFaceY(clientPref: number | null | undefined): number {
  return clientPref && clientPref > 0.1 && clientPref < 0.9 ? clientPref : DEFAULT_FACE_Y
}

/** 人像放大倍数:客户调过就用他的(限 1.0-1.6，再大必切头)。 */
export function resolveZoom(clientPref: number | null | undefined): number {
  return clientPref && clientPref >= 1 && clientPref <= 1.6 ? clientPref : DEFAULT_ZOOM
}
