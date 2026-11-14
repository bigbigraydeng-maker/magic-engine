# Grounded tour route specs. Cities/nights/transport from src/lib/data/tours.ts
# itinerary; activities from each tour's official highlights array.
C = {
 'Beijing':(39.9042,116.4074),"Xi'an":(34.3416,108.9398),'Shanghai':(31.2304,121.4737),
 'Suzhou':(31.2989,120.5853),'Wuxi':(31.4900,120.3119),'Xinshi':(30.63,120.03),
 'Hangzhou':(30.2741,120.1551),'Puyuan':(30.62,120.52),'Lanzhou':(36.0611,103.8343),
 'Wuwei':(37.9283,102.6380),'Zhangye':(38.9259,100.4498),'Jiayuguan':(39.7722,98.2894),
 'Dunhuang':(40.1421,94.6618),'Turpan':(42.9476,89.1841),'Urumqi':(43.8256,87.6168),
 'Chongqing':(29.5630,106.5516),'Chengdu':(30.5728,104.0668),'Dali':(25.6065,100.2676),
 'Kunming':(24.8801,102.8329),'Zhangjiajie':(29.1170,110.4790),'Guilin':(25.2736,110.2907),'Yangshuo':(24.7784,110.4903),
 'Guangzhou':(23.1291,113.2644),'Yangtze Cruise':(30.70,110.50),
}
def S(city,nights,acts,name=None):
    lat,lon=C[city]
    return {'city':name or city,'lat':lat,'lon':lon,'nights':nights,'activities':acts}

TOURS = {}

TOURS['beijing-xian'] = {
 'title':'A TALE OF TWO CITIES','subtitle':"10 Days · Beijing · Xi'an · Fully inclusive",
 'origin':'Auckland','gateway':0,
 'stops':[
   S('Beijing','4 nights',['Great Wall','Forbidden City & Tiananmen Square','Hutong pedi-cab & Temple of Heaven']),
   S("Xi'an",'3 nights',['Terracotta Warriors','City Wall & Big Wild Goose Pagoda','Muslim Quarter']),
 ],
 'segments':[{'a':0,'b':1,'mode':'train','off':48},{'a':1,'b':0,'mode':'flight','off':48}],
}

TOURS['shanghai-surroundings'] = {
 'title':'SHANGHAI & SURROUNDINGS','subtitle':'10 Days · Watertowns of the Yangtze Delta · Fully inclusive',
 'origin':'Auckland','gateway':0,
 'stops':[
   S('Shanghai','2 nights',['The Bund','City God Temple quarter','Nanjing Road']),
   S('Suzhou','1 night',['Master of the Nets Garden','Panmen','Shantang Street']),
   S('Wuxi','2 nights',['Three Kingdoms City','Li Garden & Taihu Lake','Silk factory']),
   S('Xinshi','1 night',['Hanfu dress-up photos','Thousand-year-old water town']),
   S('Hangzhou','1 night',['West Lake boat tour','Leifeng Pagoda','Meijiawu Longjing tea']),
 ],
 'segments':[{'a':0,'b':1,'mode':'coach','off':22},{'a':1,'b':2,'mode':'coach','off':-20},
             {'a':2,'b':3,'mode':'coach','off':22},{'a':3,'b':4,'mode':'coach','off':-18},
             {'a':4,'b':0,'mode':'train','off':30}],
}

TOURS['essentials'] = {
 'title':'BEST OF CHINA','subtitle':"15 Days · Beijing · Xi'an · Hangzhou · Shanghai · Fully inclusive",
 'origin':'Auckland','start_idx':0,'finish_idx':4,'return_to':'Auckland',
 'stops':[
   S('Beijing','4 nights',['Great Wall','Forbidden City & Temple of Heaven','Hutong pedi-cab & Silk Market']),
   S("Xi'an",'3 nights',['Terracotta Warriors','City Wall & Wild Goose Pagoda','Muslim Quarter']),
   S('Puyuan','1 night',['Fashion Ancient Town','Song-style waterways']),
   S('Hangzhou','1 night',['West Lake boat tour','Meijiawu Longjing tea','Qinghefang Ancient Street']),
   S('Shanghai','3 nights',['Yu Garden','The Bund & Lujiazui skyline','Nanjing Road']),
 ],
 'segments':[{'a':0,'b':1,'mode':'train','off':40},{'a':1,'b':2,'mode':'flight','off':46},
             {'a':2,'b':3,'mode':'coach','off':-18},{'a':3,'b':4,'mode':'train','off':22},
             {'a':4,'b':0,'mode':'flight','off':60}],
}

