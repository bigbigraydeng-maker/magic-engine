/** Disposable compatibility test for the Meta Ads AI preview forward fix. */
import { mkdtemp,readFile,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import pg from 'pg'

const bin=process.env.META_ADS_TEST_PG_BIN
if(!bin) throw new Error('Set META_ADS_TEST_PG_BIN to a local PostgreSQL bin directory; a fresh cluster will be created.')
const root=await mkdtemp(join(tmpdir(),'meta-ai-forward-fix-'))
const data=join(root,'data')
const run=(name,args)=>execFileSync(join(bin,name),args,{ stdio:'pipe' })
const open=[]
let started=false,checks=0
const a='10000000-0000-0000-0000-000000000001',b='10000000-0000-0000-0000-000000000002'
const p1='30000000-0000-0000-0000-000000000001',p2='30000000-0000-0000-0000-000000000002'
const c1='20000000-0000-0000-0000-000000000001',c2='20000000-0000-0000-0000-000000000002'
const repairPath='supabase/migrations/20260920235723_meta_ads_ai_schema_forward_fix.sql'
const repairSql=await readFile(repairPath,'utf8')

async function connect(database) {
 const client=new pg.Client({ host:root,port:5432,user:process.env.USER,database })
 await client.connect();open.push(client);return client
}

async function foundation(database) {
 run('createdb',['-h',root,'-p','5432','-U',process.env.USER,database])
 const db=await connect(database)
 await db.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;
  CREATE TABLE clients(id uuid PRIMARY KEY,meta_ad_account_id text);
  CREATE TABLE client_meta_ad_accounts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),client_id uuid NOT NULL REFERENCES clients(id),ad_account_id text NOT NULL,UNIQUE(client_id,ad_account_id));`)
 await db.query(await readFile('supabase/migrations/20260603000001_platform_oauth_connections.sql','utf8'))
 await db.query(await readFile('supabase/migrations/20260627000001_p34_mcp_api_keys.sql','utf8'))
 await db.query(await readFile('supabase/migrations/20260913120000_client_binding_audit.sql','utf8'))
 await db.query(`ALTER TABLE platform_oauth_connections DROP CONSTRAINT platform_oauth_connections_provider_check;
  ALTER TABLE platform_oauth_connections ADD CONSTRAINT platform_oauth_connections_provider_check
   CHECK(provider IN ('google_gbp','google_gsc','meta','tiktok','google_ads','microsoft_mail','google_ga4','google_gtm'));
  ALTER TABLE client_binding_audit DROP CONSTRAINT client_binding_audit_binding_kind_check;
  ALTER TABLE client_binding_audit ADD CONSTRAINT client_binding_audit_binding_kind_check
   CHECK(binding_kind IN ('meta_ad_account','facebook_page','meta_ads_read'));
  SELECT 1;`)
 await db.query(await readFile('supabase/migrations/20260920064556_meta_ads_ai_read_grants.sql','utf8'))
 return db
}

const downgradeSql=`
DROP TRIGGER meta_ads_entitlement_revision ON meta_ads_ai_pilot_entitlements;
DROP TRIGGER meta_ads_grant_guard ON meta_ads_read_grants;
DROP TRIGGER meta_ads_connection_entitlement ON platform_oauth_connections;
DROP TRIGGER meta_ads_connection_invalidate ON platform_oauth_connections;
DROP FUNCTION meta_ads_authorization_current(uuid,uuid,text);
DROP FUNCTION meta_ads_discovery_current(uuid,uuid,uuid,timestamptz);
DROP FUNCTION meta_ads_connection_entitlement_guard();
DROP FUNCTION meta_ads_entitlement_revision_guard();
DROP FUNCTION meta_ads_active_entitlement(uuid,uuid);
CREATE OR REPLACE FUNCTION meta_ads_binding_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE tenant uuid; account text;
BEGIN
 UPDATE public.meta_ads_binding_lock SET revision=revision+1 WHERE id=true;
 IF TG_TABLE_NAME='meta_ads_read_grants' THEN
   NEW.revision:=gen_random_uuid();
   IF NEW.revoked_at IS NOT NULL THEN RETURN NEW; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.platform_oauth_connections c WHERE c.id=NEW.connection_id AND c.client_id=NEW.client_id
      AND c.purpose='meta_ads_read' AND c.provider='meta' AND c.status='active' AND c.token_expiry>now() AND 'ads_read'=ANY(c.scopes)) THEN
     RAISE EXCEPTION 'invalid read connection' USING ERRCODE='23514';
   END IF;
   IF public.meta_ads_account_conflict(NEW.client_id,NEW.ad_account_id) THEN
     RAISE EXCEPTION 'account unavailable' USING ERRCODE='23514';
   END IF;
 ELSE
   IF TG_TABLE_NAME='clients' THEN tenant:=NEW.id;account:=NEW.meta_ad_account_id;
   ELSE tenant:=NEW.client_id;account:=NEW.ad_account_id;END IF;
   IF EXISTS(SELECT 1 FROM public.meta_ads_read_grants g WHERE g.client_id<>tenant AND g.revoked_at IS NULL
      AND public.meta_ads_registered_match(account,g.ad_account_id)) THEN
     RAISE EXCEPTION 'account unavailable' USING ERRCODE='23514';
   END IF;
 END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER meta_ads_grant_guard BEFORE INSERT OR UPDATE ON meta_ads_read_grants FOR EACH ROW EXECUTE FUNCTION meta_ads_binding_guard();
