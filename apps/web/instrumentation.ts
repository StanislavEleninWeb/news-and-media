/**
 * Next.js server instrumentation: error tracking for pages, API routes and
 * server actions. The Node-only code sits behind `NEXT_RUNTIME === 'nodejs'`
 * checks so it is compiled out of the edge (middleware) bundle.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initErrorReporting } = await import('@nm/core/errors');
    await initErrorReporting('web');
  }
}

export async function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routePath: string; routeType: string },
) {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { reportError } = await import('@nm/core/errors');
    reportError(error, {
      service: 'web',
      method: request.method,
      path: request.path,
      route: context.routePath,
      type: context.routeType,
    });
  }
}
