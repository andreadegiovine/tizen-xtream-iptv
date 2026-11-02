import { fetchJson } from '../../src/core/http.js';
import { ErrorCode } from '../../src/core/errors.js';

const ok = (body) => () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(body) });

describe('fetchJson', () => {
  test('parses JSON', async () => {
    await expect(fetchJson('http://x/a', { fetchImpl: ok('{"a":1}') })).resolves.toEqual({ a: 1 });
  });

  test('HTML instead of JSON becomes BAD_RESPONSE', async () => {
    await expect(fetchJson('http://x/a', { retries: 0, fetchImpl: ok('<html></html>') })).rejects.toMatchObject({
      code: ErrorCode.BAD_RESPONSE,
    });
  });

  test('retries 5xx once then succeeds', async () => {
    let calls = 0;
    const fetchImpl = () => {
      calls += 1;
      return calls === 1
        ? Promise.resolve({ ok: false, status: 503, text: () => Promise.resolve('') })
        : ok('{"ok":true}')();
    };
    await expect(fetchJson('http://x/a', { fetchImpl, retryDelayMs: 1 })).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  test('does not retry 4xx', async () => {
    let calls = 0;
    const fetchImpl = () => {
      calls += 1;
      return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') });
    };
    await expect(fetchJson('http://x/a', { fetchImpl })).rejects.toMatchObject({ code: ErrorCode.HTTP });
    expect(calls).toBe(1);
  });

  test('times out', async () => {
    const fetchImpl = (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    await expect(fetchJson('http://x/a', { fetchImpl, timeoutMs: 20, retries: 0 })).rejects.toMatchObject({
      code: ErrorCode.TIMEOUT,
    });
  });

  test('network failure becomes NETWORK and hides credentials', async () => {
    const fetchImpl = () => Promise.reject(new TypeError('Failed to fetch'));
    const error = await fetchJson('http://x/player_api.php?username=bob&password=secret', {
      fetchImpl,
      retries: 0,
    }).catch((e) => e);
    expect(error.code).toBe(ErrorCode.NETWORK);
    expect(JSON.stringify(error.details)).not.toContain('secret');
  });
});