CREATE OR REPLACE FUNCTION meta_ads_connection_changed() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF OLD.purpose='meta_ads_read' AND (OLD.access_token_enc IS DISTINCT FROM NEW.access_token_enc OR OLD.status IS DISTINCT FROM NEW.status) THEN
   UPDATE public.meta_ads_binding_lock SET revision=revision+1 WHERE id=true;
   UPDATE public.meta_ads_read_grants SET revoked_at=now() WHERE connection_id=OLD.id AND revoked_at IS NULL;
 END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER meta_ads_connection_invalidate AFTER UPDATE OF access_token_enc,status ON platform_oauth_connections
 FOR EACH ROW EXECUTE FUNCTION meta_ads_connection_changed();
ALTER TABLE platform_oauth_connections DROP CONSTRAINT meta_ads_connection_identity;
ALTER TABLE platform_oauth_connections ADD CONSTRAINT meta_ads_connection_identity
 CHECK(purpose<>'meta_ads_read' OR (provider='meta' AND account_id ~ '^ads_user:[0-9]+$'));
ALTER TABLE platform_oauth_connections DROP COLUMN authorizing_principal_id;
ALTER TABLE platform_oauth_connections DROP COLUMN entitlement_revision;
ALTER TABLE meta_ads_read_grants DROP COLUMN entitlement_revision;
ALTER TABLE meta_ads_oauth_states DROP COLUMN entitlement_revision;
DROP INDEX meta_ads_read_grants_client_idx;
DROP INDEX meta_ads_read_grants_connection_idx;
DROP INDEX meta_ads_oauth_states_client_expiry_idx;
DROP TABLE meta_ads_ai_pilot_entitlements;
`

async function makeLegacy(database) {
 const db=await foundation(database)
 await db.query(downgradeSql)
 return db
}

async function seedLegacy(db) {
 await db.query('INSERT INTO clients(id) VALUES($1),($2)',[a,b])
 await db.query(`INSERT INTO platform_oauth_connections(id,client_id,provider,access_token_enc,refresh_token_enc,token_expiry,account_id,display_name,scopes,purpose)
  VALUES($1,$3,'meta','old-token-a','',now()+interval '1 day','ads_user:1','old-a',ARRAY['ads_read'],'meta_ads_read'),
        ($2,$4,'meta','old-token-b','',now()+interval '1 day','ads_user:2','old-b',ARRAY['ads_read'],'meta_ads_read')`,[c1,c2,a,b])
 await db.query(`INSERT INTO meta_ads_read_grants(client_id,connection_id,ad_account_id,principal_id)
  VALUES($1,$2,'act_1234567890',$3),($1,$2,'act_2234567890',$4)`,[a,c1,p1,p2])
 await db.query(`INSERT INTO client_api_keys(client_id,key_hash,key_prefix,name,scopes,expires_at,metadata)
  VALUES($1,'legacy-hash','me_live_old','old',ARRAY['meta:ads:read'],now()+interval '1 day','{}')`,[a])
 await db.query(`INSERT INTO meta_ads_oauth_states(state_hash,client_id,principal_id,browser_hash,expires_at)
  VALUES('legacy-state',$1,$2,'browser',now()+interval '10 minutes')`,[a,p1])
}

async function testCurrentSchema() {
 const db=await foundation('current_schema')
 await db.query('INSERT INTO clients(id) VALUES($1)',[a])
 await db.query(`INSERT INTO meta_ads_ai_pilot_entitlements(client_id,status,approved_by_email) VALUES($1,'active','owner@example.test')`,[a])
 const revision=(await db.query('SELECT revision FROM meta_ads_ai_pilot_entitlements WHERE client_id=$1',[a])).rows[0].revision
 await db.query(`INSERT INTO platform_oauth_connections(id,client_id,provider,access_token_enc,refresh_token_enc,token_expiry,account_id,display_name,scopes,purpose,authorizing_principal_id,entitlement_revision)
  VALUES($1,$2,'meta','current-token','',now()+interval '1 day','ads_user:1','current',ARRAY['ads_read'],'meta_ads_read',$3,$4)`,[c1,a,p1,revision])
 const grant=(await db.query(`INSERT INTO meta_ads_read_grants(client_id,connection_id,ad_account_id,principal_id,entitlement_revision)
  VALUES($1,$2,'act_1234567890',$3,$4) RETURNING id,revision`,[a,c1,p1,revision])).rows[0]
 const key=(await db.query(`INSERT INTO client_api_keys(client_id,key_hash,key_prefix,name,scopes,expires_at,metadata)
  VALUES($1,'current-hash','me_live_cur','current',ARRAY['meta:ads:read'],now()+interval '1 day',
   jsonb_build_object('meta_ads_grant_id',$2::text,'meta_ads_grant_revision',$3::text,'meta_ads_principal_id',$4::text,'meta_ads_entitlement_revision',$5::text)) RETURNING id`,[a,grant.id,grant.revision,p1,revision])).rows[0]
 await db.query(repairSql);await db.query(repairSql)
 assert.equal((await db.query('SELECT status,revision FROM meta_ads_ai_pilot_entitlements WHERE client_id=$1',[a])).rows[0].status,'active');checks++
 assert.equal((await db.query('SELECT status FROM platform_oauth_connections WHERE id=$1',[c1])).rows[0].status,'active');checks++
 assert.equal((await db.query('SELECT revoked_at FROM client_api_keys WHERE id=$1',[key.id])).rows[0].revoked_at,null);checks++
 assert.equal((await db.query('SELECT meta_ads_authorization_current($1,$2,$3) allowed',[a,key.id,'act_1234567890'])).rows[0].allowed,true);checks++
}

async function testLegacyUpgrade() {
 const db=await makeLegacy('legacy_schema');await seedLegacy(db);await db.query(repairSql)
 assert.equal((await db.query("SELECT count(*)::int n FROM meta_ads_ai_pilot_entitlements WHERE status='paused'")).rows[0].n,2);checks++
 assert.equal((await db.query("SELECT count(*)::int n FROM platform_oauth_connections WHERE purpose='meta_ads_read' AND status='revoked' AND authorizing_principal_id IS NULL")).rows[0].n,2);checks++
 assert.equal((await db.query('SELECT count(*)::int n FROM meta_ads_read_grants')).rows[0].n,0);checks++
 assert.equal((await db.query('SELECT count(*)::int n FROM meta_ads_oauth_states')).rows[0].n,0);checks++
 assert.ok((await db.query("SELECT revoked_at FROM client_api_keys WHERE key_hash='legacy-hash'")).rows[0].revoked_at);checks++
 assert.equal((await db.query("SELECT count(*)::int n FROM client_binding_audit WHERE actor_email='migration:20260920235723'")).rows[0].n,3);checks++
 await db.query("UPDATE meta_ads_ai_pilot_entitlements SET status='active',expires_at=now()+interval '30 days',approved_by_email='owner@example.test' WHERE client_id=$1",[a])
 const revision=(await db.query('SELECT revision FROM meta_ads_ai_pilot_entitlements WHERE client_id=$1',[a])).rows[0].revision
 await assert.rejects(()=>db.query(`UPDATE platform_oauth_connections SET status='active',authorizing_principal_id=$2,entitlement_revision=$3 WHERE id=$1`,[c1,p1,revision]));checks++
 await db.query(`UPDATE platform_oauth_connections SET status='active',access_token_enc='fresh-token',authorizing_principal_id=$2,entitlement_revision=$3 WHERE id=$1`,[c1,p1,revision]);checks++
 await assert.rejects(()=>db.query(`UPDATE platform_oauth_connections SET access_token_enc='takeover-token',authorizing_principal_id=$2 WHERE id=$1`,[c1,p2]));checks++
 const grant=(await db.query(`INSERT INTO meta_ads_read_grants(client_id,connection_id,ad_account_id,principal_id,entitlement_revision)
  VALUES($1,$2,'act_1234567890',$3,$4) RETURNING id,revision`,[a,c1,p1,revision])).rows[0]
 const key=(await db.query(`INSERT INTO client_api_keys(client_id,key_hash,key_prefix,name,scopes,expires_at,metadata)
  VALUES($1,'fresh-hash','me_live_new','fresh',ARRAY['meta:ads:read'],now()+interval '1 day',
   jsonb_build_object('meta_ads_grant_id',$2::text,'meta_ads_grant_revision',$3::text,'meta_ads_principal_id',$4::text,'meta_ads_entitlement_revision',$5::text)) RETURNING id`,[a,grant.id,grant.revision,p1,revision])).rows[0]
 assert.equal((await db.query('SELECT meta_ads_authorization_current($1,$2,$3) allowed',[a,key.id,'act_1234567890'])).rows[0].allowed,true);checks++
 await db.query(repairSql)
 assert.equal((await db.query('SELECT meta_ads_authorization_current($1,$2,$3) allowed',[a,key.id,'act_1234567890'])).rows[0].allowed,true);checks++
}

async function testPartialSchemaRejected() {
 const db=await foundation('partial_schema')
 await db.query('DROP TRIGGER meta_ads_entitlement_revision ON meta_ads_ai_pilot_entitlements; DROP FUNCTION meta_ads_entitlement_revision_guard() CASCADE;')
 await assert.rejects(()=>db.query(repairSql));await db.query('ROLLBACK');checks++
 assert.ok((await db.query("SELECT to_regclass('public.meta_ads_ai_pilot_entitlements') present")).rows[0].present);checks++
}

async function testRollback() {
 const db=await makeLegacy('rollback_schema');await seedLegacy(db)
 await db.query('CREATE POLICY unsafe_anon ON meta_ads_read_grants FOR SELECT TO anon USING(true)')
 await assert.rejects(()=>db.query(repairSql));await db.query('ROLLBACK');checks++
 assert.equal((await db.query("SELECT status FROM platform_oauth_connections WHERE id=$1",[c1])).rows[0].status,'active');checks++
 assert.equal((await db.query('SELECT count(*)::int n FROM meta_ads_read_grants')).rows[0].n,2);checks++
 assert.equal((await db.query("SELECT revoked_at FROM client_api_keys WHERE key_hash='legacy-hash'")).rows[0].revoked_at,null);checks++
 assert.equal((await db.query('SELECT count(*)::int n FROM meta_ads_oauth_states')).rows[0].n,1);checks++
 assert.equal((await db.query("SELECT count(*)::int n FROM information_schema.columns WHERE table_name='platform_oauth_connections' AND column_name='authorizing_principal_id'")).rows[0].n,0);checks++
}

try {
 run('initdb',['-D',data,'-A','trust','--encoding=UTF8','--locale=C'])
 run('pg_ctl',['-D',data,'-l',join(root,'postgres.log'),'-o',`-k ${root} -c listen_addresses=''`,'-w','start']);started=true
 const admin=await connect('postgres')
 await admin.query('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;')
 await testCurrentSchema();await testLegacyUpgrade();await testPartialSchemaRejected();await testRollback()
 console.log(`PASS ${checks} Meta Ads AI schema compatibility checks (current, legacy preview, repeat, partial reject, rollback).`)
} finally {
 for(const client of open) await client.end().catch(()=>{})
 if(started) run('pg_ctl',['-D',data,'-m','immediate','-w','stop'])
 await rm(root,{ recursive:true,force:true })
}
