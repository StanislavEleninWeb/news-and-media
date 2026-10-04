import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetConfig } from './config';
import { flushErrorReporting, initErrorReporting, reportError } from './errors';
import { buildEnvelope, parseDsn, parseStack } from './sentry-lite';

describe('sentry-lite', () => {
  it('derives the envelope endpoint and auth header from a DSN', () => {
    expect(parseDsn('https://abc123@o42.ingest.sentry.io/7')).toMatchObject({
      endpoint: 'https://o42.ingest.sentry.io/api/7/envelope/',
      auth: expect.stringContaining('sentry_key=abc123'),
    });
    expect(parseDsn('https://k@glitchtip.seweb.co/sub/3').endpoint).toBe(
      'https://glitchtip.seweb.co/sub/api/3/envelope/',
    );
    expect(() => parseDsn('https://glitchtip.seweb.co/3')).toThrow();
  });

  it('turns V8 stacks into frames, oldest first', () => {
    const frames = parseStack(
      'Error: x\n    at inner (/app/dist/index.js:10:5)\n    at /app/node_modules/lib/a.js:1:2\n    at node:internal/x:3:4',
    );
    expect(frames.map((f) => f.lineno)).toEqual([3, 1, 10]);
    expect(frames.at(-1)).toMatchObject({ function: 'inner', in_app: true });
    expect(frames[1]!.in_app).toBe(false);
  });

  it('builds a three-line envelope with environment and release', () => {
    const target = parseDsn('https://k@sentry.example/1');
    const [header, item, event] = buildEnvelope(target, new TypeError('boom'), {
      environment: 'staging',
      release: 'abc',
      serverName: 'worker',
    })
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(header.dsn).toBe(target.dsn);
    expect(item).toEqual({ type: 'event' });
    expect(event).toMatchObject({
      environment: 'staging',
      release: 'abc',
      exception: { values: [{ type: 'TypeError', value: 'boom' }] },
    });
  });
});

describe('reportError', () => {
  const received: { auth: string; body: string }[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ auth: String(req.headers['x-sentry-auth']), body });
      res.end('{}');
    });
  });
  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    process.env.SENTRY_DSN = `http://publickey@127.0.0.1:${(server.address() as AddressInfo).port}/9`;
    process.env.APP_ENV = 'test';
    resetConfig();
  });
  afterAll(() => {
    delete process.env.SENTRY_DSN;
    resetConfig();
    server.close();
  });

  it('delivers reported errors to the configured project', async () => {
    await initErrorReporting('worker');
    reportError(new Error('ingestion exploded'), { task: 'ingest' });
    await flushErrorReporting();
    expect(received).toHaveLength(1);
    expect(received[0]!.auth).toContain('sentry_key=publickey');
    const event = JSON.parse(received[0]!.body.split('\n')[2]!);
    expect(event).toMatchObject({
      environment: 'test',
      server_name: 'worker',
      tags: { service: 'worker', task: 'ingest' },
    });
  });
});
