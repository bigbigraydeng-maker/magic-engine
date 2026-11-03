"""Read-only health check of the two CTS Meta ad accounts (GET only, never writes).

Run:  python3 -I docs/clients/cts/handoff/2026-10-22-cts-meta-readonly-check.py
Reads the system-user token from the main checkout's .env.local inside this
process only; it never prints, logs or writes the token.
"""
import json
import urllib.error
import urllib.parse
import urllib.request

ENV_FILE = '/Users/raydeng/Projects/magic-engine/.env.local'
OFFICIAL = 'act_2202695063810470'  # "CTS" official account: live ads run here
OLD_PERSONAL = 'act_2775766642787274'  # "Pengyu Deng": unpaid, must stay unpaid
DAILY_CAP = 150.0  # ME rule: sum of set daily budgets, NZD

env = {}
for raw in open(ENV_FILE, encoding='utf-8'):
    raw = raw.strip()
    if raw and not raw.startswith('#') and '=' in raw:
        k, v = raw.split('=', 1)
        env[k] = v.strip().strip('"').strip("'")
TOKENS = [env.get(k) for k in ('META_SYSTEM_USER_TOKEN_CTSTOURS_CO_NZ', 'META_SYSTEM_USER_TOKEN') if env.get(k)]


def get(path, params):
    last = {'error': 'no token available'}
    for token in TOKENS:
        query = dict(params, access_token=token)
        url = 'https://graph.facebook.com/v21.0/%s?%s' % (path, urllib.parse.urlencode(query))
        try:
            with urllib.request.urlopen(url, timeout=30) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as err:
            try:
                last = {'error': json.load(err).get('error', {}).get('message', '')[:160]}
            except Exception:
                last = {'error': 'http %s' % err.code}
        except Exception as err:  # network problem
            last = {'error': str(err)[:160]}
    return last


def acts(row):
    return {a['action_type']: a['value'] for a in row.get('actions', []) if 'messaging' in a['action_type'] or 'thruplay' in a['action_type']}


print('== official account', OFFICIAL)
print(json.dumps(get(OFFICIAL, {'fields': 'name,account_status,disable_reason,currency,amount_spent,balance'}), ensure_ascii=False))
camps = get(OFFICIAL + '/campaigns', {'fields': 'id,name,effective_status,objective', 'limit': '100'})
for c in camps.get('data', []):
    print('C', c['id'], c['effective_status'], c.get('objective'), '|', c['name'][:70])
sets = get(OFFICIAL + '/adsets', {'fields': 'id,name,campaign_id,effective_status,daily_budget,optimization_goal', 'limit': '100', 'effective_status': json.dumps(['ACTIVE'])})
total = 0.0
for s in sets.get('data', []):
    budget = int(s.get('daily_budget') or 0) / 100
    total += budget
    print('S', s['id'], 'camp', s['campaign_id'], 'budget', budget, s.get('optimization_goal'), '|', s['name'][:60])
    for window in ('today', 'yesterday', 'last_3d'):
        ins = get(s['id'] + '/insights', {'fields': 'spend,impressions,actions', 'date_preset': window})
        for row in ins.get('data', []):
            print('   ', window, 'spend', row.get('spend'), 'impr', row.get('impressions'), acts(row))
    ads = get(s['id'] + '/ads', {'fields': 'id,name,effective_status', 'limit': '50'})
    for ad in ads.get('data', []):
        print('   A', ad['id'], ad['effective_status'], '|', ad['name'][:60])
print('ACTIVE ad sets', len(sets.get('data', [])), 'sum daily budget', total, 'cap', DAILY_CAP, 'OVER CAP!' if total > DAILY_CAP else 'ok')
acct_ins = get(OFFICIAL + '/insights', {'fields': 'spend', 'date_preset': 'last_3d', 'time_increment': '1'})
print('account spend by day:', [(d['date_start'], d['spend']) for d in acct_ins.get('data', [])])

print('== old personal account (must stay unpaid)', OLD_PERSONAL)
print(json.dumps(get(OLD_PERSONAL, {'fields': 'name,account_status,balance'}), ensure_ascii=False))
old_ins = get(OLD_PERSONAL + '/insights', {'fields': 'spend', 'date_preset': 'last_3d'})
print('old account spend last 3 days:', old_ins.get('data') or old_ins)
