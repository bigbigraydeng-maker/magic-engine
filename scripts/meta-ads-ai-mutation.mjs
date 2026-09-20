/** Targeted security mutation check, local checkout only. Restores every source in finally. */
import { readFile,writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
const mutations=[
 ['account allowlist','src/lib/meta/ai/read.ts',"if (args.account_id && args.account_id !== grant.ad_account_id)","if (false)"] ,
 ['explicit scope','src/lib/meta/ai/store.ts',"if (!principal.scopes.includes(META_ADS_SCOPE))","if (false)"],
 ['post-provider revocation','src/lib/meta/ai/read.ts','const finalGrant = await readGrant(principal)','const finalGrant = grant'],
 ['cursor binding','src/lib/meta/ai/read.ts','value.binding !== binding || ',''],
 ['GET-only transport','src/lib/meta/graph-read.ts',"method: 'GET'","method: 'POST'"],
 ['OAuth principal','src/lib/meta-oauth/ads-read.ts',".eq('principal_id',principalId)",""],
 ['pilot request gate','src/lib/meta/ai/read.ts','requireMetaScope(principal)\n  await requirePilotActive(principal.clientId)','requireMetaScope(principal)'],
 ['pilot result release gate','src/lib/meta/ai/read.ts','  await requirePilotActive(principal.clientId)\n  return { version:','  return { version:'],
 ['pilot audit release gate','src/lib/meta/ai/read.ts','    await finishReadAudit(requestId,null,result.meta.account_id)\n    await requirePilotActive(principal.clientId)','    await finishReadAudit(requestId,null,result.meta.account_id)'],
 ['OAuth owner scope','src/lib/meta/ai/store.ts',"if (principalId) query = query.eq('authorizing_principal_id', principalId)","if (false) query = query.eq('authorizing_principal_id', principalId)"],
 ['zero-row revoke','src/lib/meta/ai/manage.ts',"if (result.data?.length !== 1) throw new MetaReadError('disconnect_not_found',404)",""],
 ['legacy conflict guard','supabase/migrations/20260920064556_meta_ads_ai_read_grants.sql','IF public.meta_ads_account_conflict(NEW.client_id, NEW.ad_account_id) THEN','IF false THEN'],
 ['immutable grant owner','supabase/migrations/20260920064556_meta_ads_ai_read_grants.sql',"OR NEW.principal_id IS DISTINCT FROM OLD.principal_id) THEN","OR false) THEN"],
]
let killed=0
for(const [name,path,before,after] of mutations){
 const original=await readFile(path,'utf8')
 if(original.split(before).length!==2) throw new Error(`Mutation anchor is ambiguous: ${name}`)
 try {
  await writeFile(path,original.replace(before,after))
  const result=path.endsWith('.sql')
    ? spawnSync(process.execPath,['scripts/meta-ads-ai-db-check.mjs'],{ encoding:'utf8',timeout:45000 })
    : spawnSync('npm',['test','--','src/lib/meta/ai'],{ encoding:'utf8',timeout:45000 })
  if(result.error || result.signal) throw new Error(`Mutation test did not complete: ${name}`)
  if(result.status===0) throw new Error(`SURVIVED: ${name}`)
  const output=result.stdout+result.stderr
  if(path.endsWith('.sql') ? !output.includes('AssertionError') : !/Tests\s+\d+ failed/.test(output)) throw new Error(`Unrelated failure: ${name}`)
  killed++;console.log(`KILLED: ${name}`)
 } finally { await writeFile(path,original) }
}
console.log(`PASS ${killed}/${mutations.length} targeted security mutants killed; sources restored.`)
