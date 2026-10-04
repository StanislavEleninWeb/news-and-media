import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '@nm/db';
import { writeHeartbeat } from '@nm/services/ops/heartbeat';
import { GET as workerHealth } from '@/app/api/health/worker/route';
import { setupApiTest } from './helpers';

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await setupApiTest());
});
afterAll(async () => close());

describe('GET /api/health/worker', () => {
  it('is 503 until the worker reports in, then 200', async () => {
    expect((await workerHealth()).status).toBe(503);
    await writeHeartbeat(db, { version: 'sha', env: 'test', tasks: [] });
    const response = await workerHealth();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok', version: 'sha' });
  });
});
