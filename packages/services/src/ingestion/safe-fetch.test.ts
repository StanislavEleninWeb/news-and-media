import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { assertPublicUrl, isPrivateAddress, safeFetch } from './safe-fetch';

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.20.0.5',
    '192.168.1.1',
    '169.254.169.254',
    '::1',
    'fd00::1',
    '::ffff:10.0.0.1',
  ])('blocks %s', (ip) => expect(isPrivateAddress(ip)).toBe(true));
  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '2a00:1450:4001::1'])('allows %s', (ip) =>
    expect(isPrivateAddress(ip)).toBe(false),
  );
});

describe('assertPublicUrl', () => {
  it('rejects internal IP literals and non-http schemes', () => {
    expect(() => assertPublicUrl('http://127.0.0.1:5432/')).toThrow(/private/);
    expect(() => assertPublicUrl('http://[::1]/')).toThrow(/private/);
    expect(() => assertPublicUrl('file:///etc/passwd')).toThrow(/protocol/);
  });
  it('can be relaxed for tests', () => {
    expect(assertPublicUrl('http://127.0.0.1:1/', true)).toBeInstanceOf(URL);
  });
});

describe('safeFetch', () => {
  it('refuses hostnames that resolve to internal addresses at connect time', async () => {
    const server = createServer((_req, res) => res.end('internal secret'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const options = { userAgent: 'test', timeoutMs: 5_000 };
    try {
      // "localhost" passes the literal-IP check but resolves to 127.0.0.1.
      await expect(safeFetch(`http://localhost:${port}/`, options)).rejects.toThrow();
      const allowed = await safeFetch(`http://localhost:${port}/`, {
        ...options,
        allowPrivateNetwork: true,
      });
      expect(allowed.body.toString()).toBe('internal secret');
    } finally {
      server.close();
    }
  });
});
