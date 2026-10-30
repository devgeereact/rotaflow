import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient, type ApiClientOptions } from './apiClient';

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type Call = [string, RequestInit];

/** A fetch stand-in that records its calls. */
function stub(make: () => Response | Promise<Response>): {
  fetchImpl: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchImpl = ((url: string, init: RequestInit): Promise<Response> => {
    calls.push([url, init]);
    return Promise.resolve().then(make);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function client(
  fetchImpl: typeof fetch,
  extra: Partial<ApiClientOptions> = {},
): ReturnType<typeof createApiClient> {
  return createApiClient({
    baseUrl: '/api',
    getToken: () => Promise.resolve('tok_123'),
    fetchImpl,
    ...extra,
  });
}

function headersOf(call: Call | undefined): Record<string, string> {
  return (call?.[1].headers ?? {}) as Record<string, string>;
}

describe('apiClient', () => {
  it('sends the bearer token and never cookies', async () => {
    const { fetchImpl, calls } = stub(() => reply(200, { ok: true }));
    await client(fetchImpl).get('/me');
    expect(calls[0]?.[0]).toBe('/api/me');
    expect(headersOf(calls[0]).Authorization).toBe('Bearer tok_123');
    expect(calls[0]?.[1].credentials).toBe('omit');
  });

  it('sends no Authorization header when signed out', async () => {
    const { fetchImpl, calls } = stub(() => reply(200, {}));
    await createApiClient({
      baseUrl: '/api',
      getToken: () => Promise.resolve(null),
      fetchImpl,
    }).get('/health');
    expect(headersOf(calls[0]).Authorization).toBeUndefined();
  });

  it('builds a query string and drops undefined values', async () => {
    const { fetchImpl, calls } = stub(() => reply(200, {}));
    await client(fetchImpl).get('/orgs/x/members', {
      page: 2,
      q: undefined,
      active: true,
    });
    expect(calls[0]?.[0]).toBe('/api/orgs/x/members?page=2&active=true');
  });

  it('posts a JSON body and defaults to an empty object', async () => {
    const { fetchImpl, calls } = stub(() => reply(201, { id: 'a' }));
    const c = client(fetchImpl);
    await c.post('/orgs', { name: 'Acme' });
    await c.post('/orgs/x/transfer-ownership');
    expect(calls[0]?.[1].body).toBe('{"name":"Acme"}');
    expect(calls[1]?.[1].body).toBe('{}');
    expect(headersOf(calls[0])['Content-Type']).toBe('application/json');
  });

  it('turns the standard error body into an ApiError with the stable code', async () => {
    const { fetchImpl } = stub(() =>
      reply(409, { error: { code: 'invite_pending', message: 'Already invited' } }),
    );
    await expect(client(fetchImpl).post('/orgs/x/invites', {})).rejects.toMatchObject({
      name: 'ApiError',
      status: 409,
      code: 'invite_pending',
      message: 'Already invited',
    });
  });

  it('calls onUnauthorized on a 401 and still throws', async () => {
    const onUnauthorized = vi.fn();
    const { fetchImpl } = stub(() =>
      reply(401, { error: { code: 'unauthorized', message: 'Sign in required' } }),
    );
    await expect(client(fetchImpl, { onUnauthorized }).get('/me')).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('does not treat other errors as sign-out', async () => {
    const onUnauthorized = vi.fn();
    const { fetchImpl } = stub(() =>
      reply(403, { error: { code: 'forbidden', message: 'No' } }),
    );
    await expect(client(fetchImpl, { onUnauthorized }).get('/x')).rejects.toMatchObject({
      status: 403,
    });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('maps an unreadable error to http_error', async () => {
    const { fetchImpl } = stub(
      () => new Response('<html>Bad gateway</html>', { status: 502 }),
    );
    await expect(client(fetchImpl).get('/x')).rejects.toMatchObject({
      status: 502,
      code: 'http_error',
    });
  });

  it('maps a dropped connection to network', async () => {
    const { fetchImpl } = stub(() => {
      throw new TypeError('Failed to fetch');
    });
    await expect(client(fetchImpl).get('/x')).rejects.toMatchObject({
      status: 0,
      code: 'network',
    });
  });
});
