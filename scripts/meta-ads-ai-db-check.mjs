/** Disposable PostgreSQL boundary test. Never accepts a database URL. No production access. */
import { mkdtemp,readFile,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import pg from 'pg'
const bin=process.env.META_ADS_TEST_PG_BIN
if(!bin) throw new Error('Set META_ADS_TEST_PG_BIN to a local PostgreSQL bin directory; a fresh cluster will be created.')
const root=await mkdtemp(join(tmpdir(),'meta-ai-db-'))
const data=join(root,'data')
const run=(name,args)=>execFileSync(join(bin,name),args,{ stdio:'pipe' })
const clients=[]
let started=false,checks=0
async function connect(){ const c=new pg.Client({ host:root,port:5432,user:process.env.USER,database:'postgres' });await c.connect();clients.push(c);return c }
async function denied(c,sql,params=[]){ await assert.rejects(()=>c.query(sql,params));checks++ }
const a='10000000-0000-0000-0000-000000000001',b='10000000-0000-0000-0000-000000000002'
const ca='20000000-0000-0000-0000-000000000001',cb='20000000-0000-0000-0000-000000000002',ca2='20000000-0000-0000-0000-000000000003'
const grantSql=`INSERT INTO meta_ads_read_grants(client_id,connection_id,ad_account_id,principal_id,entitlement_revision)
 VALUES($1,$2,$3,$1,(SELECT revision FROM meta_ads_ai_pilot_entitlements WHERE client_id=$1)) RETURNING *`
try {
 run('initdb',['-D',data,'-A','trust','--encoding=UTF8','--locale=C'])
 run('pg_ctl',['-D',data,'-l',join(root,'postgres.log'),'-o',`-k ${root} -c listen_addresses=''`,'-w','start']);started=true
 const db=await connect()
 await db.query(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE TABLE clients(id uuid PRIMARY KEY,meta_ad_account_id text);
 CREATE TABLE client_meta_ad_accounts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),client_id uuid NOT NULL REFERENCES clients(id),ad_account_id text NOT NULL,UNIQUE(client_id,ad_account_id));`)
 await db.query(await readFile('supabase/migrations/20260603000001_platform_oauth_connections.sql','utf8'))
 await db.query(await readFile('supabase/migrations/20260627000001_p34_mcp_api_keys.sql','utf8'))
 await db.query(await readFile('supabase/migrations/20260913120000_client_binding_audit.sql','utf8'))
 await db.query(await readFile('supabase/migrations/20260920064556_meta_ads_ai_read_grants.sql','utf8'))
 await db.query(await readFile('supabase/migrations/20260920235723_meta_ads_ai_schema_forward_fix.sql','utf8'))
 await db.query(await readFile('supabase/migrations/20260921060122_meta_ads_ai_hosted_analysis.sql','utf8'))
 await db.query('INSERT INTO clients(id) VALUES($1),($2)',[a,b])
 await db.query(`INSERT INTO meta_ads_ai_pilot_entitlements(client_id,status,approved_by_email) VALUES($1,'active','approver@example.test'),($2,'active','approver@example.test')`,[a,b]);checks++
 const pauseRevision=(await db.query('SELECT revision FROM meta_ads_ai_pilot_entitlements WHERE client_id=$1',[a])).rows[0].revision
 await db.query("UPDATE meta_ads_ai_pilot_entitlements SET status='paused' WHERE client_id=$1",[a])
 await db.query("UPDATE meta_ads_ai_pilot_entitlements SET status='active' WHERE client_id=$1",[a])
 assert.equal((await db.query('SELECT revision FROM meta_ads_ai_pilot_entitlements WHERE client_id=$1',[a])).rows[0].revision,pauseRevision);checks++
 await denied(db,`UPDATE meta_ads_ai_pilot_entitlements SET starts_at=now(),expires_at=now()-interval '1 day' WHERE client_id=$1`,[b])
 await db.query(`INSERT INTO platform_oauth_connections(id,client_id,provider,access_token_enc,refresh_token_enc,token_expiry,account_id,display_name,scopes,purpose,authorizing_principal_id,entitlement_revision)
 VALUES($1,$2,'meta','cipher','',now()+interval '1 day','ads_user:1','test',ARRAY['ads_read'],'meta_ads_read',$2,(SELECT revision FROM meta_ads_ai_pilot_entitlements WHERE client_id=$2)),
 ($3,$4,'meta','cipher','',now()+interval '1 day','ads_user:2','test',ARRAY['ads_read'],'meta_ads_read',$4,(SELECT revision FROM meta_ads_ai_pilot_entitlements WHERE client_id=$4))`,[ca,a,cb,b])
 await db.query(`INSERT INTO platform_oauth_connections(id,client_id,provider,access_token_enc,refresh_token_enc,token_expiry,account_id,display_name,scopes,purpose,authorizing_principal_id,entitlement_revision)
 VALUES($1,$2,'meta','cipher','',now()+interval '1 day','ads_user:3','test',ARRAY['ads_read'],'meta_ads_read',$3,
 (SELECT revision FROM meta_ads_ai_pilot_entitlements WHERE client_id=$2))`,[ca2,a,b])
 const discoveryVersion=(await db.query('SELECT updated_at::text AS updated_at FROM platform_oauth_connections WHERE id=$1',[ca])).rows[0].updated_at
 assert.equal((await db.query('SELECT meta_ads_discovery_current($1,$2,$3,$4) AS allowed',[a,ca,a,discoveryVersion])).rows[0].allowed,true);checks++
 assert.equal((await db.query('SELECT meta_ads_discovery_current($1,$2,$3,$4) AS allowed',[a,ca,b,discoveryVersion])).rows[0].allowed,false);checks++
 await denied(db,grantSql,[a,cb,'act_1234567890'])
 const quarantined='20000000-0000-0000-0000-000000000004'
 await db.query(`INSERT INTO platform_oauth_connections(id,client_id,provider,access_token_enc,refresh_token_enc,token_expiry,account_id,display_name,scopes,status,purpose)
  VALUES($1,$2,'meta','legacy-cipher','',now()+interval '1 day','ads_user:4','legacy',ARRAY['ads_read'],'revoked','meta_ads_read')`,[quarantined,a])
 await denied(db,`UPDATE platform_oauth_connections SET status='active',authorizing_principal_id=$2,
  entitlement_revision=(SELECT revision FROM meta_ads_ai_pilot_entitlements WHERE client_id=$2) WHERE id=$1`,[quarantined,a])
 await db.query(`UPDATE platform_oauth_connections SET status='active',access_token_enc='fresh-cipher',authorizing_principal_id=$2,
  entitlement_revision=(SELECT revision FROM meta_ads_ai_pilot_entitlements WHERE client_id=$2) WHERE id=$1`,[quarantined,a]);checks++
 await denied(db,`UPDATE platform_oauth_connections SET access_token_enc='attacker-cipher',authorizing_principal_id=$2 WHERE id=$1`,[quarantined,b])
 const grant=(await db.query(grantSql,[a,ca,'act_1234567890'])).rows[0];checks++
 const requestKey='a'.repeat(64),secondKey='b'.repeat(64),thirdKey='c'.repeat(64)
 let reservation=(await db.query('SELECT meta_ads_reserve_sponsored_analysis($1,$2,$3,$4,$5,$6) AS result',
   [a,a,grant.id,requestKey,'2026-09-13','2026-09-19'])).rows[0].result
 assert.equal(reservation.reason,'sponsored_analysis_unavailable');checks++
 await db.query(`UPDATE meta_ads_ai_pilot_entitlements SET sponsored_analysis_enabled=true,
   sponsored_monthly_cap_usd=0.24,sponsored_analysis_reserve_usd=0.12 WHERE client_id=$1`,[a])
 reservation=(await db.query('SELECT meta_ads_reserve_sponsored_analysis($1,$2,$3,$4,$5,$6) AS result',
   [a,a,grant.id,requestKey,'2026-09-13','2026-09-19'])).rows[0].result
 assert.equal(reservation.reserved,true);assert.equal(reservation.idempotent,false);checks++
 const firstJob=reservation.job_id
 const duplicate=(await db.query('SELECT meta_ads_reserve_sponsored_analysis($1,$2,$3,$4,$5,$6) AS result',
   [a,a,grant.id,requestKey,'2026-09-13','2026-09-19'])).rows[0].result
 assert.equal(duplicate.idempotent,true);assert.equal(duplicate.job_id,firstJob);checks++
 const secondReservation=(await db.query('SELECT meta_ads_reserve_sponsored_analysis($1,$2,$3,$4,$5,$6) AS result',
   [a,a,grant.id,secondKey,'2026-09-13','2026-09-19'])).rows[0].result
 assert.equal(secondReservation.reserved,true);checks++
	 const exhausted=(await db.query('SELECT meta_ads_reserve_sponsored_analysis($1,$2,$3,$4,$5,$6) AS result',
	   [a,a,grant.id,thirdKey,'2026-09-13','2026-09-19'])).rows[0].result
	 assert.equal(exhausted.reason,'sponsored_budget_exhausted');checks++
	 assert.equal((await db.query('SELECT meta_ads_authorize_sponsored_analysis($1,$2,$3) AS allowed',
	   [a,a,firstJob])).rows[0].allowed,true);checks++
	 const finished=(await db.query(`SELECT meta_ads_finish_sponsored_analysis($1,$2,$3,'completed',0.01,'{}'::jsonb,'报告','model',10,5,NULL) AS ok`,
   [a,a,firstJob])).rows[0].ok
 assert.equal(finished,true);checks++
 await db.query(`SELECT meta_ads_finish_sponsored_analysis($1,$2,$3,'no_data',0,NULL,NULL,NULL,NULL,NULL,NULL)`,[a,a,secondReservation.job_id])
 reservation=(await db.query('SELECT meta_ads_reserve_sponsored_analysis($1,$2,$3,$4,$5,$6) AS result',
   [a,a,grant.id,thirdKey,'2026-09-13','2026-09-19'])).rows[0].result
 assert.equal(reservation.reserved,true);checks++
 const failedJob=reservation.job_id
 await db.query(`SELECT meta_ads_finish_sponsored_analysis($1,$2,$3,'failed',0,NULL,NULL,NULL,NULL,NULL,'provider_unavailable')`,[a,a,failedJob])
 const retried=(await db.query('SELECT meta_ads_reserve_sponsored_analysis($1,$2,$3,$4,$5,$6) AS result',
   [a,a,grant.id,thirdKey,'2026-09-13','2026-09-19'])).rows[0].result
 assert.equal(retried.reserved,true);assert.notEqual(retried.job_id,failedJob);checks++
 assert.equal((await db.query(`SELECT meta_ads_finish_sponsored_analysis($1,$2,$3,'completed',0.13,'{}'::jsonb,'bad','model',1,1,NULL) AS ok`,
   [a,a,retried.job_id])).rows[0].ok,false);checks++
 await db.query(`SELECT meta_ads_finish_sponsored_analysis($1,$2,$3,'completed',0.12,'{}'::jsonb,'报告','model',1,1,NULL)`,[a,a,retried.job_id])
 await db.query('UPDATE meta_ads_ai_pilot_entitlements SET sponsored_monthly_cap_usd=0.36 WHERE client_id=$1',[a])
	 const revokeRace=(await db.query('SELECT meta_ads_reserve_sponsored_analysis($1,$2,$3,$4,$5,$6) AS result',
	   [a,a,grant.id,'f'.repeat(64),'2026-09-13','2026-09-19'])).rows[0].result
	 await db.query("UPDATE platform_oauth_connections SET token_expiry=now()-interval '1 minute' WHERE id=$1",[ca])
	 assert.equal((await db.query('SELECT meta_ads_authorize_sponsored_analysis($1,$2,$3) AS allowed',
	   [a,a,revokeRace.job_id])).rows[0].allowed,false);checks++
 await db.query(`SELECT meta_ads_finish_sponsored_analysis($1,$2,$3,'completed',0.01,'{}'::jsonb,'不得保存','model',1,1,NULL)`,[a,a,revokeRace.job_id])
 const rejectedReport=(await db.query('SELECT status,report_markdown,error_code FROM meta_ads_ai_analysis_jobs WHERE id=$1',[revokeRace.job_id])).rows[0]
 assert.deepEqual(rejectedReport,{ status:'failed',report_markdown:null,error_code:'authorization_changed' });checks++
 await db.query("UPDATE platform_oauth_connections SET token_expiry=now()+interval '1 day' WHERE id=$1",[ca])
 const wrongPrincipal=(await db.query('SELECT meta_ads_reserve_sponsored_analysis($1,$2,$3,$4,$5,$6) AS result',
   [a,b,grant.id,'d'.repeat(64),'2026-09-13','2026-09-19'])).rows[0].result
 assert.equal(wrongPrincipal.reason,'authorization_changed');checks++
 const oldKey=(await db.query(`INSERT INTO client_api_keys(client_id,key_hash,key_prefix,name,scopes,expires_at,metadata)
  VALUES($1::uuid,'old-hash','me_live_old','Meta Ads read-only',ARRAY['meta:ads:read'],now()+interval '1 day',
  jsonb_build_object('meta_ads_grant_id',$2::text,'meta_ads_grant_revision',$3::text,'meta_ads_principal_id',$1::uuid::text,'meta_ads_entitlement_revision',$4::text)) RETURNING id`,
  [a,grant.id,grant.revision,grant.entitlement_revision])).rows[0].id
 assert.equal((await db.query('SELECT meta_ads_authorization_current($1,$2,$3) AS allowed',[a,oldKey,'act_1234567890'])).rows[0].allowed,true);checks++
 await denied(db,'UPDATE meta_ads_read_grants SET connection_id=$2,principal_id=$3 WHERE id=$1',[grant.id,ca2,b])
 await denied(db,`INSERT INTO meta_ads_read_grants(client_id,connection_id,ad_account_id,principal_id,entitlement_revision)
   VALUES($1,$2,$3,$4,(SELECT revision FROM meta_ads_ai_pilot_entitlements WHERE client_id=$1))
   ON CONFLICT(client_id,ad_account_id) DO UPDATE SET connection_id=EXCLUDED.connection_id,principal_id=EXCLUDED.principal_id`,[a,ca2,'act_1234567890',b])
 await denied(db,grantSql,[b,cb,'act_1234567890'])
 const oldEntitlement=(await db.query('SELECT revision FROM meta_ads_ai_pilot_entitlements WHERE client_id=$1',[a])).rows[0].revision
 await db.query("UPDATE meta_ads_ai_pilot_entitlements SET status='revoked' WHERE client_id=$1",[a])
 await db.query("UPDATE meta_ads_ai_pilot_entitlements SET status='active',expires_at=now()+interval '30 days' WHERE client_id=$1",[a])
 const renewedEntitlement=(await db.query('SELECT revision FROM meta_ads_ai_pilot_entitlements WHERE client_id=$1',[a])).rows[0].revision
 assert.notEqual(renewedEntitlement,oldEntitlement);checks++
 await denied(db,'UPDATE meta_ads_read_grants SET entitlement_revision=$2,revoked_at=NULL WHERE id=$1',[grant.id,renewedEntitlement])
 await db.query(`UPDATE platform_oauth_connections SET entitlement_revision=$2,access_token_enc='new-cipher' WHERE id=$1`,[ca,renewedEntitlement])
 const rebound=(await db.query('UPDATE meta_ads_read_grants SET connection_id=$2,entitlement_revision=$3,revoked_at=NULL WHERE id=$1 RETURNING *',[grant.id,ca,renewedEntitlement])).rows[0]
 assert.equal(rebound.entitlement_revision,renewedEntitlement);checks++
 assert.equal((await db.query('SELECT meta_ads_authorization_current($1,$2,$3) AS allowed',[a,oldKey,'act_1234567890'])).rows[0].allowed,false);checks++
 const newKey=(await db.query(`INSERT INTO client_api_keys(client_id,key_hash,key_prefix,name,scopes,expires_at,metadata)
  VALUES($1::uuid,'new-hash','me_live_new','Meta Ads read-only',ARRAY['meta:ads:read'],now()+interval '1 day',
  jsonb_build_object('meta_ads_grant_id',$2::text,'meta_ads_grant_revision',$3::text,'meta_ads_principal_id',$1::uuid::text,'meta_ads_entitlement_revision',$4::text)) RETURNING id`,
 [a,rebound.id,rebound.revision,rebound.entitlement_revision])).rows[0].id
 assert.equal((await db.query('SELECT meta_ads_authorization_current($1,$2,$3) AS allowed',[a,newKey,'act_1234567890'])).rows[0].allowed,true);checks++
 await db.query('ALTER TABLE platform_oauth_connections DISABLE TRIGGER meta_ads_connection_invalidate')
 await db.query("UPDATE platform_oauth_connections SET status='revoked' WHERE id=$1",[ca])
 assert.equal((await db.query('SELECT meta_ads_authorization_current($1,$2,$3) AS allowed',[a,newKey,'act_1234567890'])).rows[0].allowed,false);checks++
 assert.equal((await db.query('SELECT meta_ads_discovery_current($1,$2,$3,$4) AS allowed',[a,ca,a,discoveryVersion])).rows[0].allowed,false);checks++
 await db.query("UPDATE platform_oauth_connections SET status='active' WHERE id=$1",[ca])
 await db.query('ALTER TABLE platform_oauth_connections ENABLE TRIGGER meta_ads_connection_invalidate')
 for(const dirty of ['act_1234567890',' ACT_01234567890 ','１２３４５６７８９０','act-1234567890','12345\u200b67890','9876543210,1234567890']) {
   await denied(db,'INSERT INTO client_meta_ad_accounts(client_id,ad_account_id) VALUES($1,$2)',[b,dirty])
   await denied(db,'UPDATE clients SET meta_ad_account_id=$2 WHERE id=$1',[b,dirty])
 }
 await db.query(`UPDATE platform_oauth_connections SET status='revoked' WHERE id=$1`,[ca])
 const revoked=(await db.query('SELECT * FROM meta_ads_read_grants WHERE id=$1',[rebound.id])).rows[0]
 assert.ok(revoked.revoked_at);assert.notEqual(revoked.revision,rebound.revision);checks++
 assert.equal((await db.query('SELECT meta_ads_authorization_current($1,$2,$3) AS allowed',[a,newKey,'act_1234567890'])).rows[0].allowed,false);checks++
 await db.query(`UPDATE platform_oauth_connections SET status='active' WHERE id=$1`,[ca])
 assert.ok((await db.query('SELECT revoked_at FROM meta_ads_read_grants WHERE id=$1',[rebound.id])).rows[0].revoked_at);checks++
 await db.query('INSERT INTO client_meta_ad_accounts(client_id,ad_account_id) VALUES($1,$2)',[b,'ACT_0001234567890'])
 await denied(db,'UPDATE meta_ads_read_grants SET revoked_at=NULL WHERE id=$1',[rebound.id])
 // Legacy write first, public write blocked until commit, then denied with fresh state.
 const c1=await connect(),c2=await connect()
 await c1.query('BEGIN');await c1.query('UPDATE clients SET meta_ad_account_id=$2 WHERE id=$1',[b,'act_2234567890'])
 let settled=false
 const pending=c2.query(grantSql,[a,ca,'act_2234567890']).then(()=>{ settled=true;return true },()=>{ settled=true;return false })
 await new Promise(r=>setTimeout(r,100));assert.equal(settled,false);await c1.query('COMMIT');assert.equal(await pending,false);checks++
 // Public write first, legacy write blocked then rejected.
 await c1.query('BEGIN');await c1.query(grantSql,[a,ca,'act_3234567890'])
 const second=c2.query('UPDATE clients SET meta_ad_account_id=$2 WHERE id=$1',[b,'act_3234567890']).then(()=>true,()=>false)
 await new Promise(r=>setTimeout(r,100));await c1.query('COMMIT');assert.equal(await second,false);checks++
 // Two independent tenants cannot concurrently acquire one public account.
 await c1.query('BEGIN');await c1.query(grantSql,[a,ca,'act_4234567890'])
 const third=c2.query(grantSql,[b,cb,'act_4234567890']).then(()=>true,()=>false)
 await new Promise(r=>setTimeout(r,100));await c1.query('COMMIT');assert.equal(await third,false);checks++
 await db.query("UPDATE meta_ads_ai_pilot_entitlements SET starts_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE client_id=$1",[b])
 const expiredRevision=(await db.query('SELECT revision FROM meta_ads_ai_pilot_entitlements WHERE client_id=$1',[b])).rows[0].revision
 await db.query("UPDATE meta_ads_ai_pilot_entitlements SET expires_at=now()+interval '30 days' WHERE client_id=$1",[b])
 assert.notEqual((await db.query('SELECT revision FROM meta_ads_ai_pilot_entitlements WHERE client_id=$1',[b])).rows[0].revision,expiredRevision);checks++
 const workers=await Promise.all(Array.from({ length:5 },()=>connect()))
 const reservations=(await Promise.all(workers.map(async c=>{ const rows=[];for(let i=0;i<7;i++) rows.push(await c.query('SELECT meta_ads_reserve_read($1) AS allowed',[a]));return rows }))).flat()
 assert.equal(reservations.filter(r=>r.rows[0].allowed).length,30);checks++
 for(const role of ['anon','authenticated']) {
   await db.query(`SET ROLE ${role}`)
   for(const table of ['meta_ads_read_grants','meta_ads_ai_pilot_entitlements','meta_ads_oauth_states','meta_ads_read_limits','meta_ads_binding_lock','meta_ads_ai_sponsored_budgets','meta_ads_ai_analysis_jobs']) await denied(db,`SELECT * FROM ${table}`)
   await denied(db,'SELECT meta_ads_reserve_read($1)',[a]);await denied(db,'SELECT meta_ads_account_conflict($1,$2)',[a,'act_1234567890'])
   await denied(db,'SELECT meta_ads_authorization_current($1,$2,$3)',[a,newKey,'act_1234567890'])
	   await denied(db,'SELECT meta_ads_discovery_current($1,$2,$3,$4)',[a,ca,a,discoveryVersion])
	   await denied(db,'SELECT meta_ads_reserve_sponsored_analysis($1,$2,$3,$4,$5,$6)',[a,a,grant.id,'e'.repeat(64),'2026-09-13','2026-09-19'])
	   await denied(db,'SELECT meta_ads_authorize_sponsored_analysis($1,$2,$3)',[a,a,firstJob])
   await db.query('RESET ROLE')
 }
 // RLS itself still protects rows even if future ACLs accidentally grant table access.
 await db.query('GRANT SELECT,INSERT ON meta_ads_read_grants TO anon')
 await db.query('SET ROLE anon')
 assert.equal((await db.query('SELECT * FROM meta_ads_read_grants')).rowCount,0);checks++
 await denied(db,grantSql,[a,ca,'act_8234567890']);await db.query('RESET ROLE')
 // Repeatable-read contenders fail serialization rather than using stale ownership snapshots.
 await c2.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await c2.query('SELECT * FROM meta_ads_binding_lock')
 await c1.query('UPDATE clients SET meta_ad_account_id=$2 WHERE id=$1',[b,'act_5234567890'])
 await denied(c2,grantSql,[a,ca,'act_5234567890']);await c2.query('ROLLBACK')
 // Disconnect serialises with a pending grant and cannot leave it active after reconsent.
 await c1.query('BEGIN');const pendingGrant=(await c1.query(grantSql,[a,ca,'act_6234567890'])).rows[0]
 const disconnect=c2.query("UPDATE platform_oauth_connections SET status='revoked' WHERE id=$1",[ca])
 await new Promise(r=>setTimeout(r,100));await c1.query('COMMIT');await disconnect
 assert.ok((await db.query('SELECT revoked_at FROM meta_ads_read_grants WHERE id=$1',[pendingGrant.id])).rows[0].revoked_at);checks++
 await db.query("UPDATE platform_oauth_connections SET status='active' WHERE id=$1",[ca])
 assert.ok((await db.query('SELECT revoked_at FROM meta_ads_read_grants WHERE id=$1',[pendingGrant.id])).rows[0].revoked_at);checks++
 // State consumption uses DELETE RETURNING, not a check followed by delete.
 await db.query(`INSERT INTO meta_ads_oauth_states(state_hash,client_id,principal_id,entitlement_revision,browser_hash,expires_at)
  VALUES('hash',$1,$1,(SELECT revision FROM meta_ads_ai_pilot_entitlements WHERE client_id=$1),'browser',now()+interval '10 minutes')`,[a])
 const consumed=await Promise.all([c1,c2].map(c=>c.query(`DELETE FROM meta_ads_oauth_states WHERE state_hash='hash' AND principal_id=$1 AND browser_hash='browser' AND expires_at>now() RETURNING *`,[a])))
 assert.equal(consumed.reduce((n,r)=>n+r.rowCount,0),1);checks++
 // PostgREST .update().eq().select() receives [] for a missing row; callers must treat
 // that cardinality as failure instead of accepting error=null as a completed audit.
 assert.equal((await db.query("UPDATE client_binding_audit SET outcome='applied' WHERE id=gen_random_uuid() RETURNING id")).rowCount,0);checks++
 assert.equal((await db.query("UPDATE mcp_access_log SET ok=true,error_code=NULL WHERE id=gen_random_uuid() RETURNING id")).rowCount,0);checks++
 console.log(`PASS ${checks} isolated PostgreSQL boundary checks (grant/legacy races, RLS, RPC ACL, revoke, nonce, rate limit).`)
} finally {
 for(const c of clients) await c.end().catch(()=>{})
 if(started) run('pg_ctl',['-D',data,'-m','immediate','-w','stop'])
 await rm(root,{ recursive:true,force:true })
}
