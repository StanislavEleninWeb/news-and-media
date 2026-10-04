import { describe, expect, it } from 'vitest';
import { assertPublicUrl, isPrivateAddress } from './safe-fetch';

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
  it('rejects internal hosts and non-http schemes', async () => {
    await expect(assertPublicUrl('http://127.0.0.1:5432/')).rejects.toThrow(/private/);
    await expect(assertPublicUrl('http://[::1]/')).rejects.toThrow(/private/);
    await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow(/protocol/);
  });
  it('can be relaxed for tests', async () => {
    await expect(assertPublicUrl('http://127.0.0.1:1/', true)).resolves.toBeInstanceOf(URL);
  });
});
