// 下载 Creatomate 渲染产物前先做域名白名单校验（spec §4.4/§6.1）——魏征在复审里指出
// v1 完全没提这一步：Creatomate 结果 url 来自外部（webhook 或 API 响应），下载前必须
// 校验，不能直接信任外部给的地址（复用 safe-remote-fetch.ts 现成的 SSRF 防护模式，
// 同等级别，不另起一套）。产物 30 天后过期（spec §3.1），拿到就必须立刻转存。
import { safeProbeRemoteFile } from '@/lib/factory/safe-remote-fetch'
import { uploadFromUrl } from '@/lib/visual/storage'

// 2026-09-13 实测更正：v1 猜测产物从 cdn.creatomate.com 出，实际 Creatomate 把渲染产物
// 存在 Backblaze B2（真实生产渲染返回 f002.backblazeb2.com，首次真实渲染验证时发现）。
// B2 按存储桶分配到不同编号的节点（f000/f001/f002…），先按已观测到的加，不是猜的全集——
// 后续换节点报同一个"域名不在白名单"错误时，把新出现的 fXXX.backblazeb2.com 加进来。
const CREATOMATE_ALLOWED_HOSTS = [
  'api.creatomate.com',
  'cdn.creatomate.com',
  'f002.backblazeb2.com',
] as const

export async function storeCreatomateResult(params: {
  resultUrl: string
  clientId: string
  jobId: string
}): Promise<{ storageUrl: string; fileSizeKb: number }> {
  const { resultUrl, clientId, jobId } = params

  const probe = await safeProbeRemoteFile(resultUrl, 20000, CREATOMATE_ALLOWED_HOSTS)
  if (!probe.ok || !probe.finalUrl) {
    throw new Error(`Creatomate 产物链接校验失败：${probe.error ?? '未知原因'}`)
  }

  const { storage_url, file_size_kb } = await uploadFromUrl({
    sourceUrl: probe.finalUrl,
    clientId,
    assetType: 'video',
    folder: `creatomate/${jobId}`,
  })
  return { storageUrl: storage_url, fileSizeKb: file_size_kb }
}
