import { cleanup,render,screen } from '@testing-library/react'
import { afterEach,describe,expect,it } from 'vitest'
import LoginPage from '@/app/login/page'

afterEach(cleanup)

describe('Meta Ads AI invited-customer login',()=>{
  it('uses Chinese copy without changing the default login route',()=>{
    render(<LoginPage searchParams={{ next:'/meta-ads-ai/a1000000-0000-4000-8000-000000000001' }} />)

    expect(screen.getByRole('heading',{ name:'欢迎回来' })).toBeInTheDocument()
    expect(screen.getByText('登录后继续连接 Meta 广告账户。')).toBeInTheDocument()
    expect(screen.getByRole('button',{ name:'使用 Google 账号继续' })).toBeInTheDocument()
    expect(screen.getByLabelText('邮箱地址')).toBeInTheDocument()
    expect(screen.getByLabelText('密码')).toBeInTheDocument()
    expect(screen.queryByText('Welcome back.')).not.toBeInTheDocument()
  })
})
