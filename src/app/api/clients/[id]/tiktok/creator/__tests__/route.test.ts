// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/auth/client-access',()=>({requireDashboardClientAccess:vi.fn()}))
vi.mock('@/lib/factory/lecture-post',()=>({loadLecturePost:vi.fn()}))
vi.mock('@/lib/factory/publish/tiktok-adapter',()=>({getTikTokCreatorInfo:vi.fn(),humanTikTokError:()=> 'Unavailable'}))
vi.mock('@/lib/tiktok/video-proof',()=>({inspectTikTokVideo:vi.fn()}))
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { loadLecturePost } from '@/lib/factory/lecture-post'
import { getTikTokCreatorInfo } from '@/lib/factory/publish/tiktok-adapter'
import { GET } from '../route'
afterEach(()=>vi.resetAllMocks())
describe('client-scoped creator/video inspection',()=>{
  it('denies unauthorized client before any provider or media read',async()=>{
    vi.mocked(requireDashboardClientAccess).mockResolvedValue({ok:false,error:'Forbidden',status:403})
    const result=await GET(new Request('https://example.com/api?post_id=post'),{params:{id:'other-client'}})
    expect(result.status).toBe(403)
    expect(getTikTokCreatorInfo).not.toHaveBeenCalled()
    expect(loadLecturePost).not.toHaveBeenCalled()
  })
  it('does not query provider when post is not owned by this client',async()=>{
    vi.mocked(requireDashboardClientAccess).mockResolvedValue({ok:true} as Awaited<ReturnType<typeof requireDashboardClientAccess>>)
    vi.mocked(loadLecturePost).mockResolvedValue(null)
    const result=await GET(new Request('https://example.com/api?post_id=other-post'),{params:{id:'client'}})
    expect(loadLecturePost).toHaveBeenCalledWith('client','other-post')
    expect(result.status).toBe(404)
    expect(getTikTokCreatorInfo).not.toHaveBeenCalled()
  })
})