TOURS['silk-road'] = {
 'title':'SILK ROAD','subtitle':"18 Days · Xi'an to Urumqi · Fully inclusive",
 'origin':'Auckland (via Shanghai)','return_to':'Auckland (via Shanghai)',
 'start_idx':0,'finish_idx':7,
 'stops':[
   S("Xi'an",'3 nights',['Terracotta Warriors','Free day in Xi’an']),
   S('Lanzhou','2 nights',['Bingling Temple Grottoes by boat']),
   S('Wuwei','1 night',[]),
   S('Zhangye','1 night',['Zhangye Danxia rock formations']),
   S('Jiayuguan','1 night',['Jiayuguan Fortress','Hanging Great Wall']),
   S('Dunhuang','2 nights',['Mogao Caves','Mingsha Mountain & Crescent Spring']),
   S('Turpan','2 nights',['Jiaohe Ruins & Karez','Flaming Mountains','Bezeklik Caves']),
   S('Urumqi','3 nights',['Heavenly Lake (Tianchi)']),
 ],
 'segments':[{'a':0,'b':1,'mode':'train','off':30},{'a':1,'b':2,'mode':'coach','off':-24},
             {'a':2,'b':3,'mode':'coach','off':22},{'a':3,'b':4,'mode':'coach','off':-20},
             {'a':4,'b':5,'mode':'coach','off':22},{'a':5,'b':6,'mode':'train','off':-24},
             {'a':6,'b':7,'mode':'coach','off':22}],
}

_gt_cards = [
   S('Beijing','3 nights',['Juyongguan Great Wall','Forbidden City']),
   S("Xi'an",'3 nights',['Terracotta Warriors']),
   S('Yangtze Cruise','4 nights',['Three Gorges 5-star cruise']),
   S('Chengdu','1 night',['Giant panda breeding base']),
   S('Dali','2 nights',['Erhai Lake & old town']),
   S('Kunming','2 nights',['Stone Forest']),
   S('Guilin','2 nights',['Karst scenery']),
   S('Yangshuo','2 nights',['Li River cruise']),
   S('Shanghai','2 nights',['Huangpu River cruise & Bund']),
   S('Suzhou','1 night',["Humble Administrator's Garden"]),
   S('Hangzhou','2 nights',['West Lake & Longjing tea']),
]
# Modes follow the published itinerary (catalog v13). Hangzhou -> Shanghai is the
# airport transfer; the itinerary does not name the vehicle, drawn as coach.
# Guilin/Yangshuo and Shanghai/Suzhou/Hangzhou are too close to read at national
# scale, so the main map shows one hub each and a zoom inset shows the legs.
TOURS['grand-tour'] = {
 'title':'CHINA PANORAMA','subtitle':'27 Days · Grand tour of China · Fully inclusive',
 'origin':'Auckland','return_to':'Auckland','start_idx':0,'finish_idx':7,
 'cards':_gt_cards,
 'stops':[
   S('Beijing','3 nights',[]),
   S("Xi'an",'3 nights',[]),
   dict(S('Yangtze Cruise','4 nights',[]),lbl_off=(68,-14)),
   S('Chengdu','1 night',[]),
   S('Dali','2 nights',[]),
   dict(S('Kunming','2 nights',[]),lbl_off=(-4,44)),
   dict(S('Guilin','4 nights',[],name='Guilin & Yangshuo'),lbl_off=(30,48)),
   S('Shanghai','5 nights',[],name='Shanghai area'),
 ],
 'segments':[{'a':0,'b':1,'mode':'train','off':40},{'a':1,'b':2,'mode':'train','off':-40},
             {'a':2,'b':3,'mode':'train','off':-30},{'a':3,'b':4,'mode':'flight','off':30},
             {'a':4,'b':5,'mode':'coach','off':-20},{'a':5,'b':6,'mode':'train','off':40},
             {'a':6,'b':7,'mode':'flight','off':50}],
 'insets':[
   {'dx':12,'dy':14,'w':155,'h':152,'title':'GUILIN & YANGSHUO',
    'nodes':[('Guilin','2 nights',0.22,0.42),('Yangshuo','2 nights',0.78,0.42)],
    'segs':[(0,1,'cruise',-24),(1,0,'coach',-24)]},
   {'dx':179,'dy':14,'w':155,'h':152,'title':'SHANGHAI AREA',
    'nodes':[('Shanghai','2 nights',0.2,0.68),('Suzhou','1 night',0.5,0.36),('Hangzhou','2 nights',0.8,0.68)],
    'segs':[(0,1,'coach',-22),(1,2,'coach',-22),(2,0,'coach',-22)],'finish':0},
 ],
}


