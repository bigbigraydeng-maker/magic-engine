#!/usr/bin/env python3
# CTS tour route-map generator. Emits PC (landscape) + mobile (portrait) SVGs
# for a grounded tour spec, using the approved Golden China design system.
import json, math, os, html

HERE = os.path.dirname(os.path.abspath(__file__))
CHN = json.load(open(os.path.join(HERE,'chn.json')))['features'][0]['geometry']['coordinates']
MAINLAND = CHN[1][0]; HAINAN = CHN[0][0]
TWN = json.load(open(os.path.join(HERE,'twn.json')))['features'][0]['geometry']['coordinates'][0]
LOGO = 'data:image/png;base64,'+open(os.path.join(HERE,'logo_b64.txt')).read().strip()

DEEP='#1B2E40'; RED='#D22A2E'; SEA='#DCEBF3'; LAND='#EEF1F0'; LANDS='#B9C4CB'
MUTED='#5E6B76'; SUB='#B4BFC9'; CARDB='#E6EAED'; DIV='#EDEFF1'; TEXT='#333333'; TWN_C='#8B97A1'

def esc(s): return html.escape(s, quote=True)
def fit_fs(text, base, maxw, ratio=0.62):
    return min(base, maxw/(max(len(text),1)*ratio))

def defs():
    return f'''<defs>
  <g id="plane" fill="{RED}"><path d="M0,-11 L2.7,-4 L11,-1.4 L11,1.4 L2.7,3.6 L2.7,9 L6,11.4 L6,13.6 L0,12 L-6,13.6 L-6,11.4 L-2.7,9 L-2.7,3.6 L-11,1.4 L-11,-1.4 L-2.7,-4 Z"/></g>
  <g id="train"><rect x="-8.5" y="-12.5" width="17" height="19" rx="5.5" fill="{RED}"/><rect x="-6" y="-8.8" width="12" height="6.2" rx="1.4" fill="#EAF3F8"/><circle cx="-4.4" cy="8.2" r="2.1" fill="#EAF3F8"/><circle cx="4.4" cy="8.2" r="2.1" fill="#EAF3F8"/></g>
  <g id="ship" fill="{RED}"><path d="M-11,2 L11,2 L8,9 L-8,9 Z"/><rect x="-6" y="-7" width="12" height="8" rx="1.2"/><rect x="-1.4" y="-12" width="2.8" height="5"/></g>
  <g id="bus" fill="{RED}"><rect x="-11" y="-8" width="22" height="15" rx="3.2"/><rect x="-8.5" y="-5" width="17" height="6" rx="1.2" fill="#EAF3F8"/><circle cx="-6" cy="8.2" r="2.1"/><circle cx="6" cy="8.2" r="2.1"/></g>
  <g id="arrow"><path d="M0,0 L-14,-6.5 L-14,6.5 Z" fill="{RED}"/></g>
</defs>'''

ICON={'flight':'plane','train':'train','cruise':'ship','coach':'bus'}

def ring_path(P, ring):
    return "M " + " L ".join(f"{P(lo,la)[0]:.1f},{P(lo,la)[1]:.1f}" for lo,la in ring) + " Z"

def make_proj(stops, box, pad_frac=0.42, pad_min=0.6):
    x0,y0,x1,y1 = box
    lons=[s['lon'] for s in stops]; lats=[s['lat'] for s in stops]
    minlon,maxlon=min(lons),max(lons); minlat,maxlat=min(lats),max(lats)
    dlon=(maxlon-minlon) or 1.0; dlat=(maxlat-minlat) or 1.0
    px=dlon*pad_frac+pad_min; py=dlat*pad_frac+pad_min
    minlon-=px; maxlon+=px; minlat-=py; maxlat+=py
    W=x1-x0; H=y1-y0
    scale=min(W/(maxlon-minlon), H/(maxlat-minlat))
    projw=(maxlon-minlon)*scale; projh=(maxlat-minlat)*scale
    ox=x0+(W-projw)/2; oy=y0+(H-projh)/2
    def P(lon,lat): return (ox+(lon-minlon)*scale, oy+(maxlat-lat)*scale)
    return P

