import { describe, it, expect } from 'vitest';
import { cleanEmailBody, newTextOnly } from '../email-thread';

describe('newTextOnly', () => {
  it('cuts a wrapped "On ... wrote:" marker (real production data)', () => {
    const body = [
      'Hi',
      '',
      'By when i will get this price as i will pay in November end',
      '',
      '',
      'Thanks',
      'Nilesh',
      '',
      'On Sat, 24 Oct 2026, 2:11 pm CTS Tours, <info@example.co.nz<mailto:info@example.co.nz>> wrote:',
      'Hi Nilesh,',
      '',
      'I hope this email finds you well.',
      '',
      'How is your consideration of our Shanghai tour departing on 25 March 2026.',
    ].join('\n');

    const result = newTextOnly(body);
    expect(result).toContain('By when i will get this price');
    expect(result).toContain('Nilesh');
    expect(result).not.toContain('Shanghai');
    expect(result).not.toContain('consideration');
  });

  it('cuts at -----Original Message-----', () => {
    const body = 'Hello there\n\n-----Original Message-----\nOld quoted text here';
    expect(newTextOnly(body)).toBe('Hello there');
  });

  it('cuts at a run of underscores', () => {
    const body = 'Hello there\n\n________________________________\nOld quoted text';
    expect(newTextOnly(body)).toBe('Hello there');
  });

  it('cuts at an Outlook From:/Sent:/To: header block', () => {
    const body = [
      'Hello there',
      '',
      'From: Someone Else',
      'Sent: Monday',
      'To: Me',
      'Subject: Re: thing',
      '',
      'Old quoted text',
    ].join('\n');
    expect(newTextOnly(body)).toBe('Hello there');
  });

  it('does NOT cut when From: is followed by ordinary prose', () => {
    const body = [
      'Hello there',
      '',
      'From: my experience last year, this tour was great.',
      'I would recommend it.',
    ].join('\n');
    const result = newTextOnly(body);
    expect(result).toContain('From: my experience last year');
    expect(result).toContain('I would recommend it.');
  });

  it('cuts at 发件人：', () => {
    const body = '你好\n\n发件人：CTS Tours\n旧内容';
    expect(newTextOnly(body)).toBe('你好');
  });

  it('cuts at 在 ... 写道：', () => {
    const body = '你好\n\n在 2026年10月24日，CTS 写道：\n旧内容';
    expect(newTextOnly(body)).toBe('你好');
  });

  it('cuts at a > quoted line', () => {
    const body = 'Hello there\n> quoted line\n> another';
    expect(newTextOnly(body)).toBe('Hello there');
  });

  it('returns the whole body when no marker is present', () => {
    const body = '  Just a plain message.\nSecond line.  ';
    expect(newTextOnly(body)).toBe('Just a plain message.\nSecond line.');
  });

  it('returns empty string when the body is only quoted history', () => {
    const body = 'On Sat, 24 Oct 2026, CTS wrote:\nHi Nilesh,\nOld text';
    expect(newTextOnly(body)).toBe('');
  });

  it('drops a trailing -- signature block', () => {
    const body = 'Hello there\n\nThanks\nNilesh\n--\nNilesh Kumar\nCTS Tours';
    const result = newTextOnly(body);
    expect(result).toContain('Hello there');
    expect(result).toContain('Nilesh');
    expect(result).not.toContain('Nilesh Kumar');
    expect(result).not.toContain('CTS Tours');
  });

  it('returns empty string for blank, null and undefined input', () => {
    expect(newTextOnly('')).toBe('');
    expect(newTextOnly('   \n\n  ')).toBe('');
    expect(newTextOnly(null)).toBe('');
    expect(newTextOnly(undefined)).toBe('');
  });

  it('is idempotent across two calls (no /g lastIndex regression)', () => {
    const body = [
      'Hi',
      '',
      'By when i will get this price',
      '',
      'On Sat, 24 Oct 2026, CTS Tours wrote:',
      'Old quoted text',
    ].join('\n');
    const first = newTextOnly(body);
    const second = newTextOnly(body);
    expect(first).toBe(second);
  });
});