# China Panorama, October 2027 departure (route differs from the May departure: Chongqing and
# Chengdu get their own nights, Zhangjiajie replaces Yunnan, and the east runs
# Guilin -> Hangzhou -> Xinshi -> Suzhou -> Shanghai). Source: Baker's 3rd-draft itinerary
# (email 2026-11-12). Nights count hotel/cruise nights; modes follow that itinerary, and legs
# it does not name (Hangzhou -> Xinshi -> Suzhou -> Shanghai, Yangshuo -> Guilin) are drawn as coach.
_gt_oct_cards = [
   S('Beijing','3 nights',['Juyongguan Great Wall','Forbidden City']),
   S("Xi'an",'3 nights',['Terracotta Warriors']),
   S('Yangtze Cruise','4 nights',['Three Gorges 5-star cruise']),
   S('Chongqing','1 night',['Liziba light rail & Hongya Cave']),
   S('Chengdu','2 nights',['Giant panda breeding base']),
   S('Zhangjiajie','3 nights',['National Forest Park','Tianmen Mountain']),
   S('Guilin','2 nights',['Karst scenery']),
   S('Yangshuo','1 night',['Li River cruise']),
   S('Hangzhou','1 night',['West Lake cruise']),
   S('Xinshi','1 night',['Ancient town & Hanfu dress-up']),
   S('Suzhou','1 night',["Humble Administrator's Garden"]),
   S('Shanghai','2 nights',['The Bund & Yuyuan Garden']),
]
TOURS['grand-tour-oct-2027'] = {
 'title':'CHINA PANORAMA','subtitle':'27 Days · 16 October 2027 departure · Fully inclusive',
 'origin':'Auckland','return_to':'Auckland','start_idx':0,'finish_idx':7,
 'cards':_gt_oct_cards,
 'stops':[
   S('Beijing','3 nights',[]),
   S("Xi'an",'3 nights',[]),
   dict(S('Yangtze Cruise','4 nights',[]),lbl_off=(68,-14)),
   dict(S('Chongqing','1 night',[]),lbl_off=(-12,38)),
   dict(S('Chengdu','2 nights',[]),lbl_off=(-10,-30)),
   S('Zhangjiajie','3 nights',[]),
   dict(S('Guilin','3 nights',[],name='Guilin & Yangshuo'),lbl_off=(30,48)),
   S('Shanghai','5 nights',[],name='Shanghai area'),
 ],
 'segments':[{'a':0,'b':1,'mode':'train','off':40},{'a':1,'b':2,'mode':'train','off':-40},
             {'a':2,'b':3,'mode':'cruise','off':-24},{'a':3,'b':4,'mode':'train','off':26},
             {'a':4,'b':5,'mode':'train','off':-30},{'a':5,'b':6,'mode':'train','off':30},
             {'a':6,'b':7,'mode':'train','off':50}],
 'insets':[
   {'dx':12,'dy':14,'w':120,'h':152,'title':'GUILIN AREA',
    'nodes':[('Guilin','2 nights',0.24,0.42),('Yangshuo','1 night',0.76,0.42)],
    'segs':[(0,1,'cruise',-24),(1,0,'coach',-24)]},
   {'dx':140,'dy':14,'w':200,'h':152,'title':'SHANGHAI AREA',
    'nodes':[('Hangzhou','1 night',0.19,0.7),('Xinshi','1 night',0.34,0.34),('Suzhou','1 night',0.67,0.34),('Shanghai','2 nights',0.81,0.7)],
    'segs':[(0,1,'coach',-18),(1,2,'coach',-18),(2,3,'coach',-18)],'finish':3},
 ],
}

_icons_stops = [
   S('Guangzhou','1 night',['Yum Cha (dim sum)']),
   S('Shanghai','3 nights',['Xintiandi Christmas lighting','Bund Christmas Market','Zhujiajiao Watertown']),
   S('Beijing','4 nights',['Great Wall at Mutianyu','Forbidden City & Tiananmen','Summer Palace & Hutong']),
   S("Xi'an",'3 nights',['Terracotta Warriors',"New Year's Eve at Tang City",'City Wall & Muslim Quarter']),
   S('Chongqing','2 nights',['Hongyadong night view','Ciqikou','Liziba & Eye in the Clouds']),
]
_icons_segs = [{'a':0,'b':1,'mode':'flight','off':50},{'a':1,'b':2,'mode':'train','off':40},
               {'a':2,'b':3,'mode':'train','off':30},{'a':3,'b':4,'mode':'train','off':-24},
               {'a':4,'b':0,'mode':'flight','off':46}]

TOURS['china-icons-collection'] = {
 'title':'CHRISTMAS IN CHINA','subtitle':'16 Days · Christmas & New Year in China · Fully inclusive',
 'origin':'Auckland','gateway':0,'stops':_icons_stops,'segments':_icons_segs,
}
TOURS['china-icons-collection-christchurch'] = {
 'title':'CHRISTMAS IN CHINA','subtitle':'15 Days · Christmas & New Year · from Christchurch · Fully inclusive',
 'origin':'Christchurch','return_to':'Christchurch','gateway':0,'stops':_icons_stops,'segments':_icons_segs,
}
