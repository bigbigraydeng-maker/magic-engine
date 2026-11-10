/**
 * 「什么时候用」：列表上有字才显示；编辑框空着时给一句中文提示；保存时带上修剪后的文字。
 */

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { EmailTemplateVersion } from '@/lib/crm/email-templates/types'
import { TemplateEditor } from '../TemplateEditor'
import { TemplatesAdmin } from '../TemplatesAdmin'
import { WhenToUseField } from '../WhenToUseField'
import { WhenToUsePreview } from '../WhenToUsePreview'
import { WHEN_TO_USE_EMPTY_HINT } from '@/lib/crm/email-templates/when-to-use'

const variables = { common: ['first_name'], bySource: { none: [], published_tours: [] } }

const row = (over: Partial<EmailTemplateVersion> = {}): EmailTemplateVersion => ({
  id: 'id-1',
  clientId: 'c1',
  templateKey: 'post-call',
  version: 3,
  name: '通话后 · 发团资料',
  subject: 'Subject text',
  body: 'Body text',
  factSource: 'none',
  pickMode: 'none',
  pickFilter: {},
  status: 'active',
  changeNote: null,
  createdBy: 'staff@example.com',
  createdAt: '2026-10-28T01:00:00Z',
  ...over,
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('when-to-use preview', () => {
  it('shows the label and the note', () => {
    render(<WhenToUsePreview text="打完电话 24 小时内" />)
    const line = screen.getByTestId('when-to-use-preview')
    expect(line).toHaveTextContent('什么时候用：')
    expect(line).toHaveTextContent('打完电话 24 小时内')
  })

  it.each([undefined, null, '', '   '])('shows nothing when the note is %s', (text) => {
    const { container } = render(<WhenToUsePreview text={text} />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByText(/什么时候用/)).toBeNull()
  })
})

describe('when-to-use editor field', () => {
  it('shows a plain-Chinese hint while empty, and the typed note once filled', () => {
    const onChange = vi.fn()
    const { rerender } = render(<WhenToUseField value="" onChange={onChange} />)
    const input = screen.getByLabelText('什么时候用') as HTMLInputElement
    expect(input.placeholder).toBe(WHEN_TO_USE_EMPTY_HINT)
    expect(input.value).toBe('')
    fireEvent.change(input, { target: { value: '客人来信后' } })
    expect(onChange).toHaveBeenCalledWith('客人来信后')
    rerender(<WhenToUseField value="客人来信后" onChange={onChange} />)
    expect((screen.getByLabelText('什么时候用') as HTMLInputElement).value).toBe('客人来信后')
  })
})

describe('when-to-use on the template page', () => {
  it('shows the note on the card, and hides the line when another template has none', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          featureState: 'ready',
          canEditTemplates: true,
          canEditSettings: false,
          templates: [row({ whenToUse: '打完电话 24 小时内' }), row({ id: 'id-2', templateKey: 'thanks', name: '谢谢', whenToUse: null })],
          stats: [],
          variables,
        }),
      })),
    )
    render(<TemplatesAdmin clientId="c1" />)
    expect(await screen.findByText('打完电话 24 小时内')).toBeInTheDocument()
    expect(screen.getAllByTestId('when-to-use-preview')).toHaveLength(1)
  })

  it('the editor sends the trimmed note with the new version', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ template: row(), notices: [] }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<TemplateEditor clientId="c1" initial={null} variables={variables} onSaved={vi.fn()} onCancel={vi.fn()} onReload={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('模板名称'), { target: { value: 'Thank you' } })
    fireEvent.change(screen.getByLabelText('什么时候用'), { target: { value: '  客人来信后  ' } })
    fireEvent.change(screen.getByLabelText('邮件主题'), { target: { value: 'Hi' } })
    fireEvent.change(screen.getByLabelText('邮件正文'), { target: { value: 'Body' } })
    fireEvent.click(screen.getByRole('button', { name: '保存模板' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body)) as { whenToUse: string }
    expect(body.whenToUse).toBe('客人来信后')
  })
})
