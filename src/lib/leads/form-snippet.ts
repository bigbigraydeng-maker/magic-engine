/**
 * Embeddable enquiry-form snippet builder (Phase B · FDE delivery tool).
 *
 * Generates a self-contained HTML+CSS+JS enquiry form that a client pastes
 * onto their OWN website. On submit it POSTs JSON to the existing public
 * lead-capture endpoint `/api/clients/[id]/leads` (CORS-locked to the client's
 * own domain, honeypot + rate-limited server-side). No external dependencies,
 * no framework — one inline block that works on any site.
 *
 * Mirrors the GEO snippet-builder pattern (src/lib/geo/snippet-builder.ts):
 * one HTML block + per-platform copy-paste install instructions.
 *
 * Red lines: the snippet only collects contact details the visitor types; it
 * never phones home anywhere except the client's own lead endpoint. The
 * honeypot field name (`company_hp`) must match the server's sanitiseLead.
 */

export type SnippetPlatform = 'generic' | 'wordpress' | 'webflow'

export interface InstallSnippet {
  platform: SnippetPlatform
  instructions: string[]
}

export interface LeadFormOptions {
  /** Prospect/client UUID — the {id} in /api/clients/{id}/leads. */
  clientId: string
  /** ME app origin the form POSTs to (no trailing slash), e.g. https://app.magicengine.com.au */
  apiBase: string
  /** Shown in the form heading; falls back to a neutral label. */
  businessName?: string
  /** Accent colour for the button (hex). Defaults to a neutral dark. */
  accent?: string
}

export interface LeadFormSnippet {
  /** The full embeddable block (style + form + script). */
  html: string
  /** Per-platform install guides. */
  installs: InstallSnippet[]
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Build the self-contained enquiry-form HTML block. Everything is inline and
 * namespaced under `.me-lead-form` so it can't collide with the host page.
 */
export function buildLeadFormHtml(opts: LeadFormOptions): string {
  const accent = opts.accent && HEX_RE.test(opts.accent) ? opts.accent : '#1A1A1A'
  const heading = opts.businessName ? `Get in touch with ${esc(opts.businessName)}` : 'Get in touch'
  // The endpoint URL is fixed from clientId + apiBase; both are our own values.
  const endpoint = `${opts.apiBase.replace(/\/+$/, '')}/api/clients/${opts.clientId}/leads`

  return `<!-- Magic Engine enquiry form — paste where you want the form to appear -->
<div class="me-lead-form" data-me-endpoint="${esc(endpoint)}">
  <style>
    .me-lead-form{max-width:460px;margin:0 auto;font-family:inherit;color:#1a1a1a}
    .me-lead-form h3{margin:0 0 12px;font-size:1.15rem}
    .me-lead-form label{display:block;font-size:.8rem;font-weight:600;margin:10px 0 4px}
    .me-lead-form input,.me-lead-form textarea{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #d5d5d5;border-radius:8px;font:inherit;font-size:.95rem}
    .me-lead-form textarea{resize:vertical;min-height:84px}
    .me-lead-form .me-hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
    .me-lead-form button{width:100%;margin-top:14px;padding:12px;border:0;border-radius:8px;background:${accent};color:#fff;font:inherit;font-weight:700;font-size:.95rem;cursor:pointer}
    .me-lead-form button[disabled]{opacity:.6;cursor:default}
    .me-lead-form .me-msg{margin-top:12px;padding:10px 12px;border-radius:8px;font-size:.9rem;display:none}
    .me-lead-form .me-ok{background:#e8f3e2;color:#2f5d23;display:block}
    .me-lead-form .me-err{background:#f7e3e1;color:#8a2f26;display:block}
  </style>
  <form novalidate>
    <h3>${heading}</h3>
    <label>Your name *<input name="name" type="text" autocomplete="name" required></label>
    <label>Phone *<input name="phone" type="tel" autocomplete="tel" required></label>
    <label>Email<input name="email" type="email" autocomplete="email"></label>
    <label>How can we help?<textarea name="message"></textarea></label>
    <div class="me-hp" aria-hidden="true"><label>Company<input name="company_hp" tabindex="-1" autocomplete="off"></label></div>
    <button type="submit">Send enquiry</button>
    <div class="me-msg" role="status"></div>
  </form>
  <script>
  (function(){
    var root=document.currentScript.closest('.me-lead-form');
    var form=root.querySelector('form'),btn=form.querySelector('button'),msg=root.querySelector('.me-msg');
    var endpoint=root.getAttribute('data-me-endpoint');
    form.addEventListener('submit',function(e){
      e.preventDefault();
      msg.className='me-msg';msg.textContent='';
      var data={
        name:form.name.value,phone:form.phone.value,email:form.email.value,
        message:form.message.value,company_hp:form.company_hp.value,
        source_url:location.href,referrer:document.referrer
      };
      if(!data.name.trim()||!data.phone.trim()){msg.className='me-msg me-err';msg.textContent='Please enter your name and phone number.';return;}
      btn.disabled=true;btn.textContent='Sending…';
      fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})
        .then(function(r){return r.json().catch(function(){return{};});})
        .then(function(j){
          if(j&&j.success){form.reset();msg.className='me-msg me-ok';msg.textContent='Thanks — we\\'ve got your enquiry and will be in touch shortly.';}
          else{msg.className='me-msg me-err';msg.textContent=(j&&j.error)||'Something went wrong — please call us instead.';}
        })
        .catch(function(){msg.className='me-msg me-err';msg.textContent='Network error — please call us instead.';})
        .then(function(){btn.disabled=false;btn.textContent='Send enquiry';});
    });
  })();
  </script>
</div>
<!-- /Magic Engine enquiry form -->`
}

/** Per-platform install guides (mirrors the GEO snippet-builder shape). */
export function buildLeadFormInstalls(): InstallSnippet[] {
  return [
    { platform: 'generic', instructions: [
      'Copy the whole block below.',
      'Paste it into your page exactly where you want the form to appear (a "Contact" section works well).',
      'Publish the page. Submissions arrive in your Magic Engine lead inbox instantly.',
    ] },
    { platform: 'wordpress', instructions: [
      'Edit the page in the Block Editor.',
      'Add a "Custom HTML" block where you want the form.',
      'Paste the block, then Update the page.',
      '(Classic editor: switch to the "Text"/HTML tab and paste there.)',
    ] },
    { platform: 'webflow', instructions: [
      'Drag an "Embed" element onto the page where the form should sit.',
      'Paste the block into the Embed code editor and Save.',
      'Publish the site.',
    ] },
  ]
}

/** Build the complete embeddable snippet + install guides for a client. */
export function buildLeadFormSnippet(opts: LeadFormOptions): LeadFormSnippet {
  return { html: buildLeadFormHtml(opts), installs: buildLeadFormInstalls() }
}