def curve(p1,p2,off):
    x1,y1=p1;x2,y2=p2;mx,my=(x1+x2)/2,(y1+y2)/2
    dx,dy=x2-x1,y2-y1;L=math.hypot(dx,dy) or 1;pxu,pyu=-dy/L,dx/L
    c=(mx+pxu*off,my+pyu*off)
    def qp(t):return((1-t)**2*x1+2*(1-t)*t*c[0]+t**2*x2,(1-t)**2*y1+2*(1-t)*t*c[1]+t**2*y2)
    def ang(t):
        ddx=2*(1-t)*(c[0]-x1)+2*t*(x2-c[0]);ddy=2*(1-t)*(c[1]-y1)+2*t*(y2-c[1])
        return math.degrees(math.atan2(ddy,ddx))
    return c,qp,ang

def map_group(spec, box, clip_id, node_r=9, gw_r=10, label_fs=22, sub_fs=15, halo=SEA):
    """Return (svg_defs_clip, svg_body) for the map inside `box`."""
    x0,y0,x1,y1=box
    stops=spec['stops']
    P=make_proj(stops, box)
    pts=[P(s['lon'],s['lat']) for s in stops]
    parts=[]
    parts.append(f'<clipPath id="{clip_id}"><rect x="{x0}" y="{y0}" width="{x1-x0}" height="{y1-y0}" rx="10"/></clipPath>')
    body=[f'<g clip-path="url(#{clip_id})">']
    body.append(f'<path d="{ring_path(P,MAINLAND)}" fill="{LAND}" stroke="{LANDS}" stroke-width="1.5" stroke-linejoin="round"/>')
    # Taiwan + Hainan if within box
    for ring,lab,labpt in [(TWN,'Taiwan',(121.0,23.7)),(HAINAN,None,None)]:
        xs=[P(lo,la)[0] for lo,la in ring]; ys=[P(lo,la)[1] for lo,la in ring]
        if max(xs)>x0 and min(xs)<x1 and max(ys)>y0 and min(ys)<y1:
            body.append(f'<path d="{ring_path(P,ring)}" fill="{LAND}" stroke="{LANDS}" stroke-width="1.5" stroke-linejoin="round"/>')
            if lab:
                lx,ly=P(*labpt)
                body.append(f'<text x="{lx-14:.0f}" y="{ly+6:.0f}" fill="{TWN_C}" font-size="15" font-weight="600" font-style="italic" text-anchor="end">{lab}</text>')
    # route segments
    cx=sum(p[0] for p in pts)/len(pts); cy=sum(p[1] for p in pts)/len(pts)
    icon_marks=[]; arrow_marks=[]
    for seg in spec['segments']:
        a=pts[seg['a']]; b=pts[seg['b']]; off=seg.get('off',30)
        c,qp,ang=curve(a,b,off)
        body.append(f'<path d="M {a[0]:.1f},{a[1]:.1f} Q {c[0]:.1f},{c[1]:.1f} {b[0]:.1f},{b[1]:.1f}" fill="none" stroke="{RED}" stroke-width="5" stroke-linecap="round"/>')
        mid=qp(0.5); ap=qp(0.62); aa=ang(0.62)
        icon_marks.append((mid,ICON.get(seg['mode'],'plane')))
        arrow_marks.append((ap,aa))
    for ap,aa in arrow_marks:
        body.append(f'<g transform="translate({ap[0]:.1f},{ap[1]:.1f}) rotate({aa:.1f})"><use href="#arrow"/></g>')
    for mid,ic in icon_marks:
        body.append(f'<circle cx="{mid[0]:.1f}" cy="{mid[1]:.1f}" r="15" fill="#FFFFFF"/><use href="#{ic}" x="{mid[0]:.1f}" y="{mid[1]:.1f}"/>')
    # start / finish nodes (loop => same node)
    start=spec.get('start_idx', spec.get('gateway',0))
    finish=spec.get('finish_idx', start)
    hub={start,finish}
    # nodes
    for i,p in enumerate(pts):
        if i in hub:
            body.append(f'<circle cx="{p[0]:.1f}" cy="{p[1]:.1f}" r="{gw_r+8}" fill="none" stroke="{RED}" stroke-width="3.5"/><circle cx="{p[0]:.1f}" cy="{p[1]:.1f}" r="{gw_r}" fill="{RED}" stroke="#FFFFFF" stroke-width="3"/>')
        else:
            body.append(f'<circle cx="{p[0]:.1f}" cy="{p[1]:.1f}" r="{node_r+6}" fill="none" stroke="{RED}" stroke-width="3"/><circle cx="{p[0]:.1f}" cy="{p[1]:.1f}" r="{node_r}" fill="{DEEP}" stroke="#FFFFFF" stroke-width="2.5"/>')
    body.append('</g>')  # end clip
    # ---- collision-aware label placement (8 directions x growing radius) ----
    origin=spec.get('origin','Auckland'); ret=spec.get('return_to',origin)
    lf=min(label_fs,20)
    placed=[]  # (x0,y0,x1,y1)
    node_boxes=[(px-15,py-15,px+15,py+15) for px,py in pts]
    node_boxes.append((x0,y1-46,x1,y1))  # reserve bottom strip (legend / breathing room)
    # reserve Taiwan label area if drawn
    for ring,labpt in [(TWN,(121.0,23.7))]:
        xs=[P(lo,la)[0] for lo,la in ring]; ys=[P(lo,la)[1] for lo,la in ring]
        if max(xs)>x0 and min(xs)<x1 and max(ys)>y0 and min(ys)<y1:
            lx,ly=P(*labpt); node_boxes.append((lx-64,ly-6,lx+2,ly+14))
    def overlap(a,b,pad=4):
        return not (a[2]+pad<b[0] or b[2]+pad<a[1-1] or a[3]+pad<b[1] or b[3]+pad<a[1])
    def hit(rect):
        for b in placed+node_boxes:
            if not (rect[2]<b[0] or b[2]<rect[0] or rect[3]<b[1] or b[3]<rect[1]):
                return True
        # keep within map box
        if rect[0]<x0+2 or rect[2]>x1-2 or rect[1]<y0+2 or rect[3]>y1-2:
            return True
        return False
    lbl=[]
    dirs=[(0,-1),(1,0),(-1,0),(0,1),(1,-1),(-1,-1),(1,1),(-1,1)]
    for i,(p,s) in enumerate(zip(pts,stops)):
        name=esc(s['city']); nights=s['nights']
        if i==start and i==finish: role=('START &amp; FINISH', f'&#9992; fly from {esc(origin)}')
        elif i==start: role=('START', f'&#9992; fly from {esc(origin)}')
        elif i==finish: role=('FINISH', f'&#9992; fly to {esc(ret)}')
        else: role=None
        lines=[(name,lf,DEEP,'800')]
        if nights: lines.append((nights,13,MUTED,'700'))
        if role: lines.append((role[0],13,RED,'800')); lines.append((role[1],12,MUTED,'600'))
        w=max(len(t)*fs*0.6 for t,fs,_,_ in lines)
        lh=[fs*1.28 for t,fs,_,_ in lines]; h=sum(lh)
        chosen=None
        for mult in (1.0,1.6,2.4,3.4,4.6,6.0):
            for dx,dy in dirs:
                r=(max(h,w)/2+18)*mult
                cxl=p[0]+dx*r; cyl=p[1]+dy*r
                rect=(cxl-w/2,cyl-h/2,cxl+w/2,cyl+h/2)
                if not hit(rect): chosen=(cxl,cyl,rect); break
            if chosen: break
        if not chosen:
            cxl=p[0]+22+w/2; cyl=p[1]; chosen=(cxl,cyl,(cxl-w/2,cyl-h/2,cxl+w/2,cyl+h/2))
        cxl,cyl,rect=chosen; placed.append(rect)
        # leader line if far
        if math.hypot(cxl-p[0],cyl-p[1])>28:
            lbl.append(f'<line x1="{p[0]:.0f}" y1="{p[1]:.0f}" x2="{cxl:.0f}" y2="{cyl:.0f}" stroke="#AEB9C4" stroke-width="1.2"/>')
        yy=rect[1]
        for (t,fs,col,wt),h1 in zip(lines,lh):
            yy+=h1
            lbl.append(f'<text x="{cxl:.0f}" y="{yy-4:.0f}" fill="{col}" font-size="{fs}" font-weight="{wt}" text-anchor="middle" paint-order="stroke" stroke="{halo}" stroke-width="4">{t}</text>')
    return f'<clipPath id="{clip_id}"><rect x="{x0}" y="{y0}" width="{x1-x0}" height="{y1-y0}" rx="10"/></clipPath>', '\n'.join(body+lbl)

