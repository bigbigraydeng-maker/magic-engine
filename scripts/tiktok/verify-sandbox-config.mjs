import { readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { execFileSync } from 'node:child_process'
const require = createRequire(import.meta.url)
const ts = require('typescript')
const root = process.cwd()
const file = resolve(root, '.env.tiktok-sandbox.local')
if ((statSync(file).mode & 0o777) !== 0o600) throw new Error('Configuration file must be owner-only (0600)')
execFileSync('git', ['check-ignore', '.env.tiktok-sandbox.local'], { cwd:root,stdio:'ignore' })
const env = Object.fromEntries(readFileSync(file,'utf8').trim().split('\n').map(line => { const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)] }))
if (!env.TIKTOK_CLIENT_KEY || !env.TIKTOK_CLIENT_SECRET) throw new Error('Missing Sandbox configuration')
const code = ts.transpileModule(readFileSync(resolve(root,'src/lib/tiktok-oauth/client.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const exports = {}
runInNewContext(code,{exports,require,process:{env},Buffer,URLSearchParams,Date})
const state=exports.buildState('sandbox-config-check')
if (exports.verifyState(state)?.clientId !== 'sandbox-config-check') throw new Error('State signing failed')
if (exports.verifyState(state+'tampered') !== null) throw new Error('State tamper rejection failed')
const callback=env.NEXT_PUBLIC_APP_URL+'/api/auth/tiktok/callback'
const auth=new URL(exports.buildAuthUrl(state,callback))
if (auth.origin!=='https://www.tiktok.com' || auth.searchParams.get('redirect_uri')!==callback || auth.searchParams.get('client_key')!==env.TIKTOK_CLIENT_KEY) throw new Error('Authorization configuration mismatch')
console.log(JSON.stringify({configPresent:true,ownerOnlyPermissions:true,gitIgnored:true,actualOAuthCodeLoaded:true,stateSigning:true,tamperedStateRejected:true,callback,scopes:auth.searchParams.get('scope').split(','),providerRequests:0,runtimeDeployed:false}))
