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
const ca='20000000-0000-0000-0000-000000000001',cb='20000000-0000-0000-0000-000000000002'
const grantSql=`INSERT INTO meta_ads_read_grants(client_id,connection_id,ad_account_id,principal_id) VALUES($1,$2,$3,$1) RETURNING *`
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
 await db.query('INSERT INTO clients(id) VALUES($1),($2)',[a,b])
 await db.query(`INSERT INTO platform_oauth_connections(id,client_id,provider,access_token_enc,refresh_token_enc,token_expiry,account_id,display_name,scopes,purpose)
 VALUES($1,$2,'meta','cipher','',now()+interval '1 day','ads_user:1','test',ARRAY['ads_read'],'meta_ads_read'),($3,$4,'meta','cipher','',now()+interval '1 day','ads_user:2','test',ARRAY['ads_read'],'meta_ads_read')`,[ca,a,cb,b])
 await denied(db,grantSql,[a,cb,'act_1234567890'])
 const grant=(await db.query(grantSql,[a,ca,'act_1234567890'])).rows[0];checks++
 await denied(db,grantSql,[b,cb,'act_1234567890'])
 for(const dirty of ['act_1234567890',' ACT_01234567890 ','１２３４５６７８９０','act-1234567890','12345\u200b67890','9876543210,1234567890']) {
   await denied(db,'INSERT INTO client_meta_ad_accounts(client_id,ad_account_id) VALUES($1,$2)',[b,dirty])
   await denied(db,'UPDATE clients SET meta_ad_account_id=$2 WHERE id=$1',[b,dirty])
 }
 await db.query(`UPDATE platform_oauth_connections SET status='revoked' WHERE id=$1`,[ca])
 const revoked=(await db.query('SELECT * FROM meta_ads_read_grants WHERE id=$1',[grant.id])).rows[0]
 assert.ok(revoked.revoked_at);assert.notEqual(revoked.revision,grant.revision);checks++
 await db.query(`UPDATE platform_oauth_connections SET status='active' WHERE id=$1`,[ca])
 assert.ok((await db.query('SELECT revoked_at FROM meta_ads_read_grants WHERE id=$1',[grant.id])).rows[0].revoked_at);checks++
 await db.query('INSERT INTO client_meta_ad_accounts(client_id,ad_account_id) VALUES($1,$2)',[b,'ACT_0001234567890'])
 await denied(db,'UPDATE meta_ads_read_grants SET revoked_at=NULL WHERE id=$1',[grant.id])
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
 const workers=await Promise.all(Array.from({ length:5 },()=>connect()))
 const reservations=(await Promise.all(workers.map(async c=>{ const rows=[];for(let i=0;i<7;i++) rows.push(await c.query('SELECT meta_ads_reserve_read($1) AS allowed',[a]));return rows }))).flat()
 assert.equal(reservations.filter(r=>r.rows[0].allowed).length,30);checks++
 for(const role of ['anon','authenticated']) {
   await db.query(`SET ROLE ${role}`)
   for(const table of ['meta_ads_read_grants','meta_ads_oauth_states','meta_ads_read_limits','meta_ads_binding_lock']) await denied(db,`SELECT * FROM ${table}`)
   await denied(db,'SELECT meta_ads_reserve_read($1)',[a]);await denied(db,'SELECT meta_ads_account_conflict($1,$2)',[a,'act_1234567890'])
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
 await db.query(`INSERT INTO meta_ads_oauth_states VALUES('hash',$1,$1,'browser',now()+interval '10 minutes')`,[a])
 const consumed=await Promise.all([c1,c2].map(c=>c.query(`DELETE FROM meta_ads_oauth_states WHERE state_hash='hash' AND principal_id=$1 AND browser_hash='browser' AND expires_at>now() RETURNING *`,[a])))
 assert.equal(consumed.reduce((n,r)=>n+r.rowCount,0),1);checks++
 console.log(`PASS ${checks} isolated PostgreSQL boundary checks (grant/legacy races, RLS, RPC ACL, revoke, nonce, rate limit).`)
} finally {
 for(const c of clients) await c.end().catch(()=>{})
 if(started) run('pg_ctl',['-D',data,'-m','immediate','-w','stop'])
 await rm(root,{ recursive:true,force:true })
}