def legend(x,y,modes,maxw=592):
    used=[]
    if 'train' in modes: used.append(('train','High-speed train'))
    if 'flight' in modes: used.append(('plane','Flight'))
    if 'cruise' in modes: used.append(('ship','River cruise'))
    if 'coach' in modes: used.append(('bus','Coach'))
    used.append(('arrowtxt','Direction'))
    # size to fit
    fs=15; gapc=18
    def total(fs,gapc):
        t=0
        for ic,label in used:
            t+= (0 if ic=='arrowtxt' else 20) + len(label)*fs*0.56 + gapc
        return t
    while total(fs,gapc)>maxw and fs>12:
        fs-=1; gapc-=2
    out=[]; cx=x
    for ic,label in used:
        if ic=='arrowtxt':
            out.append(f'<text x="{cx:.0f}" y="{y+5}" fill="{MUTED}" font-size="{fs}" font-weight="600">&#8594; {label}</text>')
            cx+=len(label)*fs*0.56+gapc
        else:
            out.append(f'<g transform="translate({cx:.0f},{y}) scale(0.68)"><use href="#{ic}"/></g>')
            out.append(f'<text x="{cx+15:.0f}" y="{y+5}" fill="{MUTED}" font-size="{fs}" font-weight="600">{label}</text>')
            cx+=20+len(label)*fs*0.56+gapc
    return '\n'.join(out)

