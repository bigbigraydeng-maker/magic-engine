import type { LivePacingScope } from './types';

export type ScopeRefusal = { ok: false; code: 'cross_client'; message: string };
export type ScopeOk = { ok: true };

export function assertSameClient(scope: LivePacingScope, resourceClientId: string): ScopeOk | ScopeRefusal {
  if (scope.clientId.trim() === '' || resourceClientId.trim() === '') {
    return { ok: false, code: 'cross_client', message: '客户范围不明，拒绝计算。' };
  }
  if (scope.clientId !== resourceClientId) {
    return { ok: false, code: 'cross_client', message: '不能跨客户合并账户数据。' };
  }
  return { ok: true };
}
