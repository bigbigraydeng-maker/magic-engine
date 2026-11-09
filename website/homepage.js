const logo=name=>`<img class="platform-logo ${name}" src="/assets/ecosystem/${name}.svg" alt="${name}">`;
let selected='enquiries',websiteAfter=true,ad=0;
const tabs=[...document.querySelectorAll('[data-case]')];
let draftResizeObserver;
const settings={enquiries:{label:'WEBSITE & ENQUIRIES',title:'A page that makes\nyou want to go.',description:'A clear trip, a reason to choose it, and an obvious way to enquire.',takeaway:'ME prepares the page design, the copy and the enquiry form together.'},content:{label:'CROSS-PLATFORM AI',title:'One insight.\nThree connected moves.',description:'ME’s AI connects search, social and website signals, then recommends what each channel should do next.',takeaway:'One fictional example: help first-time travellers understand the trip, then give them a clear way to enquire.'},ads:{label:'ADS & BUDGET',title:'See the ad.\nSee where it leads.',description:'Compare two ad drafts and their destination before anything starts spending.',takeaway:'Select an ad to inspect its headlines, search preview and landing page.'}};
function website(){return `<div class="site-window"><div class="site-chrome"><span>● ● ●</span><span>harbour-travel.example / china</span><span>${websiteAfter?'PROPOSED DESIGN':'BEFORE'}</span></div><div class="travel-nav"><b>harbour<span> / travel</span></b><span>Journeys　 Our story　 Contact</span></div>${websiteAfter?`<div class="travel-hero"><img src="/assets/insights/vol04-china-inbound-tourism.jpg" alt="Shanghai at night"><div class="travel-overlay"><span>CHINA, AT A DIFFERENT PACE</span><h4>Big cities.<br>Small groups.<br>Room to explore.</h4><p>12 days from Beijing to Shanghai.<br>Local guides. Time for your own discoveries.</p><a href="#sample-enquiry" class="travel-cta">See the itinerary ↗</a></div></div><div class="trip-facts"><span><b>12 days</b>One unforgettable journey</span><span><b>Small group</b>A more personal experience</span><span><b>Local guides</b>Beyond the guidebook</span></div><div class="itinerary-strip"><span>BEIJING</span><i></i><span>XI’AN</span><i></i><span>SHANGHAI</span></div><div id="sample-enquiry" class="sample-enquiry"><div><h5>Is this your kind of trip?</h5><p>Get the day-by-day itinerary.</p></div><button type="button" data-show-form>Request the itinerary ↗</button></div>`:`<div class="before-page"><div class="before-banner">WELCOME TO HARBOUR TRAVEL</div><h4>Experience the journey<br>of a lifetime.</h4><p>We offer a wide range of travel experiences.<br>Explore our destinations and find out more.</p><img src="/assets/insights/vol04-china-inbound-tourism.jpg" alt="Shanghai"><div class="before-links">Destinations　 About us　 Read more</div><div class="before-callout">Which trip? How long? How do I enquire?</div></div>`}<div class="artifact-foot">WEBSITE DESIGN EXAMPLE · NOT A LIVE TRAVEL OFFER</div></div>`;}
function socialDraft() {
  return `<article class="channel-work" aria-label="Draft 1 of 3: Instagram">
    <div class="channel-work-head">${logo('instagram')}<strong>Instagram</strong><span>01 / 03</span></div>
    <p class="channel-job">Spark interest in the journey</p>
    <div class="social-creative">
      <img src="/assets/harbour-daylight-concept.jpg" alt="AI-generated concept of a sunlit Shanghai waterfront" width="1536" height="1024" loading="lazy">
      <span class="image-credit">AI-generated concept image</span>
      <div class="social-creative-copy"><span>HARBOUR / TRAVEL</span><h4>Big cities.<br>Room to explore.</h4><p>Your first China trip, at a gentler pace.</p><span class="draft-cta">Discover the 12-day route ↗</span></div>
    </div>
    <p class="channel-reason"><strong>Why this format</strong>A sense of the trip first. A clear route to explore next.</p>
  </article>`;
}
function searchDraft() {
  return `<article class="channel-work" aria-label="Draft 2 of 3: Google Search">
    <div class="channel-work-head">${logo('google')}<strong>Google Search</strong><span>02 / 03</span></div>
    <p class="channel-job">Answer an active planning question</p>
    <div class="search-creative"><span class="creative-label">SEARCH AD DRAFT</span><div class="sample-query">⌕ <span>China small group itinerary</span></div>
      <div class="search-draft-copy"><small>Sponsored · Harbour Travel</small><span>harbour-travel.example/china</span><h4>First Trip to China?<br>See the 12-Day Plan</h4><p>Beijing, Xi’an and Shanghai. Local guides, a small group and room to explore. Ask for the day-by-day itinerary.</p><div class="search-draft-links">See the route · Ask a question</div></div>
      <p class="draft-budget">Budget not set · Approval required</p>
    </div>
    <p class="channel-reason"><strong>Why this format</strong>Match the planning question with the route, duration and next step.</p>
  </article>`;
}
function landingDraft() {
  return `<article class="channel-work" aria-label="Draft 3 of 3: Website">
    <div class="channel-work-head"><span class="website-mark" aria-hidden="true">↗</span><strong>Website</strong><span>03 / 03</span></div>
    <p class="channel-job">Help an interested visitor enquire</p>
    <div class="landing-creative"><span class="creative-label">HARBOUR / TRAVEL</span><h4>Your first China trip.<br>A plan you can picture.</h4>
      <div class="route-preview"><div><b>01</b><span><strong>Beijing</strong>Start with the great sights</span></div><div><b>02</b><span><strong>Xi’an</strong>Make time for discovery</span></div><div><b>03</b><span><strong>Shanghai</strong>Finish at your own pace</span></div></div>
      <div class="trip-answer"><strong>Travelling on your own?</strong><p>Ask us about joining the small group.</p></div><span class="draft-cta">Request the 12-day itinerary ↗</span>
    </div>
    <p class="channel-reason"><strong>Why this format</strong>Bring the route and the solo-travel question next to the enquiry step.</p>
  </article>`;
}
function social() {
  return `<section class="connected-workspace" aria-label="Connected marketing example">
    <div class="connected-insight"><div class="insight-heading"><img src="/assets/favicon.svg" alt=""><span>ME CONNECTS THE DOTS</span><small>FICTIONAL EXAMPLE</small></div>
      <p>Explain the route and who the trip suits.<br><strong>Then invite an enquiry.</strong></p>
      <details class="insight-evidence"><summary>Why this direction? <span>3 example inputs ↓</span></summary><div><p>Assumed inputs for fictional business Harbour Travel.</p><ul><li><b>Search</b><span>“China small group itinerary”</span></li><li><b>Social</b><span>“Can I join on my own?”</span></li><li><b>Website</b><span>The route is hard to find.</span></li></ul><p>Suggested interpretation: people may need help picturing the trip before they are ready to enquire.</p></div></details>
    </div>
    <div class="drafts-toolbar"><div><strong>Three drafts. One shared direction.</strong><span>Instagram · Google Search · Website</span></div></div>
    <div class="draft-navigation"><span class="swipe-cue">Swipe to explore <span aria-hidden="true">→</span></span><div><button type="button" data-draft-step="-1" aria-label="Previous draft" aria-controls="connected-drafts" disabled>←</button><span class="draft-count" role="status" aria-live="polite" aria-atomic="true">1 of 3</span><button type="button" data-draft-step="1" aria-label="Next draft" aria-controls="connected-drafts">→</button></div></div>
    <div class="draft-track" id="connected-drafts" role="region" aria-label="Marketing drafts. Swipe or use the arrow keys to explore." tabindex="0">${socialDraft()}${searchDraft()}${landingDraft()}</div>
    <div class="connected-check"><strong>Next check</strong><span>Which channel leads to itinerary requests?</span></div>
    <p class="connected-disclaimer">Illustrative drafts, not live accounts or results.<br>You approve before anything is published or spent.</p>
  </section>`;
}
function moveDraft(direction) {
  const track = document.getElementById('connected-drafts');
  if (!track) return;
  const cards = [...track.children];
  const current = Number(track.dataset.current || 0);
  const target = Math.max(0, Math.min(cards.length - 1, current + direction));
  track.scrollTo({left: cards[target].offsetLeft - cards[0].offsetLeft,
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
}
function initDraftTrack() {
  const track = document.getElementById('connected-drafts');
  if (!track) return;
  const cards = [...track.children];
  let lastWidth = track.clientWidth;
  const update = () => {
    if (track.clientWidth !== lastWidth) return;
    const current = cards.reduce((best, card, index) =>
      Math.abs(card.offsetLeft - cards[0].offsetLeft - track.scrollLeft) <
      Math.abs(cards[best].offsetLeft - cards[0].offsetLeft - track.scrollLeft) ? index : best, 0);
    if (track.dataset.current === String(current)) return;
    track.dataset.current = String(current);
    document.querySelector('.draft-count').textContent = `${current + 1} of ${cards.length}`;
    document.querySelector('[data-draft-step="-1"]').disabled = current === 0;
    document.querySelector('[data-draft-step="1"]').disabled = current === cards.length - 1;
  };
  draftResizeObserver = new ResizeObserver(() => {
    if (track.clientWidth === lastWidth) return;
    lastWidth = track.clientWidth;
    const current = Number(track.dataset.current || 0);
    track.scrollTo({left: cards[current].offsetLeft - cards[0].offsetLeft, behavior: 'instant'});
    update();
  });
  draftResizeObserver.observe(track);
  track.addEventListener('scroll', update, {passive: true});
  track.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    moveDraft(event.key === 'ArrowRight' ? 1 : -1);
  });
  update();
}
const ads=[{name:'China · Small-group journey',head:'China Small-Group Tours | 12 Days, Three Great Cities',description:'Explore Beijing, Xi’an and Shanghai with local guides. See the route and request your itinerary.',label:'Small-group China journey'},{name:'China · First-time travellers',head:'Your First Trip to China | Start With a Clear Itinerary',description:'Wondering where to start? Discover a 12-day route through China with time to explore. Ask for the day-by-day plan.',label:'First trip to China'}];
function advertising(){const a=ads[ad];return `<div class="ads-console"><div class="ads-header">${logo('googleads')}<b>Google Ads</b><span>Harbour Travel · Sample account</span></div><div class="ads-body"><aside><b>▦</b><span>Overview</span><b>◈</b><span>Campaigns</span><b>▤</b><span>Ads</span></aside><div class="ads-main"><div class="ads-title"><h4>Ads</h4><span>Drafts only</span></div><div class="ads-toolbar"><span>Search campaign / China enquiries</span></div><div class="ads-table"><div class="ads-row table-head"><span>Ad</span><span>Status</span></div>${ads.map((item,i)=>`<button class="ads-row ${i===ad?'selected-ad':''}" data-ad="${i}" aria-pressed="${i===ad}"><span>▣　${item.name}</span><span>Draft</span></button>`).join('')}</div><div class="ad-inspector"><div class="ad-inspector-heading"><strong>Ad preview</strong><span>Desktop search</span></div><div class="search-preview"><small><b>Sponsored</b> · Harbour Travel</small><span class="search-url">harbour-travel.example/china</span><h5>${a.head}</h5><p>${a.description}</p><div class="sitelinks">View itinerary　　Ask a question</div></div><div class="ad-destination"><img src="/assets/insights/vol04-china-inbound-tourism.jpg" alt="Destination page preview"><div><small>DESTINATION PAGE</small><strong>${a.label}</strong><span>12 days · Beijing to Shanghai</span></div><span>↗</span></div><div class="ad-budget"><span>Budget <b>Not set</b></span><span>Serving <b>Off</b></span><span>Approval <b>Required</b></span></div></div></div></div><div class="artifact-foot">ILLUSTRATIVE AD WORKSPACE · NO LIVE ACCOUNT OR PERFORMANCE DATA</div></div>`;}
function render(){draftResizeObserver?.disconnect();const s=settings[selected];document.querySelector('.scenario-copy .label').textContent=s.label;document.getElementById('case-title').textContent=s.title;document.getElementById('case-description').textContent=s.description;document.getElementById('scene-takeaway').textContent=s.takeaway;document.getElementById('scene-controls').innerHTML=selected==='enquiries'?`<div class="design-toggle"><button data-design="before" aria-pressed="${!websiteAfter}">Before</button><button data-design="after" aria-pressed="${websiteAfter}">ME redesign</button></div>`:selected==='content'?'':'<span class="interaction-hint">Select a row to preview each ad →</span>';document.getElementById('deliverable-stage').innerHTML=selected==='enquiries'?website():selected==='content'?social():advertising();if(selected==='content')initDraftTrack();}
function selectCase(key){selected=key;tabs.forEach(t=>{const active=t.dataset.case===key;t.setAttribute('aria-selected',String(active));t.tabIndex=active?0:-1;});document.querySelector('#scenario').setAttribute('aria-labelledby','tab-'+key);render();}
tabs.forEach((tab,index)=>{tab.addEventListener('click',()=>selectCase(tab.dataset.case));tab.addEventListener('keydown',e=>{let target=index;if(e.key==='ArrowRight')target=(index+1)%tabs.length;else if(e.key==='ArrowLeft')target=(index+tabs.length-1)%tabs.length;else return;e.preventDefault();tabs[target].focus();selectCase(tabs[target].dataset.case);});});
document.getElementById('scenario').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.design){websiteAfter=b.dataset.design==='after';render();}else if(b.hasAttribute('data-draft-step')){moveDraft(Number(b.dataset.draftStep));}else if(b.hasAttribute('data-ad')){ad=Number(b.dataset.ad);render();}else if(b.hasAttribute('data-show-form')){document.getElementById('sample-enquiry').innerHTML='<form class="sample-trip-form"><label for="trip-email">Where should we send the itinerary?</label><div><input id="trip-email" type="email" required placeholder="you@example.com"><button>Request itinerary</button></div><small>Preview only · no request is sent</small></form>';document.querySelector('.sample-trip-form').addEventListener('submit',event=>{event.preventDefault();document.querySelector('.sample-trip-form small').textContent='Preview complete. No request was sent.';});}});
function showExample(key){selectCase(key);document.getElementById('work').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}
document.getElementById('hero-review').textContent='See a page redesign ↗';document.getElementById('hero-review').addEventListener('click',()=>showExample('enquiries'));
document.querySelectorAll('[data-review]').forEach(b=>{b.textContent='See the connected drafts ↗';b.addEventListener('click',()=>showExample(b.dataset.review));});
document.querySelector('.approval-card h3').textContent='Harbour Travel’s next post.';
document.querySelector('.approval-card .post').textContent='“Your first trip to China doesn’t have to be a race through the sights. Explore Beijing, Xi’an and Shanghai at your own pace. Message CHINA for the itinerary.”';
document.querySelector('.approval-card-head').insertAdjacentHTML('afterend',`<div class="platform-pills approval-platforms"><span>${logo('facebook')} Facebook</span><span>${logo('instagram')} Instagram</span></div>`);
render();

// Keep desktop content open and remember each disclosure's mobile state.
const mobileLayout = matchMedia('(max-width: 760px)');
const mobileDetails = [...document.querySelectorAll('.mobile-details')];
const mobileOpen = new Map(mobileDetails.map(detail => [detail, false]));
function syncMobileDetails() {
  mobileDetails.forEach(detail => {
    detail.open = !mobileLayout.matches || mobileOpen.get(detail) || detail.contains(document.activeElement);
  });
}
mobileDetails.forEach(detail => {
  detail.addEventListener('toggle', () => {
    if (mobileLayout.matches) mobileOpen.set(detail, detail.open);
  });
});
mobileLayout.addEventListener('change', syncMobileDetails);
syncMobileDetails();
