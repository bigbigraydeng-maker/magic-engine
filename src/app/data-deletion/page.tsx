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
            When you connect Facebook for the free Facebook ad check-up, we keep a read-only
            connection to the ad accounts you choose (an encrypted access token) and the reports we
            generated for you. We never change, pause or delete your ads.
          </p>
        </Section>

        <Section title="How to delete">
          <ol className="list-decimal pl-6 text-gray-700">
            <li className="mb-3">
              <strong>In Facebook</strong> — Settings &amp; privacy &rarr; Settings &rarr; Apps and
              websites &rarr; find &ldquo;Magic Engine&rdquo; &rarr; Remove. If you see &ldquo;Send
              request&rdquo;, tap it too. Facebook sends us the request automatically. Facebook will
              show you a status link after removal; open it to see the result.
            </li>
            <li className="mb-3">
              <strong>Or email us</strong> — send a message to{' '}
              <a href="mailto:hello@magicengine.cloud" className="text-indigo-600 underline">
                hello@magicengine.cloud
              </a>{' '}
              with the subject &ldquo;Data deletion request&rdquo; and the email or business name
              you used. We delete the data within 30 days and reply to confirm.
            </li>
          </ol>
        </Section>

        <Section title="What gets deleted">
          <p>
            Immediately when Facebook&rsquo;s request arrives: your read-only ads connections in
            every Magic Engine account, the stored access tokens, your Facebook user id on those
            connections, the contents of reports generated through them, and any access codes other
            software used to read those reports.
          </p>
        </Section>

        <Section title="What we keep">
          <p>
            A record of the deletion request — an irreversible code derived from your Facebook id
            (it cannot be turned back into your id), the date and the result — kept for 12 months so
            you can check the status. Our internal usage records keep the ad account number the
            emptied reports belonged to, but no names, emails, ad data or tokens.
          </p>
        </Section>

        <Section title="Not covered by this request">
          <p>
            Facebook Page connections used for social publishing are stored by Page, not by your
            personal id — to remove them, disconnect the Page inside Magic Engine or email us. We
            remove these within 30 days of your email.
          </p>
        </Section>

        <hr className="my-12 border-gray-200" />

        <h2 className="mb-6 text-2xl font-bold text-gray-900">数据删除</h2>

        <Section title="我们从 Facebook 保存了什么">
          <p>
            你为了免费 Facebook 广告体检连接 Facebook 后，我们保存你选择的广告账户的只读连接（加密保存的访问凭证），以及为你生成的报告。我们从不修改、暂停或删除你的广告。
          </p>
        </Section>

        <Section title="怎么删除">
          <ol className="list-decimal pl-6 text-gray-700">
            <li className="mb-3">
              在 Facebook 里：设置和隐私 (Settings &amp; privacy) &rarr; 设置 (Settings) &rarr;
              应用和网站 (Apps and websites) &rarr; 找到 Magic Engine &rarr; 移除 (Remove)；如果看到「发送请求 (Send
              request)」，也点一下。Facebook 会自动把请求发给我们。删除后 Facebook 会给你一个进度链接，点它就能看到结果。
            </li>
            <li className="mb-3">
              或者发邮件到{' '}
              <a href="mailto:hello@magicengine.cloud" className="text-indigo-600 underline">
                hello@magicengine.cloud
              </a>
              ，标题写「删除数据申请」，并附上你注册用的邮箱或公司名。我们会在 30 天内删完，并回邮件告诉你。
            </li>
          </ol>
        </Section>

        <Section title="会删掉什么（收到请求立即执行）">
          <p>
            收到 Facebook 的请求后立即执行：你在所有 Magic Engine 账户里的只读广告连接、保存的访问凭证、这些连接上记录的 Facebook 用户编号、通过这些连接生成的报告内容，以及给其他软件读取这些报告用的授权码。
          </p>
        </Section>

        <Section title="会保留什么">
          <p>
            一条删除申请记录——一串没法反推回你身份的编号、日期和处理结果——保存 12 个月，方便你查进度。我们内部的用量记录里会保留被清空的报告所属的广告账户号，但不保留姓名、邮箱、广告数据或访问凭证。
          </p>
        </Section>

        <Section title="这次删除不包括">
          <p>
            用于社媒发帖的 Facebook 主页连接是按主页保存的，不按你的个人身份。要删除这些，请在 Magic
            Engine 里断开该主页，或发邮件给我们。我们收到邮件后 30 天内删除。
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
