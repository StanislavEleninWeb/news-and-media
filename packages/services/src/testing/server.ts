import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export type Routes = Record<
  string,
  | { status?: number; type?: string; body: string | Buffer }
  | (() => { status?: number; type?: string; body: string | Buffer })
>;

/** Tiny HTTP server for tests; `hits` counts requests per path. */
export async function startFixtureServer(routes: Routes) {
  const hits = new Map<string, number>();
  const server: Server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]!;
    hits.set(path, (hits.get(path) ?? 0) + 1);
    const entry = routes[path];
    const route = typeof entry === 'function' ? entry() : entry;
    if (!route) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(route.status ?? 200, {
      'Content-Type': route.type ?? 'text/html; charset=utf-8',
    });
    res.end(route.body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    hits,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
