export function buildProxyUrl(siteUrl: string) {
  const parsed = new URL(siteUrl);
  const origin = btoa(parsed.origin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const path = encodeProxyPath(parsed.pathname || "/");
  return `/proxy/u/${origin}${path}${parsed.search}`;
}

export function pagePathFromProxyUrl(proxyPath: string) {
  const match = proxyPath.match(/^\/proxy\/u\/[^/]+(\/[^?#]*)/);
  return decodeProxyPath(match?.[1] || "/");
}

function encodeProxyPath(path: string) {
  return path.endsWith("/") ? `${path}~` : path;
}

function decodeProxyPath(path: string) {
  return path.endsWith("/~") ? path.slice(0, -1) : path;
}
