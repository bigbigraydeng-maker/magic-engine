import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Data deletion · Magic Engine',
}

export default function DataDeletionPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="mb-2 text-3xl font-bold text-gray-900">Data deletion</h1>
        <p className="mb-10 text-sm text-gray-500">Facebook (Meta) data · Magic Engine</p>

        <Section title="What we store from Facebook">
          <p>
            When you connect Facebook for the free ad report (Magic Bridge), we keep a read-only
            connection to the ad accounts you choose (an encrypted access token) and the reports we
            generated for you. We never change, pause or delete your ads.
          </p>
        </Section>

        <Section title="How to delete">
          <ol className="list-decimal pl-6 text-gray-700">
            <li className="mb-3">
              <strong>In Facebook</strong> — Settings &amp; privacy &rarr; Settings &rarr; Apps and
              websites &rarr; find &ldquo;Magic Engine&rdquo; &rarr; Remove, and choose to delete
              your data. Facebook sends us the request automatically and gives you a confirmation
              code; you can check progress at{' '}
              <a href="/data-deletion/status" className="text-indigo-600 underline">
                /data-deletion/status?code=YOUR_CODE
              </a>
              .
            </li>
            <li className="mb-3">
              <strong>Or email us</strong> — send a message to{' '}
              <a href="mailto:hello@magicengine.cloud" className="text-indigo-600 underline">
                hello@magicengine.cloud
              </a>{' '}
              with the subject &ldquo;Data deletion request&rdquo;.
            </li>
          </ol>
        </Section>

        <Section title="What gets deleted">
          <p>
            Immediately when the request arrives: your read-only ads connections in every Magic
            Engine workspace, the stored access tokens, the contents of reports generated through
            those connections, and any API keys created on them.
          </p>
        </Section>

        <Section title="What we keep">
          <p>
            A one-way hashed identifier and monthly usage counters, so the free allowance cannot be
            claimed again by removing and re-adding the app; no names, emails, ad data or tokens.
          </p>
        </Section>

        <Section title="Not covered by this request">
          <p>
            Facebook Page connections used for social publishing are stored by Page, not by your
            personal id — to remove them, disconnect the Page inside Magic Engine or email us.
          </p>
        </Section>

        <hr className="my-12 border-gray-200" />

        <h2 className="mb-6 text-2xl font-bold text-gray-900">数据删除</h2>

        <Section title="我们从 Facebook 保存了什么">
          <p>
            你为了免费广告报告（Magic Bridge）连接 Facebook 后，我们保存你选择的广告账户的只读连接（加密保存的访问凭证），以及为你生成的报告。我们从不修改、暂停或删除你的广告。
          </p>
        </Section>

        <Section title="怎么删除">
          <ol className="list-decimal pl-6 text-gray-700">
            <li className="mb-3">
              在 Facebook 里：设置和隐私 &rarr; 设置 &rarr; 应用和网站 &rarr; 找到「Magic
              Engine」&rarr; 移除，并选择删除你的数据。Facebook 会自动把请求发给我们，并给你一个确认码，你可以在{' '}
              <a href="/data-deletion/status" className="text-indigo-600 underline">
                /data-deletion/status?code=你的确认码
              </a>{' '}
              查看进度。
            </li>
            <li className="mb-3">
              或者发邮件到{' '}
              <a href="mailto:hello@magicengine.cloud" className="text-indigo-600 underline">
                hello@magicengine.cloud
              </a>
              ，标题写「删除数据申请」。
            </li>
          </ol>
        </Section>

        <Section title="会删掉什么（收到请求立即执行）">
          <p>
            你在所有 Magic Engine 工作区里的只读广告连接、保存的访问凭证、通过这些连接生成的报告内容，以及在这些连接上创建的接口钥匙。
          </p>
        </Section>

        <Section title="会保留什么">
          <p>
            一个单向加密的标识和每月用量计数，用来防止有人移除再添加应用、重复领取免费额度；不保留姓名、邮箱、广告数据或访问凭证。
          </p>
        </Section>

        <Section title="这次删除不包括">
          <p>
            用于社媒发帖的 Facebook 主页连接是按主页保存的，不按你的个人身份。要删除这些，请在 Magic
            Engine 里断开该主页，或发邮件给我们。
          </p>
        </Section>

        <p className="mt-12 text-sm text-gray-500">
          See also our{' '}
          <a href="/privacy" className="text-indigo-600 underline">
            Privacy Policy
          </a>
          .
        </p>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="mb-4 text-xl font-semibold text-gray-900">{title}</h2>
      <div className="text-gray-700">{children}</div>
    </section>
  )
}
