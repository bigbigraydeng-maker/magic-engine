import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
const mocks=vi.hoisted(()=>({copy:vi.fn(),inspect:vi.fn(),publicUrl:vi.fn()}))
vi.mock('@/lib/supabase',()=>({supabaseAdmin:{storage:{from:()=>({copy:mocks.copy,getPublicUrl:mocks.publicUrl})}}}))
vi.mock('./video-proof',()=>({inspectTikTokVideo:mocks.inspect}))
import {snapshotReviewedTikTokVideo,storedTikTokSourcePath} from './publish-source'
const origin='https://project.supabase.co/storage/v1/object/public/content-factory/'
const source=origin+'renders/client/order/final.mp4';const hash='a'.repeat(64)
beforeEach(()=>{vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://project.supabase.co');mocks.publicUrl.mockReset().mockImplementation((path:string)=>({data:{publicUrl:`https://project.supabase.co/storage/v1/object/public/content-factory/${path}`}}));mocks.copy.mockReset().mockResolvedValue({error:null});mocks.inspect.mockReset().mockResolvedValue({sha256:hash,durationSeconds:12})})
afterEach(()=>vi.unstubAllEnvs())
describe('client-bound pull source',()=>{
  it('rejects drift in generated public URLs before inspecting or sending media',async()=>{mocks.publicUrl.mockReturnValue({data:{publicUrl:'https://other.example.com/video.mp4'}});await expect(snapshotReviewedTikTokVideo(source,'client',hash)).rejects.toThrow('已验证');expect(mocks.inspect).not.toHaveBeenCalled()})
  it('accepts own factory and lecture render paths',()=>{expect(storedTikTokSourcePath(source,'client')).toBe('renders/client/order/final.mp4');expect(storedTikTokSourcePath(origin+'client/render/job/final.mp4','client')).toBe('client/render/job/final.mp4')})
  it.each([source.replace('project.supabase.co','other.example.com'),source.replace('/client/','/other/'),source+'?token=x',source+'#fragment',source.replace('/public/','/sign/'),source.replace('/order/','/%2Forder/'),source.replace('https:','http:'),source.replace('https://','https://user:password@')])('rejects unauthorized or ambiguous source %s',url=>expect(()=>storedTikTokSourcePath(url,'client')).toThrow())
  it('copies without overwrite into the verified publication prefix and checks destination bytes',async()=>{const url=await snapshotReviewedTikTokVideo(source,'client',hash);expect(url).toBe(origin+`tiktok-publish/client/${hash}.mp4`);expect(mocks.copy).toHaveBeenCalledWith('renders/client/order/final.mp4',`tiktok-publish/client/${hash}.mp4`);expect(mocks.inspect).toHaveBeenCalledWith(url)})
  it('reuses only a verified existing hash object on explicit conflict',async()=>{mocks.copy.mockResolvedValue({error:{statusCode:'409'}});await expect(snapshotReviewedTikTokVideo(source,'client',hash)).resolves.toContain(hash);expect(mocks.inspect).toHaveBeenCalledTimes(1)})
  it('stops on storage errors rather than pretending an object exists',async()=>{mocks.copy.mockResolvedValue({error:{statusCode:'500'}});await expect(snapshotReviewedTikTokVideo(source,'client',hash)).rejects.toThrow('副本');expect(mocks.inspect).not.toHaveBeenCalled()})
  it('rejects a changed source or conflicting object with different bytes',async()=>{mocks.inspect.mockResolvedValue({sha256:'b'.repeat(64),durationSeconds:12});await expect(snapshotReviewedTikTokVideo(source,'client',hash)).rejects.toThrow('不一致')})
})
