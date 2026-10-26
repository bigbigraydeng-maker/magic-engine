/**
 * 处方「生成中」过久没动，当成中断。
 *
 * 开方在网站进程里后台跑。部署或进程重启会把这一行留在 generating。
 * 跟行程任务的 10 分钟僵尸判断同一档：硬超时是生成 4 分钟 + 自评 1.5 分钟，
 * 10 分钟足够让一次正常开方写完，又不会让死掉的行永远转圈。
 */

export const STALE_GENERATING_MS = 10 * 60 * 1000

export const STALE_GENERATING_MESSAGE =
  '开方中断了，很可能是服务重启导致没写完。请再生成一次。'

export function isStaleGenerating(
  status: string,
  generatedAt: string | null,
  nowMs: number,
): boolean {
  if (status !== 'generating' || !generatedAt) return false
  const started = Date.parse(generatedAt)
  if (!Number.isFinite(started)) return false
  return nowMs - started >= STALE_GENERATING_MS
}
