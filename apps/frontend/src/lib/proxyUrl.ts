export function buildProxyUrl(siteUrl: string) {
  const parsed = new URL(siteUrl);
  const origin = encodeURIComponent(parsed.origin);
  const path = parsed.pathname || "/";
  return `/proxy/u/${origin}${path}${parsed.search}`;
}

export function pagePathFromProxyUrl(proxyPath: string) {
  const match = proxyPath.match(/^\/proxy\/u\/[^/]+(\/[^?#]*)/);
  return match?.[1] || "/";
}
