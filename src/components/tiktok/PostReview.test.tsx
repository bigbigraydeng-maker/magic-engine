import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TikTokPostReview } from './PostReview'
const creator={videoProof:{sha256:'a'.repeat(64),durationSeconds:12},accountId:'test-account',creator_nickname:'Test creator',privacy_level_options:['SELF_ONLY'],comment_disabled:true,duet_disabled:false,stitch_disabled:false,max_video_post_duration_sec:30}
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
it('loads current account info without selecting privacy or enabling interactions',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(creator))))
  const submit=vi.fn()
  render(<TikTokPostReview clientId="test" postId="test-post" videoUrl="/test.mp4" caption="Test" onSubmit={submit} onClose={()=>{}} />)
  await screen.findByText('目标账号：Test creator')
  expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('')
  expect((screen.getByLabelText('允许评论') as HTMLInputElement).disabled).toBe(true)
  expect((screen.getByLabelText('允许合拍') as HTMLInputElement).checked).toBe(false)
  const video = document.querySelector('video')!
  Object.defineProperty(video,'duration',{value:12})
  fireEvent.loadedMetadata(video)
  fireEvent.click(screen.getByRole('button',{name:'确认发布到 TikTok'}))
  await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('可见范围'))
  expect(submit).not.toHaveBeenCalled()
})
it('does not allow confirmation when creator lookup fails',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({error:'Connect TikTok first'}),{status:400})))
  render(<TikTokPostReview clientId="test" postId="test-post" videoUrl="/test.mp4" caption="Test" onSubmit={vi.fn()} onClose={()=>{}} />)
  await screen.findByText('Connect TikTok first')
  expect((screen.getByRole('button',{name:'确认发布到 TikTok'}) as HTMLButtonElement).disabled).toBe(true)
})
