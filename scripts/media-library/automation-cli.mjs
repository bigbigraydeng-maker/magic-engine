import {readFileSync, mkdirSync, existsSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {createServer} from 'node:http';
import {Inngest} from 'inngest';
import {serve} from 'inngest/node';
import {discover,register,processJob,EVENT} from './automation.mjs';
import {syncCatalog} from './catalog-sync.mjs';
const [mode,rootArg,stateArg,envFile]=process.argv.slice(2);
if(!['scan','run-once','serve','watch','watch-local','status'].includes(mode)||!rootArg||!stateArg||!envFile)throw new Error('Usage: automation-cli.mjs scan|run-once|serve|watch|watch-local|status inbox state existing-env');
for(const line of readFileSync(envFile,'utf8').split(/\r?\n/)){
 const m=line.match(/^(OPENAI_API_KEY|CF_AIG_TOKEN|INNGEST_EVENT_KEY|INNGEST_SIGNING_KEY)=(.*)$/);
 if(m&&!process.env[m[1]])process.env[m[1]]=m[2].trim().replace(/^['"]|['"]$/g,'');
}
const root=resolve(rootArg),state=resolve(stateArg);mkdirSync(state,{recursive:true});
let studio=process.env.MEDIA_LIBRARY_ROOT?resolve(process.env.MEDIA_LIBRARY_ROOT):root;
while(!existsSync(join(studio,'99_Catalog','inventory.json'))&&resolve(studio,'..')!==studio)studio=resolve(studio,'..');
const updateCatalog=()=>existsSync(join(studio,'99_Catalog','inventory.json'))?syncCatalog(studio,state):null;
const client=new Inngest({id:'magic-engine-media-local',...(process.env.INNGEST_DEV==='1'?{isDev:true}:{} )});
const fn=client.createFunction({id:'local-media-tagging',retries:2,concurrency:{limit:1}},
 {event:EVENT},async({event,step})=>{
  const result=await step.run('observe-and-record',()=>processJob(root,state,event.data.id,{dryRun:process.env.MEDIA_INTAKE_DRY_RUN==='1'}));
  if(process.env.MEDIA_INTAKE_DRY_RUN!=='1')await step.run('sync-main-catalog',()=>updateCatalog());
  return {id:result.id,status:result.status,no_publish:true};
 });
async function scan(send){
 let count=0;
 for(const item of discover(root)){
  const job=register(root,state,item);
  if(!job||!['tagging_pending','tagging_failed'].includes(job.status))continue;
  if(mode==='run-once'){
   try{const result=await processJob(root,state,job.id,{dryRun:process.env.MEDIA_INTAKE_DRY_RUN==='1'});console.log(JSON.stringify({id:job.id,status:result.status,no_publish:true}));}
   finally{if(process.env.MEDIA_INTAKE_DRY_RUN!=='1')updateCatalog();}
   // Bounded live smoke: one actual model call per invocation.
   return;
  }
  const marker=join(state,job.id+'.sent');
  if(send&&!existsSync(marker)){
   await client.send({id:job.id,name:EVENT,data:{id:job.id}});
   const {writeFileSync}=await import('node:fs');writeFileSync(marker,'sent\n',{flag:'wx'});
  }
  count++;
 }
 if(process.env.MEDIA_INTAKE_DRY_RUN!=='1')updateCatalog();
 console.log(JSON.stringify({pending:count,no_publish:true}));
}
if(mode==='status'){
 const {readdirSync}=await import('node:fs');const statuses={};let missing=0;
 for(const name of readdirSync(state).filter(x=>/^[a-f0-9]{64}\.json$/.test(x))){
  const job=JSON.parse(readFileSync(join(state,name),'utf8'));statuses[job.status]=(statuses[job.status]??0)+1;
  if(!job.tags&&!job.metadata.tags)missing++;
 }
 console.log(JSON.stringify({statuses,content_tags_pending:missing,provider_blocked:existsSync(join(state,'provider-blocked.json')),no_publish:true}));
}else if(mode==='serve'){
 const handler=serve({client,functions:[fn]});
 createServer((req,res)=>req.url?.startsWith('/api/inngest')?handler(req,res):(res.statusCode=404,res.end())).listen(8391,'127.0.0.1',()=>console.log('Local Inngest receiver listening on8391'));
}else if(mode==='watch'||mode==='watch-local'){
 let running=false;
 const tick=async()=>{if(running)return;running=true;try{await scan(mode==='watch');}catch{console.error('Intake scan failed; records retained');}finally{running=false;}};
 await tick();setInterval(tick,30000);
}else await scan(false);
