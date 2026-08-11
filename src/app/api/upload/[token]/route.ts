/**
 * POST /api/upload/[token] — 客户免登录素材上传。
 *
 * 存在理由:客户老板在工地、店员在仓库,拍完随手就传。要求登录 = 没人会用
 * (PM 硬要求「一定要简单:点链接 → 选文件 → 传完」)。
 *
 * 刻意复用既有素材管道,不另起平行系统:文件进 `visual-assets` bucket + `client_assets` 表,
 * 图片由已在跑的 vision-analyzer cron(每 2 分钟一轮)自动打分并给出推荐用法。
 *
 * 鉴权:URL 里的 HMAC 签名令牌(见 lib/uploads/client-upload-token.ts)。
 * 这条链接**只能往这一个客户的素材库写文件** —— 读不到、改不了任何东西。
 *
 * 视频的处理:client_assets.status 的 CHECK 只允许 pending/analyzing/analyzed/error,
 * 加新值要改数据库结构(需 PM 拍板)。所以视频直接落 'analyzed' 并在 vision_metadata
 * 里标明未分析 —— analyzer 只捞 'pending',自然跳过,不会拿视频去调图像接口白烧钱。
 */

import { createHash, randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { uploadSecret, verifyUploadToken } from '@/lib/uploads/client-upload-token'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm']
const MAX_SIZE_BYTES = 200 * 1024 * 1024 // 视频比图片大得多;手机随手拍一段轻松过 50MB
const MAX_FILES_PER_REQUEST = 20         // 防一次糊上来几百个文件把请求拖死
/** 整个请求体上限。必须在读 body 之前用 content-length 拦,否则 formData() 先把它全缓冲了 */
const MAX_REQUEST_BYTES = 400 * 1024 * 1024
const BUCKET = 'visual-assets'

/**
 * 限流：一条链接（＝一个客户）在窗口内最多能传多少个文件。
 *
 * 🔴 2026-08-05 狄仁杰 6c / 魏征 P2-4：这是一条**公开、免登录、链接不过期**的
 * 写入口，而中间件的 matcher 不覆盖 `/api`，全仓也没有限流设施。同为公开写入口的
 * `/api/clients/[id]/leads` 早就有 5 条/60 秒的限流，这里一条都没有。
 *
 * 数值取得宽：中介一次批量传几十张是正常的，卡住真实使用比防住滥用更亏。
 * 拦的是「灌几千张」那种量级。
 */
const RATE_WINDOW_MIN = 10
const RATE_LIMIT_FILES = 300


/**
 * 边读边数,超过上限立刻断流并返回 null。
 *
 * 存在的理由:`content-length` 是客户端说了算的,chunked 请求干脆没有它。
 * 要真挡住 OOM,只能自己数 —— 而且必须在**读的过程中**断,读完再判等于已经吃进内存了。
 *
 * 返回读到的字节(供重建请求体用);超限返回 null。
 */
async function measureBody(
  body: ReadableStream<Uint8Array>,
  limit: number,
): Promise<Uint8Array | null> {
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) { out.set(c, off); off += c.byteLength }
  return out
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const payload = verifyUploadToken(token, uploadSecret())
  // 不区分「令牌错」和「客户不存在」,统一 404:别让人拿这个接口探测客户是否存在
  if (!payload) return NextResponse.json({ error: '链接无效或已失效' }, { status: 404 })
  const { clientId, listingId } = payload

  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('id', clientId)
    .maybeSingle()
  if (!client) return NextResponse.json({ error: '链接无效或已失效' }, { status: 404 })

  // 房源链接：房源必须真实存在**且属于这个客户**。
  // 不校验归属的话，一条链接就能把照片挂到别人的房源上 —— 而且从上传方看
  // 完全成功，问题要等到出广告时才暴露（那时已经在花钱了）。
  if (listingId) {
    const { data: listing } = await supabaseAdmin
      .from('listings')
      .select('id')
      .eq('id', listingId)
      .eq('client_id', clientId)
      .maybeSingle()
    if (!listing) return NextResponse.json({ error: '链接无效或已失效' }, { status: 404 })
  }

  // ⚠️ 必须在 formData() 之前拦:formData() 会把整个请求体读进内存,
  // 20 个 200MB 文件 = 4GB 一次性缓冲,进程直接 OOM —— 之后的大小检查救不了它。
  //
  // 🔴 2026-08-05 狄仁杰 / 魏征同时指出:原来只看 `content-length` 头,而
  // **`Transfer-Encoding: chunked` 的请求根本没有这个头** —— `?? '0'` 让它恒为 0,
  // 检查恒通过。这道闸原来只挡老实的客户端,一条 curl 就能绕过去把实例打到 OOM,
  // 而且这是个公开、免登录、链接不过期的口子。
  //
  // 现在改成**边读边数**:声明了长度就先按声明拦(省一次读),没声明就自己数,
  // 超了立刻断流。两条路都不依赖对方诚实。
  const declaredLength = Number(req.headers.get('content-length') ?? '0')
  if (declaredLength > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: '这一批太大了,请分几次传' }, { status: 413 })
  }
  if (!declaredLength && req.body) {
    const counted = await measureBody(req.body, MAX_REQUEST_BYTES)
    if (counted === null) {
      return NextResponse.json({ error: '这一批太大了,请分几次传' }, { status: 413 })
    }
    // 数完了流也读完了,得用数出来的字节重建请求体给 formData() 用。
    req = new NextRequest(req.url, {
      method: req.method,
      headers: req.headers,
      body: counted.buffer.slice(0, counted.byteLength) as ArrayBuffer,
    })
  }

  // 限流放在读请求体之前 —— 放后面等于已经把内容吃进内存了，防不住什么。
  const rateSince = new Date(Date.now() - RATE_WINDOW_MIN * 60_000).toISOString()
  const { count: recentUploads, error: rateErr } = await supabaseAdmin
    .from('client_assets')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .gte('created_at', rateSince)

  if (rateErr) {
    // 数不出来就放行 —— 跟 leads 同一口径：宁可放过一次可疑上传，
    // 也不因为一次数据库抖动把中介真实的素材挡在门外。但要大声记。
    console.error('[client-upload] 限流计数失败，本次放行:', rateErr.message)
  } else if ((recentUploads ?? 0) >= RATE_LIMIT_FILES) {
    return NextResponse.json(
      { error: `传得太快了，${RATE_WINDOW_MIN} 分钟后再传剩下的` },
      { status: 429 },
    )
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: '上传数据有误,请重试' }, { status: 400 })
  }

  const allFiles = formData.getAll('files') as File[]
  if (allFiles.length === 0) return NextResponse.json({ error: '没有选择文件' }, { status: 400 })

  const files = allFiles.slice(0, MAX_FILES_PER_REQUEST)
  const uploaded: string[] = []
  const errors: string[] = []

  // 超量的必须如实回报。此前是静默 slice 掉 —— 店员一次选 50 张,只存 20 张,
  // 页面还显示「✅ 收到 50 个」,30 张人间蒸发且双方都不知道(三路审查独立命中)。
  if (allFiles.length > MAX_FILES_PER_REQUEST) {
    errors.push(`一次最多传 ${MAX_FILES_PER_REQUEST} 个,后面 ${allFiles.length - MAX_FILES_PER_REQUEST} 个没传,请再点一次继续传`)
  }

  for (const file of files) {
    const isImage = ALLOWED_IMAGE_TYPES.includes(file.type)
    const isVideo = ALLOWED_VIDEO_TYPES.includes(file.type)
    if (!isImage && !isVideo) {
      errors.push(`${file.name}:不支持的文件类型`)
      continue
    }
    if (file.size > MAX_SIZE_BYTES) {
      errors.push(`${file.name}:文件超过 200MB`)
      continue
    }

    try {
      // 扩展名只留字母数字、最多 5 位：原样拼进 key 会造出 `a.b/c` 这种
      // 带斜杠的奇形怪状路径（穿不出客户目录，但脏）。
      const rawExt = file.name.split('.').pop()?.toLowerCase() ?? ''
      const ext = rawExt.replace(/[^a-z0-9]/g, '').slice(0, 5) || (isVideo ? 'mp4' : 'jpg')

      // 🔴 2026-08-05 狄仁杰 6b/6e：
      //   · 路径前缀原来是**明文 client_id**。而 `visual-assets` 桶是公开的 ——
      //     一张素材图的链接外泄（发微信给客户看、贴进交付文档、进 Meta 广告库）
      //     等于 client_id 外泄，而 client_id 是很多历史接口的事实凭据。
      //     现在前缀改成不可逆的哈希：我们自己按 client_id 照样算得出来，
      //     拿到链接的人反推不回去。
      //   · 随机位原来用 `Math.random()` —— V8 的实现由少量输出可恢复内部状态，
      //     而 `Date.now()` 可猜。公开桶下「URL 即读权限」，等于别人素材的路径
      //     理论上可推算。改用密码学随机。
      const prefix = createHash('sha256').update(clientId).digest('hex').slice(0, 16)
      const storagePath = `${prefix}/assets/${randomUUID()}.${ext}`

      const { error: uploadErr } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(storagePath, await file.arrayBuffer(), { contentType: file.type, upsert: false })
      if (uploadErr) throw uploadErr

      const { data: { publicUrl } } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(storagePath)

      const { error: dbErr } = await supabaseAdmin.from('client_assets').insert({
        client_id: clientId,
        // 归到哪套房 —— 由链接决定，不由上传的人选，也不靠后台事后归类。
        // 地产的营销单位是一套房：没有这一列，83 张照片全是「Roman 的」，
        // 出广告时没人知道该拿哪一张。
        listing_id: listingId ?? null,
        storage_url: publicUrl,
        original_filename: file.name,
        file_size_bytes: file.size,
        mime_type: file.type,
        // 图片交给 analyzer;视频标 analyzed 让它跳过(见头注)
        status: isVideo ? 'analyzed' : 'pending',
        // 上传链接可无限转发,客户完全可能传网图进来 —— 一律「未核实」。
        // 要打真价必须由 FDE 逐张确认升成 client_verified,那一步带审计记录。
        source: 'client_provided',
        ownership: 'client_exclusive',
        vision_metadata: {
          // 溯源:记录「从哪条通道进来的」。**注意它的可信度上限就是通道本身** ——
          // 链接可无限转发,客户完全可能把网图或 AI 生成图从这里传进来。
          // 所以它是「客户主动提供」的证据,**不等于「真实拍摄」**,别拿它直接当
          // 「真价只配真画面」那条红线的判据(目前也确实还没有代码消费它)。
          source: 'client_upload_link',
          uploaded_at: new Date().toISOString(),
          ...(isVideo ? { kind: 'video', analyzed: false, note: '视频未做画面分析' } : { kind: 'image' }),
        },
      })
      if (dbErr) throw dbErr
      uploaded.push(file.name)
    } catch (err) {
      // 对外只说失败,不回显内部错误细节(这是公开接口)
      console.error(`[client-upload] ${clientId} ${file.name}:`, err instanceof Error ? err.message : err)
      errors.push(`${file.name}:上传失败,请重试`)
    }
  }

  return NextResponse.json(
    { ok: uploaded.length > 0, uploaded_count: uploaded.length, errors },
    { status: uploaded.length > 0 ? 201 : 400 },
  )
}
