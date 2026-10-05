/**
 * Maps a site path (as carried by push notifications and API cards) to an app
 * route, so a tap on a notification opens the story natively.
 *   /en/a/<uuid>/<slug>  → /article/<uuid>?locale=en
 *   /bg/t/<slug>         → /topic/<slug>?locale=bg
 *   anything else        → / (the feed)
 */
export function routeForPath(path: string | null | undefined): string {
  if (!path) return '/';
  let pathname: string;
  try {
    pathname = new URL(path, 'https://app.invalid').pathname;
  } catch {
    return '/';
  }
  const article = pathname.match(/^\/(bg|en)\/a\/([0-9a-f-]{36})(?:\/|$)/i);
  if (article) return `/article/${article[2]!.toLowerCase()}?locale=${article[1]}`;
  const topic = pathname.match(/^\/(bg|en)\/t\/([a-z0-9-]{1,64})\/?$/);
  if (topic) return `/topic/${topic[2]}?locale=${topic[1]}`;
  return '/';
}