def card(x,y,w,h,city,nights,acts,name_fs=27):
    n_act = 3 if h>=150 else 2 if h>=104 else 1 if h>=82 else 0
    compact = n_act==0
    out=[f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" fill="#FFFFFF" stroke="{CARDB}" stroke-width="1.5"/>',
         f'<rect x="{x}" y="{y}" width="6" height="{h}" rx="3" fill="{RED}"/>']
    nfs = name_fs if not compact else min(name_fs,22)
    name_y = y+h/2+nfs*0.35 if compact else y+38
    out.append(f'<text x="{x+32}" y="{name_y:.0f}" fill="{DEEP}" font-size="{nfs}" font-weight="800">{esc(city)}</text>')
    if nights:
        bw=104; bx=x+w-bw-18
        by=y+h/2-14 if compact else y+16
        out.append(f'<rect x="{bx}" y="{by:.0f}" width="{bw}" height="28" rx="6" fill="{DEEP}"/>')
        out.append(f'<text x="{bx+bw/2:.0f}" y="{by+19:.0f}" fill="#FFFFFF" font-size="13" font-weight="700" text-anchor="middle" letter-spacing="0.5">{esc(nights.upper())}</text>')
    if not compact:
        dy=y+52
        out.append(f'<line x1="{x+32}" y1="{dy}" x2="{x+w-18}" y2="{dy}" stroke="{DIV}" stroke-width="1.5"/>')
        ry=dy+26
        for a in acts[:n_act]:
            out.append(f'<circle cx="{x+38}" cy="{ry-5}" r="3.5" fill="{RED}"/><text x="{x+54}" y="{ry}" fill="{TEXT}" font-size="16">{esc(a)}</text>')
            ry+=27
    return '\n'.join(out)

