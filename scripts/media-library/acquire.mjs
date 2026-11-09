// Trusted operator source request. No scraping, login, stock API credential or public posting.
import {readFileSync,existsSync,mkdirSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {resolve,join,extname} from 'node:path';
import {createHash} from 'node:crypto';
import {referenceOnly,save} from './automation.mjs';
const [rootArg,requestFile]=process.argv.slice(2);
if(!rootArg||!requestFile)throw new Error('Usage: acquire.mjs inbox-batch source-request.json');
const root=resolve(rootArg),request=JSON.parse(readFileSync(requestFile,'utf8'));
mkdirSync(root,{recursive:true});
if(referenceOnly(request)){
 const id=createHash('sha256').update(String(request.source_url)).digest('hex');
 save(join(root,'reference-'+id+'.json'),{...request,status:'reference_only',eligible_for_automatic_selection:false,no_publish:true});
 console.log(JSON.stringify({status:'reference_only',downloaded:false}));process.exit(0);
}
const url=new URL(request.download_url);
const hosts=['images.unsplash.com','images.pexels.com','videos.pexels.com','upload.wikimedia.org','cdn.pixabay.com'];
if(url.protocol!=='https:'||url.username||url.password||!hosts.includes(url.hostname))throw new Error('Use a verified public original from allowed stock host');
const extension=extname(url.pathname).toLowerCase() ||
  (url.hostname==='images.unsplash.com'&&url.searchParams.get('fm')==='jpg'?'.jpg':'');
if(!['.mp4','.mov','.webm','.ogv','.jpg','.jpeg','.png','.webp'].includes(extension))throw new Error('Unsupported original');
const name=createHash('sha256').update(request.source_url+'\n'+url.href).digest('hex').slice(0,24)+extension;
const folder=join(root,'originals');mkdirSync(folder,{recursive:true});
const file=join(folder,name),metadataFile=join(root,'collection-record.json');
let existing=existsSync(metadataFile)?JSON.parse(readFileSync(metadataFile,'utf8')):{schema_version:1,record_type:'collection_sidecar_not_runtime_catalog',assets:[]};
if(existing.assets.some(a=>a.file_path==='originals/'+name)){console.log(JSON.stringify({status:'already_registered'}));process.exit(0);}
if(!existsSync(file)){
 const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(600000)});
 if(!response.ok)throw new Error('Original download failed HTTP '+response.status);
 const tmp=file+'.partial';let length=0;
 try{
  writeFileSync(tmp,Buffer.alloc(0),{flag:'wx'});
  const {appendFileSync}=await import('node:fs');
  for await(const chunk of response.body){length+=chunk.length;if(length>512*1024*1024)throw new Error('Original exceeds local acquisition limit');appendFileSync(tmp,chunk);}
  if(!length)throw new Error('Empty original');renameSync(tmp,file);
 }catch(error){if(existsSync(tmp))unlinkSync(tmp);throw error;}
}
const {download_url,...source}=request;
existing=existsSync(metadataFile)?JSON.parse(readFileSync(metadataFile,'utf8')):existing;
if(existing.assets.some(a=>a.file_path==='originals/'+name)){console.log(JSON.stringify({status:'already_registered'}));process.exit(0);}
existing.assets.push({...source,file_path:'originals/'+name,collected_on:new Date().toISOString().slice(0,10),tagging_status:'pending',eligible_for_automatic_selection:false,no_publish:true});
save(metadataFile,existing);console.log(JSON.stringify({status:'acquired_pending_auto_tags',file:name,no_publish:true}));
