import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchCustomAudienceById, fetchCustomAudiences } from '../entity-settings';

const jsonResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as Response;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchCustomAudiences', () => {
  it('requests operation_status and delivery_status', async () => {
    const mock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    vi.stubGlobal('fetch', mock);

    await fetchCustomAudiences('act_1', 'token');

    expect(mock).toHaveBeenCalledTimes(1);
    const url = new URL(String(mock.mock.calls[0][0]));
    expect(url.pathname).toContain('/act_1/customaudiences');
    const fields = url.searchParams.get('fields') ?? '';
    expect(fields).toContain('operation_status{code}');
    expect(fields).toContain('delivery_status{code}');
    expect(fields).toContain('approximate_count_lower_bound');
  });

  it('returns rows with operation_status / delivery_status codes untouched', async () => {
    const mock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [
          {
            id: '111',
            name: 'A',
            approximate_count_lower_bound: 1000,
            operation_status: { code: 200 },
            delivery_status: { code: 200 },
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', mock);

    const result = await fetchCustomAudiences('act_1', 'token');

    expect(result.complete).toBe(true);
    expect(result.error).toBeNull();
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].operation_status?.code).toBe(200);
    expect(result.rows[0].delivery_status?.code).toBe(200);
  });

  it('follows paging.next until the last page', async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: '1' }],
          paging: { next: 'https://graph.facebook.com/next1' },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: '2' }] }));
    vi.stubGlobal('fetch', mock);

    const result = await fetchCustomAudiences('act_1', 'token');

    expect(result.rows.map((row) => row.id)).toEqual(['1', '2']);
    expect(result.complete).toBe(true);
    expect(mock).toHaveBeenCalledTimes(2);
    expect(String(mock.mock.calls[1][0])).toBe('https://graph.facebook.com/next1');
  });

  it('HTTP error -> complete false, error message, no rows', async () => {
    const mock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ error: { message: 'Invalid OAuth', code: 190 } }, 400),
      );
    vi.stubGlobal('fetch', mock);

    const result = await fetchCustomAudiences('act_1', 'token');

    expect(result.complete).toBe(false);
    expect(result.rows).toEqual([]);
    expect(result.error?.status).toBe(400);
    expect(result.error?.code).toBe(190);
    expect(result.error?.message).toBe('Invalid OAuth');
  });

  it('error on second page keeps first rows but complete false', async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: '1' }],
          paging: { next: 'https://graph.facebook.com/next1' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ error: { message: 'Rate limited', code: 4 } }, 500),
      );
    vi.stubGlobal('fetch', mock);

    const result = await fetchCustomAudiences('act_1', 'token');

    expect(result.complete).toBe(false);
    expect(result.rows.map((row) => row.id)).toEqual(['1']);
    expect(result.error?.status).toBe(500);
    expect(result.error?.code).toBe(4);
    expect(result.error?.message).toBe('Rate limited');
  });
});

describe('fetchCustomAudienceById', () => {
  it('reads one audience by id with account_id and status fields', async () => {
    const mock = vi.fn().mockResolvedValue(jsonResponse({ id: '123', account_id: '2775', name: 'x' }));
    vi.stubGlobal('fetch', mock);

    const res = await fetchCustomAudienceById('123', 'token');

    const url = new URL(String(mock.mock.calls[0][0]));
    expect(url.pathname.endsWith('/123')).toBe(true);
    const fields = url.searchParams.get('fields') ?? '';
    expect(fields).toContain('account_id');
    expect(fields).toContain('operation_status{code}');
    expect(res.complete).toBe(true);
    expect(res.rows[0]).toMatchObject({ id: '123', account_id: '2775' });
  });

  it('returns a failed read (not a fake row) when Graph errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: { message: 'nope', code: 100 } }, 400)));
    const res = await fetchCustomAudienceById('123', 'token');
    expect(res.complete).toBe(false);
    expect(res.rows).toHaveLength(0);
  });
});