def render_pc(spec):
    W,H=1200,850
    clip,mapbody=map_group(spec,(40,150,680,760),'mapClipPC')
    modes={s['mode'] for s in spec['segments']}
    stops=spec['stops']
    N=len(stops)
    col_x=715; col_w=445; col_y=150; col_h=610
    gap = 14 if N<=5 else 10 if N<=8 else 8
    ch=min(196,(col_h-(N-1)*gap)/N)
    cards=[]; y=col_y
    for s in stops:
        cards.append(card(col_x,y,col_w,ch,s['city'],s['nights'],s['activities']))
        y+=ch+gap
    svg=f'''<svg viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg" font-family="'Helvetica Neue', Arial, sans-serif">
{defs()}
<rect width="{W}" height="{H}" fill="#FFFFFF"/>
<rect x="0" y="0" width="{W}" height="124" fill="{DEEP}"/><rect x="0" y="124" width="{W}" height="6" fill="{RED}"/>
<text x="60" y="62" fill="#FFFFFF" font-size="{fit_fs(spec['title'],46,838):.0f}" font-weight="800" letter-spacing="2">{esc(spec['title'])}</text>
<text x="62" y="97" fill="{SUB}" font-size="21" font-weight="500">{esc(spec['subtitle'])}</text>
<rect x="918" y="24" width="242" height="76" rx="10" fill="#FFFFFF"/>
<image x="937" y="36" width="204" height="52" href="{LOGO}" preserveAspectRatio="xMidYMid meet"/>
<defs>{clip}</defs>
<rect x="40" y="150" width="640" height="610" rx="10" fill="{SEA}" stroke="#C7D6DF" stroke-width="1.5"/>
{mapbody}
{legend(64,738,modes)}
{''.join(cards)}
<line x1="40" y1="792" x2="1160" y2="792" stroke="#E0E0E0" stroke-width="1.5"/>
<text x="60" y="824" fill="{DEEP}" font-size="18" font-weight="700" font-style="italic">Experience The Real Asia</text>
<text x="1160" y="824" fill="{MUTED}" font-size="17" font-weight="600" text-anchor="end">0800 287 888 · ctstours.co.nz</text>
</svg>'''
    return svg

def render_mobile(spec):
    W=800
    stops=spec['stops']; N=len(stops)
    map_y0=178; map_h=512
    clip,mapbody=map_group(spec,(30,map_y0,770,map_y0+map_h),'mapClipM',halo=SEA)
    modes={s['mode'] for s in spec['segments']}
    # cards stacked full width
    cards=[]; cy=map_y0+map_h+50
    card_gap=16
    for s in stops:
        acts=s['activities']
        ch=150 if len(acts)>=3 else 124 if len(acts)==2 else 100 if len(acts)==1 else 74
        cards.append(card(30,cy,740,ch,s['city'],s['nights'],acts))
        cy+=ch+card_gap
    footer_y=cy+8; H=footer_y+64
    svg=f'''<svg viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg" font-family="'Helvetica Neue', Arial, sans-serif">
{defs()}
<rect width="{W}" height="{H}" fill="#FFFFFF"/>
<rect x="0" y="0" width="{W}" height="150" fill="{DEEP}"/><rect x="0" y="150" width="{W}" height="6" fill="{RED}"/>
<text x="40" y="70" fill="#FFFFFF" font-size="{fit_fs(spec['title'],40,500,0.60):.0f}" font-weight="800" letter-spacing="1.5">{esc(spec['title'])}</text>
<text x="42" y="104" fill="{SUB}" font-size="18" font-weight="500">{esc(spec['subtitle'])}</text>
<rect x="556" y="22" width="214" height="66" rx="9" fill="#FFFFFF"/>
<image x="573" y="32" width="180" height="46" href="{LOGO}" preserveAspectRatio="xMidYMid meet"/>
<defs>{clip}</defs>
<rect x="30" y="{map_y0}" width="740" height="{map_h}" rx="10" fill="{SEA}" stroke="#C7D6DF" stroke-width="1.5"/>
{mapbody}
{legend(60,map_y0+map_h+24,modes)}
{''.join(cards)}
<line x1="30" y1="{footer_y}" x2="770" y2="{footer_y}" stroke="#E0E0E0" stroke-width="1.5"/>
<text x="40" y="{footer_y+30}" fill="{DEEP}" font-size="17" font-weight="700" font-style="italic">Experience The Real Asia</text>
<text x="770" y="{footer_y+30}" fill="{MUTED}" font-size="16" font-weight="600" text-anchor="end">0800 287 888 · ctstours.co.nz</text>
</svg>'''
    return svg

if __name__=='__main__':
    import importlib.util
    spec_file=os.path.join(HERE,'specs.py')
    spec=importlib.util.spec_from_file_location('specs',spec_file)
    mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    outdir=os.path.join(HERE,'out'); os.makedirs(outdir,exist_ok=True)
    for key,s in mod.TOURS.items():
        open(os.path.join(outdir,f'{key}.svg'),'w').write(render_pc(s))
        open(os.path.join(outdir,f'{key}-mobile.svg'),'w').write(render_mobile(s))
        print('wrote', key)