describe('cleanEmailBody —— 把「客人自己写的」和「客人转发的」分开', () => {
  // 这段是真实生产数据的形状（名字已替换）。真实那封信清洗后只剩
  // "Sent from my iPad"，既不为空、又毫无信息 —— 调用方的「空了就兜底」永远不触发，
  // AI 就会照着 "Sent from my iPad" 给客人写一张卡。
  const forwarded = [
    'Sent from my iPad',
    '',
    '---------- Forwarded message ---------',
    'From: Travel Agent <agent@example.com>',
    'Date: Fri, 24 Oct 2026 at 09:12',
    'Subject: Your China itinerary',
    'To: Jane Smith <jane@example.com>',
    '',
    'Day 1 Beijing arrival, hotel transfer included.',
    'Day 2 Great Wall at Mutianyu.',
  ].join('\n')

  it('设备页脚不算内容，所以 own 为空；转发的正文留在 forwarded 里，头部字段被剔掉', () => {
    const r = cleanEmailBody(forwarded)
    expect(r.own).toBe('')
    expect(r.forwarded).toContain('Great Wall')
    expect(r.forwarded).not.toContain('agent@example.com')
  })

  // 🔴 这两条钉的是我在复审 DeepSeek 第二轮时查出的真 bug：
  // 转发标记当时只在 forwarded 那边认，own 那边不认，于是同一段转发内容
  // 既被当成客人自己写的、又重复进 forwarded 一份。
  it('Begin forwarded message：own 里不许出现转发内容', () => {
    const body = ['see below', '', 'Begin forwarded message:', '', 'From: a@example.com', '', 'Great Wall at Mutianyu.'].join('\n')
    const r = cleanEmailBody(body)
    expect(r.own).toBe('see below')
    expect(r.own).not.toContain('Mutianyu')
    expect(r.forwarded).toContain('Mutianyu')
  })

  it('只用 3 个连字符的转发标记，own 里同样不许出现转发内容', () => {
    const body = ['fyi', '', '--- Forwarded message ---', 'From: a@example.com', '', 'Great Wall at Mutianyu.'].join('\n')
    const r = cleanEmailBody(body)
    expect(r.own).toBe('fyi')
    expect(r.own).not.toContain('Mutianyu')
    expect(r.forwarded).toContain('Mutianyu')
  })

  it('-----Original Message----- 是回复不是转发：引用历史一律丢弃，forwarded 保持空', () => {
    const body = ['My answer is yes.', '', '-----Original Message-----', 'From: a@example.com', '', 'Do you agree?'].join('\n')
    const r = cleanEmailBody(body)
    expect(r.own).toBe('My answer is yes.')
    expect(r.forwarded).toBe('')
  })

  it('普通回复（On ... wrote:）：forwarded 保持空', () => {
    const body = ['Yes please.', '', 'On Sat, 24 Oct 2026, CTS Tours wrote:', 'Our tour departs 25 March.'].join('\n')
    expect(cleanEmailBody(body).forwarded).toBe('')
  })

  it('转发内容超过 4000 字就切到 4000', () => {
    const body = ['---------- Forwarded message ---------', '', 'x'.repeat(5000)].join('\n')
    expect(cleanEmailBody(body).forwarded).toHaveLength(4000)
  })

  it('空输入两边都是空串', () => {
    for (const v of [null, undefined, '', '   \n  ']) {
      const r = cleanEmailBody(v)
      expect(r.own).toBe('')
      expect(r.forwarded).toBe('')
    }
  })

  it('各种设备页脚都剔掉，但「Sent from my」开头的正文不许动', () => {
    for (const footer of [
      'Sent from my iPhone', 'Sent from my iPad', 'Sent from my Samsung Galaxy',
      'Sent from Outlook for iOS', 'Get Outlook for Android',
      'Sent from Mail for Windows 11', 'Sent via BlackBerry',
      '发自我的 iPhone', '发自我的华为手机',
    ]) {
      expect(newTextOnly(`Please quote 3 adults.\n\n${footer}`)).toBe('Please quote 3 adults.')
    }
    // 整行超过 40 字就不算页脚 —— 这是正文，不许删。
    const prose = 'Sent from my villa in Queenstown next week, so please call then'
    expect(newTextOnly(`Hi there.\n\n${prose}`)).toContain('Queenstown')
  })

  it('同一份输入连问两次结果一样（带 g 标志的正则配 .test() 会一次真一次假）', () => {
    const first = cleanEmailBody(forwarded)
    const second = cleanEmailBody(forwarded)
    expect(second).toEqual(first)
  })
})
