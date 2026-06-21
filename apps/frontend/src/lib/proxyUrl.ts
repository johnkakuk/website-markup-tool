export function buildProxyUrl(siteUrl: string) {
  const parsed = new URL(siteUrl);
  const origin = btoa(parsed.origin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const path = parsed.pathname || "/";
  return `/proxy/u/${origin}${path}${parsed.search}`;
}

export function pagePathFromProxyUrl(proxyPath: string) {
  const match = proxyPath.match(/^\/proxy\/u\/[^/]+(\/[^?#]*)/);
  return match?.[1] || "/";
}
