import {readFileSync,readdirSync,existsSync,writeFileSync,unlinkSync} from 'node:fs';
import {resolve,join,relative,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {save,within} from './automation.mjs';

export function projectJob(root,job){
  const file=within(root,job.file),b=job.basic_tags,m=job.metadata;
  const contentTags=job.status==='tagged_pending_review'?job.tags:m.tags??{subject:['unclassified'],shot_type:'unknown',action:'unknown',season:'unknown',people_present:'unknown'};
  return {relative_path:relative(root,file).split('\\').join('/'),sha256:job.hash,size_bytes:job.size_bytes,
    kind:['.mp4','.mov','.webm','.ogv'].includes(extname(file).toLowerCase())?'video':'image',scope:m.scope??'unclassified',company:m.company??null,
    source_group_id:m.source_group??job.id,width:b.width,height:b.height,duration_seconds:b.duration_seconds,
    native_aspect:b.orientation,source:m.source??'unknown',source_url:m.source_url??null,
    author_or_rightsholder:m.author_or_rightsholder??null,license_evidence:m.license_evidence??null,
    role:job.status==='reference_only'?'reference':'source_candidate',review_status:'pending',rights_status:'pending',location_status:'pending',
    crop_review:'pending',technical_status:'probed',eligible_for_automatic_selection:false,runtime_registered:false,
    tags:contentTags,tagging_status:job.status,tagging_evidence:job.tagging_evidence??m.tagging_evidence??null,
    suggested_location:job.suggested_location??null,source_location:m.location??null,
    channels_suggested:m.channels_suggested??[],parent_file_path:m.parent_file_path??null,
    generation:m.generation??null,automation_job_id:job.id};
}
export function mergeCatalog(existing,incoming){
  const assets=[...existing.assets];let added=0,updated=0;
  for(const next of incoming){
    const index=assets.findIndex(x=>x.relative_path===next.relative_path);
    if(index<0){assets.push(next);added++;continue;}
    const old=assets[index];
    if(old.sha256!==next.sha256||old.scope!==next.scope||old.company!==next.company)throw new Error('Catalogue ownership/content conflict');
    // Keep reviewed rights, source identity, usage history and production flags.
    assets[index]={...old,tags:next.tags??old.tags,tagging_status:next.tagging_status,tagging_evidence:next.tagging_evidence,
      automation_job_id:next.automation_job_id};updated++;
  }
  return {catalog:{...existing,assets},added,updated};
}
export function syncCatalog(root,state){
  const catalogFile=join(root,'99_Catalog','inventory.json'),lock=catalogFile+'.sync-lock';
  writeFileSync(lock,String(process.pid),{flag:'wx'});
  try{
    const jobs=readdirSync(state).filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).map(n=>JSON.parse(readFileSync(join(state,n),'utf8')));
    const current=JSON.parse(readFileSync(catalogFile,'utf8'));
    const result=mergeCatalog(current,jobs.map(job=>projectJob(root,job)));
    const backup=catalogFile+'.before-intake-sync.json';if(!existsSync(backup))writeFileSync(backup,JSON.stringify(current,null,2)+'\n',{flag:'wx'});
    save(catalogFile,result.catalog);
    return {added:result.added,updated:result.updated,total:result.catalog.assets.length,no_publish:true,runtime_uploads:0};
  }finally{unlinkSync(lock);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(!process.argv[2]||!process.argv[3])throw new Error('Usage: catalog-sync.mjs studio-root state');
  console.log(JSON.stringify(syncCatalog(resolve(process.argv[2]),resolve(process.argv[3]))));
}
