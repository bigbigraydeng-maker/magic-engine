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
async function denied(c,sql,params=[],expected=null){
  await assert.rejects(()=>c.query(sql,params),error=>{
    if(expected){
      assert.equal(error.code,expected.code,`expected SQLSTATE ${expected.code}, got ${error.code}: ${error.message}`)
      if(expected.message) assert.ok(error.message.includes(expected.message),`expected message to include "${expected.message}", got "${error.message}"`)
    }
    return true
  });checks++
}
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
 // ── Handover: owner clear, grant revoke, history retention, old-key death, new OAuth ──
 const handoverClient='10000000-0000-0000-0000-000000000003'
 const handoverPrincipal='20000000-0000-0000-0000-000000000005'
 const handoverNewPrincipal='20000000-0000-0000-0000-000000000006'
 const handoverConnection='30000000-0000-0000-0000-000000000001'
 const backfillRevoked='30000000-0000-0000-0000-000000000002'
 const backfillActive='30000000-0000-0000-0000-000000000003'
 await db.query('INSERT INTO clients(id) VALUES($1)',[handoverClient])
 await db.query(`INSERT INTO meta_ads_ai_pilot_entitlements(client_id,status,approved_by_email)
   VALUES($1,'active','approver@example.test')`,[handoverClient])
 await db.query(`INSERT INTO platform_oauth_connections(id,client_id,provider,access_token_enc,refresh_token_enc,token_expiry,account_id,display_name,scopes,purpose,authorizing_principal_id,entitlement_revision)
   VALUES($1,$2,'meta','cipher-old','',now()+interval '1 day','ads_user:9','test',ARRAY['ads_read'],'meta_ads_read',$3,
   (SELECT revision FROM meta_ads_ai_pilot_entitlements WHERE client_id=$2))`,[handoverConnection,handoverClient,handoverPrincipal])
 // Seed the two rows the migration's backfill must distinguish, BEFORE it is loaded:
 // one already-revoked row that still carries an owner, and one active row.
 await db.query(`INSERT INTO platform_oauth_connections(id,client_id,provider,access_token_enc,refresh_token_enc,token_expiry,account_id,display_name,scopes,status,purpose,authorizing_principal_id,entitlement_revision)
   VALUES($1,$2,'meta','cipher-backfill','',now()+interval '1 day','ads_user:10','test',ARRAY['ads_read'],'revoked','meta_ads_read',$3,
   (SELECT revision FROM meta_ads_ai_pilot_entitlements WHERE client_id=$2))`,[backfillRevoked,handoverClient,handoverPrincipal])
 await db.query(`INSERT INTO platform_oauth_connections(id,client_id,provider,access_token_enc,refresh_token_enc,token_expiry,account_id,display_name,scopes,status,purpose,authorizing_principal_id,entitlement_revision)
   VALUES($1,$2,'meta','cipher-active','',now()+interval '1 day','ads_user:11','test',ARRAY['ads_read'],'active','meta_ads_read',$3,
   (SELECT revision FROM meta_ads_ai_pilot_entitlements WHERE client_id=$2))`,[backfillActive,handoverClient,handoverPrincipal])
 // Loaded only now, after every legacy boundary check above has run against the
 // pre-handover schema. Loading it earlier would drop the (client_id, ad_account_id)
 // unique that the old ON CONFLICT / grant-resurrection checks depend on.
 await db.query(await readFile('supabase/migrations/20260923093000_meta_ads_ai_handover.sql','utf8'))
 // Backfill cleared the revoked row's owner and left the active row untouched.
 assert.equal((await db.query('SELECT authorizing_principal_id FROM platform_oauth_connections WHERE id=$1',[backfillRevoked])).rows[0].authorizing_principal_id,null);checks++
 assert.equal((await db.query('SELECT authorizing_principal_id FROM platform_oauth_connections WHERE id=$1',[backfillActive])).rows[0].authorizing_principal_id,handoverPrincipal);checks++
 assert.equal((await db.query(`SELECT count(*)::int AS n FROM client_binding_audit
   WHERE binding_kind='meta_ads_read' AND actor_email='migration:20260923093000' AND previous_value=$1`,[backfillRevoked])).rows[0].n,1);checks++
 assert.equal((await db.query(`SELECT count(*)::int AS n FROM client_binding_audit
   WHERE binding_kind='meta_ads_read' AND actor_email='migration:20260923093000' AND previous_value=$1`,[backfillActive])).rows[0].n,0);checks++
 // The handover connection's owner is handoverPrincipal, not handoverClient, so the
 // shared grantSql (which pins principal_id to $1=client_id) would trip the
 // 'invalid read connection' guard. Use a principal-aware insert for this case only.
 const handoverGrantSql=`INSERT INTO meta_ads_read_grants(client_id,connection_id,ad_account_id,principal_id,entitlement_revision)
  VALUES($1,$2,$3,$4,(SELECT revision FROM meta_ads_ai_pilot_entitlements WHERE client_id=$1)) RETURNING *`
 const handoverGrant=(await db.query(handoverGrantSql,[handoverClient,handoverConnection,'act_9234567890',handoverPrincipal])).rows[0]
 const handoverKey=(await db.query(`INSERT INTO client_api_keys(client_id,key_hash,key_prefix,name,scopes,expires_at,metadata)
   VALUES($1::uuid,'handover-hash','me_live_handover','Meta Ads read-only',ARRAY['meta:ads:read'],now()+interval '1 day',
   jsonb_build_object('meta_ads_grant_id',$2::text,'meta_ads_grant_revision',$3::text,'meta_ads_principal_id',$4::uuid::text,'meta_ads_entitlement_revision',$5::text)) RETURNING id`,
   [handoverClient,handoverGrant.id,handoverGrant.revision,handoverPrincipal,handoverGrant.entitlement_revision])).rows[0].id
 assert.equal((await db.query('SELECT meta_ads_authorization_current($1,$2,$3) AS allowed',[handoverClient,handoverKey,'act_9234567890'])).rows[0].allowed,true);checks++
 // A historical analysis job must survive the handover untouched.
 const handoverJob=(await db.query(`INSERT INTO meta_ads_ai_analysis_jobs(client_id,principal_id,grant_id,grant_revision,connection_version,entitlement_revision,ad_account_id,idempotency_key,period_key,window_since,window_until,status,reserved_usd)
   VALUES($1,$2,$3,$4,now(),$5,'act_9234567890',$6,'2026-09','2026-09-01','2026-09-07','completed',0.12) RETURNING id`,
   [handoverClient,handoverPrincipal,handoverGrant.id,handoverGrant.revision,handoverGrant.entitlement_revision,'h'.repeat(64)])).rows[0].id
 // Disconnect: owner -> NULL on a revoked row is the one new allowed transition.
 await db.query(`UPDATE platform_oauth_connections SET status='revoked',authorizing_principal_id=NULL,updated_at=now() WHERE id=$1`,[handoverConnection]);checks++
 const cleared=(await db.query('SELECT status,authorizing_principal_id FROM platform_oauth_connections WHERE id=$1',[handoverConnection])).rows[0]
 assert.deepEqual(cleared,{ status:'revoked',authorizing_principal_id:null });checks++
 assert.ok((await db.query('SELECT revoked_at FROM meta_ads_read_grants WHERE id=$1',[handoverGrant.id])).rows[0].revoked_at);checks++
 assert.equal((await db.query('SELECT meta_ads_authorization_current($1,$2,$3) AS allowed',[handoverClient,handoverKey,'act_9234567890'])).rows[0].allowed,false);checks++
 assert.equal((await db.query('SELECT count(*)::int AS n FROM meta_ads_ai_analysis_jobs WHERE id=$1',[handoverJob])).rows[0].n,1);checks++
 // Direct owner swap on an active row is still refused. backfillActive is still
 // active with a non-null owner, so this is the real "no direct transfer" case.
 await denied(db,`UPDATE platform_oauth_connections SET authorizing_principal_id=$1 WHERE id=$2`,[handoverNewPrincipal,backfillActive],
   { code:'23514',message:'connection owner is immutable' })
 const untouched=(await db.query('SELECT status,authorizing_principal_id FROM platform_oauth_connections WHERE id=$1',[backfillActive])).rows[0]
 assert.deepEqual(untouched,{ status:'active',authorizing_principal_id:handoverPrincipal });checks++
 // Taking over without a fresh token is refused.
 await denied(db,`UPDATE platform_oauth_connections SET status='active',authorizing_principal_id=$1,
   entitlement_revision=(SELECT revision FROM meta_ads_ai_pilot_entitlements WHERE client_id=$2) WHERE id=$3`,
   [handoverNewPrincipal,handoverClient,handoverConnection],
   { code:'23514',message:'connection owner is immutable' })
 // A fresh OAuth (new ciphertext) may take over the same row.
 const takeover=(await db.query(`UPDATE platform_oauth_connections SET status='active',access_token_enc='cipher-new',authorizing_principal_id=$1,
   entitlement_revision=(SELECT revision FROM meta_ads_ai_pilot_entitlements WHERE client_id=$2) WHERE id=$3 RETURNING status,authorizing_principal_id`,
   [handoverNewPrincipal,handoverClient,handoverConnection]))
 assert.equal(takeover.rowCount,1);checks++
 assert.deepEqual(takeover.rows[0],{ status:'active',authorizing_principal_id:handoverNewPrincipal });checks++
 const newGrant=(await db.query(handoverGrantSql,[handoverClient,handoverConnection,'act_9234567890',handoverNewPrincipal])).rows[0]
 assert.notEqual(newGrant.id,handoverGrant.id);checks++
 assert.equal((await db.query('SELECT meta_ads_authorization_current($1,$2,$3) AS allowed',[handoverClient,handoverKey,'act_9234567890'])).rows[0].allowed,false);checks++
 // The new owner's own key is readable against the new grant.
 const newOwnerKey=(await db.query(`INSERT INTO client_api_keys(client_id,key_hash,key_prefix,name,scopes,expires_at,metadata)
   VALUES($1::uuid,'handover-new-hash','me_live_handover_new','Meta Ads read-only',ARRAY['meta:ads:read'],now()+interval '1 day',
   jsonb_build_object('meta_ads_grant_id',$2::text,'meta_ads_grant_revision',$3::text,'meta_ads_principal_id',$4::uuid::text,'meta_ads_entitlement_revision',$5::text)) RETURNING id`,
   [handoverClient,newGrant.id,newGrant.revision,handoverNewPrincipal,newGrant.entitlement_revision])).rows[0].id
 assert.equal((await db.query('SELECT meta_ads_authorization_current($1,$2,$3) AS allowed',[handoverClient,newOwnerKey,'act_9234567890'])).rows[0].allowed,true);checks++
 // The historical job keeps its original identity and is never rewritten by the handover.
 const keptJob=(await db.query('SELECT principal_id,grant_id,grant_revision,ad_account_id,status FROM meta_ads_ai_analysis_jobs WHERE id=$1',[handoverJob])).rows[0]
 assert.deepEqual(keptJob,{ principal_id:handoverPrincipal,grant_id:handoverGrant.id,grant_revision:handoverGrant.revision,
   ad_account_id:'act_9234567890',status:'completed' });checks++
 // Same-client and cross-client active conflicts still hold. The earlier legacy
 // checks rotated b's entitlement revision, so cb still carries the old one and
 // would fail with 'invalid read connection' before the conflict is even reached.
 // Realign cb to b's current revision first, then assert the real conflict reason.
 const realigned=(await db.query(`UPDATE platform_oauth_connections SET entitlement_revision=$2,access_token_enc='cipher-realign'
   WHERE id=$1 AND client_id=$3`,[cb,(await db.query('SELECT revision FROM meta_ads_ai_pilot_entitlements WHERE client_id=$1',[b])).rows[0].revision,b]))
 assert.equal(realigned.rowCount,1);checks++
 await denied(db,handoverGrantSql,[handoverClient,handoverConnection,'act_9234567890',handoverNewPrincipal],{ code:'23505' })
 await denied(db,grantSql,[b,cb,'act_9234567890'],{ code:'23514',message:'account unavailable' })
 console.log(`PASS ${checks} isolated PostgreSQL boundary checks (grant/legacy races, RLS, RPC ACL, revoke, nonce, rate limit, handover).`)
} finally {
 for(const c of clients) await c.end().catch(()=>{})
 if(started) run('pg_ctl',['-D',data,'-m','immediate','-w','stop'])
 await rm(root,{ recursive:true,force:true })
}
