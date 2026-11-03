import { NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { factoryVideoUrl } from '@/lib/factory/outlets'
import { inspectTikTokVideo } from '@/lib/tiktok/video-proof'
import { validateReview } from '@/lib/tiktok/post-review'
import { getTikTokCreatorInfo, publishToTikTok, checkTikTokStatus, humanTikTokError } from '@/lib/factory/publish/tiktok-adapter'
export const dynamic = 'force-dynamic'
export const maxDuration = 300
interface Submission { status: string; privacy?: string; publishId?: string; accountId?: string; error?: string }
interface Order { id: string; client_id: string; status: string; angle: string; updated_at: string; output: Record<string, unknown> | null }
async function load(clientId: string, orderId: string): Promise<Order | null> {
  const { data, error } = await supabaseAdmin.from('content_work_orders').select('id,client_id,status,angle,updated_at,output').eq('id',orderId).eq('client_id',clientId).single()
  if (error || !data) return null
  return data as Order
}
function video(order: Order) { return factoryVideoUrl(typeof order.output?.video_path === 'string' ? order.output.video_path : '', process.env.NEXT_PUBLIC_SUPABASE_URL!) }
async function save(order: Order, state: Submission, claim = false) {
  const output = {...order.output, tiktok_publish:state}
  // Existing output writers (complete-work-order and Instagram store) explicitly advance
  // updated_at. Follow the same CAS contract; a full output filter can exceed URL limits.
  const previousMs = Date.parse(order.updated_at)
  if (!Number.isFinite(previousMs)) throw new Error('工单版本缺失，请刷新后核对')
  const updatedAt = new Date(Math.max(Date.now(), previousMs + 1)).toISOString()
  let query = supabaseAdmin.from('content_work_orders').update({output,updated_at:updatedAt}).eq('id',order.id).eq('client_id',order.client_id).eq('updated_at',order.updated_at)
  if (claim) query = query.eq('status',order.status)
  const {data,error} = await query.select('id,updated_at')
  if (error || !data?.length) throw new Error('工单已更新或正在发布，请刷新后核对')
  order.output = output
  order.updated_at = data[0].updated_at as string
}
type Context = {params:{id:string;orderId:string}}
export async function GET(req: Request, {params}: Context) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({error:access.error},{status:access.status})
  const order = await load(params.id,params.orderId)
  if (!order || !video(order)) return NextResponse.json({error:'未找到此客户的成片'},{status:404})
  try {
    let submission = order.output?.tiktok_publish as Submission | undefined
    if (submission?.publishId) {
      const status = await checkTikTokStatus(params.id,submission.publishId,submission.accountId)
      submission = {...submission,status:status.status,error:status.detail}
      await save(order,submission)
    }
    const metadata = {videoUrl:video(order),caption:'',title:order.angle,submission:submission ?? null}
    if (new URL(req.url).searchParams.has('info_only')) return NextResponse.json(metadata)
    const creator = await getTikTokCreatorInfo(params.id)
    const videoProof = await inspectTikTokVideo(video(order))
    return NextResponse.json({...metadata,...creator,videoProof},{headers:{'Cache-Control':'no-store'}})
  } catch (e) { return NextResponse.json({error:humanTikTokError(e instanceof Error ? e.message : '')},{status:400}) }
}
export async function POST(req: Request, {params}: Context) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({error:access.error},{status:access.status})
  const order = await load(params.id,params.orderId)
  if (!order || !video(order)) return NextResponse.json({error:'未找到此客户的成片'},{status:404})
  if (!['approved','published','measuring','closed'].includes(order.status)) return NextResponse.json({error:'请先完成成片审核，再发布到 TikTok'},{status:409})
  if (order.output?.tiktok_publish) return NextResponse.json({error:'已有 TikTok 发布记录，请查询原任务，不能重复上传'},{status:409})
  let state: Submission | undefined
  try {
    const body = await req.json()
    const creator = await getTikTokCreatorInfo(params.id)
    const videoProof = await inspectTikTokVideo(video(order))
    const review = validateReview(body.review,{...creator,videoProof},video(order))
    const claimedState = {status:'sending',privacy:review.privacy,accountId:review.accountId}
    await save(order,claimedState,true)
    state = claimedState
    const result = await publishToTikTok({clientId:params.id,videoUrl:video(order),caption:review.caption,privacy:review.privacy,review,
      onInitialized:async (publishId,accountId) => {state = {status:'processing',privacy:review.privacy,publishId,accountId}; await save(order,state)} })
    state = {status:'processing',privacy:review.privacy,publishId:result.publishId,accountId:review.accountId}
    await save(order,state)
    return NextResponse.json({submission:state},{status:202})
  } catch (e) {
    const error = humanTikTokError(e instanceof Error ? e.message : '')
    if (state) await save(order,{...state,error}).catch(()=>{})
    return NextResponse.json({error},{status:400})
  }
}
