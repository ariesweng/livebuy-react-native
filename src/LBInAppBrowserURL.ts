/**
 * Scheme guard for {@link LivebuySDK.openInAppBrowser}
 * (`rn-open-in-app-browser-scheme-guard-core`).
 *
 * `openInAppBrowser` is the only native URL-opening sink JS can reach. An in-app
 * browser (iOS `SFSafariViewController` / Android Chrome Custom Tabs) can only show
 * web pages: iOS raises an uncatchable exception for any other scheme, and Android
 * Custom Tabs carries no package, so a non-web scheme would become an implicit
 * ACTION_VIEW that another app could handle. Only `http` / `https` URLs with a host
 * are browsable; `mailto` / `tel` / `sms` (which {@link LBURLOpenPolicy} routes to
 * `external`) are **not** — they are not in-app-browser schemes.
 *
 * Rule (kept identical to the Android bridge's `InAppBrowserUrlPolicy`):
 *   1. the string starts with an RFC 3986 scheme followed by `:` (no leading whitespace);
 *   2. that scheme, case-insensitively, is `http` or `https`;
 *   3. the scheme is followed by exactly `//`;
 *   4. the authority (up to the first `/`, `?` or `#`), minus any `userinfo@` and
 *      `:port`, leaves a non-empty host.
 */

const SCHEME_PATTERN = /^([A-Za-z][A-Za-z0-9+.-]*):/;
const WEB_SCHEMES: ReadonlySet<string> = new Set(['http', 'https']);

function hostOf(afterSlashes: string): string {
  const end = afterSlashes.search(/[/?#]/);
  const authority = end < 0 ? afterSlashes : afterSlashes.slice(0, end);
  const hostPort = authority.slice(authority.lastIndexOf('@') + 1);
  if (hostPort.startsWith('[')) {
    const close = hostPort.indexOf(']');
    return close > 1 ? hostPort.slice(1, close) : '';
  }
  const colon = hostPort.indexOf(':');
  return (colon < 0 ? hostPort : hostPort.slice(0, colon)).trim();
}

/** `true` only for `http(s)://` URLs with a non-empty host. */
export function isInAppBrowsableUrl(url: unknown): boolean {
  if (typeof url !== 'string') return false;
  const match = SCHEME_PATTERN.exec(url);
  if (match === null) return false;
  if (!WEB_SCHEMES.has(match[1].toLowerCase())) return false;
  const rest = url.slice(match[0].length);
  if (!rest.startsWith('//')) return false;
  return hostOf(rest.slice(2)) !== '';
}
