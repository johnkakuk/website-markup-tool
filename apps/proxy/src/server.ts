import { createClient } from "@supabase/supabase-js";
import compression from "compression";
import cors from "cors";
import "dotenv/config";
import express from "express";
import { responseInterceptor, createProxyMiddleware } from "http-proxy-middleware";
import ipaddr from "ipaddr.js";
import morgan from "morgan";
import { lookup } from "node:dns/promises";
import type { IncomingMessage, ServerResponse } from "node:http";

type ProxiedRequest = IncomingMessage & {
  originalUrl?: string;
  params?: {
    origin?: string;
  };
};

const app = express();
const port = Number(process.env.PORT || 8787);
const corsOrigin = process.env.CORS_ORIGIN || "http://localhost:5173";
const isProduction = process.env.NODE_ENV === "production";
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
const supabaseAdmin =
  supabaseUrl && supabaseSecretKey
    ? createClient(supabaseUrl, supabaseSecretKey, {
        auth: { autoRefreshToken: false, persistSession: false }
      })
    : null;
const approvedOriginCache = new Map<string, number>();
const publicHostnameCache = new Map<string, number>();

if (isProduction && !supabaseAdmin) {
  throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required in production.");
}

app.use(compression());
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(morgan("dev"));

app.get("/health", (_request, response) => {
  response.json({ ok: true });
});

app.use("/proxy/u/:origin", async (request, response, next) => {
  if (!(["GET", "HEAD"] as string[]).includes(request.method)) {
    response.status(405).json({ error: "Only GET and HEAD requests are supported." });
    return;
  }

  try {
    const targetOrigin = decodeTargetOrigin(request.params.origin);
    await assertPublicTarget(targetOrigin);
    await assertRegisteredOrigin(targetOrigin);
    next();
  } catch (error) {
    console.error("Proxy target rejected:", error);
    response.status(403).json({ error: "This proxy target is not approved." });
  }
});

app.use(
  "/proxy/u/:origin",
  createProxyMiddleware({
    target: "https://example.com",
    changeOrigin: true,
    secure: process.env.PROXY_ALLOW_INSECURE_TLS !== "true",
    selfHandleResponse: true,
    router: (request) => {
      return decodeTargetOrigin(getOriginParam(request));
    },
    pathRewrite: (path, request) => {
      const originParam = getOriginParam(request);
      const stripped = path.replace(new RegExp(`^/proxy/u/${escapeRegExp(originParam)}`), "");
      return stripped || "/";
    },
    on: {
      proxyReq: (proxyRequest) => {
        proxyRequest.setHeader("accept-encoding", "identity");
      },
      proxyRes: responseInterceptor(async (responseBuffer, proxyResponse, request, response) => {
        stripFrameBlockingHeaders(response);
        rewriteRedirect(proxyResponse.headers.location, request, response);

        const contentType = String(proxyResponse.headers["content-type"] || "");
        if (!isRewritableContentType(contentType)) {
          return responseBuffer;
        }

        const body = responseBuffer.toString("utf8");
        const targetOrigin = decodeTargetOrigin(getOriginParam(request));
        const proxyRoot = getProxyRoot(targetOrigin);

        if (!contentType.includes("text/html")) {
          return rewriteProxiedUrls(body, targetOrigin, proxyRoot);
        }

        const proxiedBase = getProxiedBaseUrl(targetOrigin, getTargetPath(request));
        const rewrittenBody = rewriteProxiedUrls(body, targetOrigin, proxyRoot);
        return injectBaseTag(stripMetaContentSecurityPolicy(rewrittenBody), proxiedBase);
      })
    }
  })
);

app.use((_request, response) => {
  response.status(404).json({ error: "Not found" });
});

app.listen(port, () => {
  console.log(`Proxy listening on http://localhost:${port}`);
});

function stripFrameBlockingHeaders(response: ServerResponse) {
  response.removeHeader("x-frame-options");
  response.removeHeader("content-security-policy");
  response.removeHeader("content-security-policy-report-only");
  response.removeHeader("cross-origin-opener-policy");
  response.removeHeader("cross-origin-embedder-policy");
  response.removeHeader("cross-origin-resource-policy");
  response.removeHeader("set-cookie");
  response.removeHeader("clear-site-data");
}

function rewriteRedirect(
  location: string | string[] | undefined,
  request: IncomingMessage,
  response: ServerResponse
) {
  const redirectLocation = Array.isArray(location) ? location[0] : location;
  if (!redirectLocation) {
    return;
  }

  const targetOrigin = decodeTargetOrigin(getOriginParam(request));
  const nextUrl = new URL(redirectLocation, `${targetOrigin}${getTargetPath(request)}`);
  response.setHeader(
    "location",
    `/proxy/u/${encodeTargetOrigin(nextUrl.origin)}${nextUrl.pathname}${nextUrl.search}`
  );
}

function injectBaseTag(html: string, proxiedBase: string) {
  const baseTag = `<base href="${proxiedBase}">`;
  if (/<base\s/i.test(html)) {
    return html.replace(/<base[^>]*>/i, baseTag);
  }

  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
  }

  return `${baseTag}${html}`;
}

function rewriteProxiedUrls(content: string, targetOrigin: string, proxyRoot: string) {
  const sameOriginUrl = new RegExp(`${escapeRegExp(targetOrigin)}/`, "g");

  return content
    .replace(sameOriginUrl, `${proxyRoot}/`)
    .replace(/(["'`])\/(?!\/|proxy\/u\/)/g, `$1${proxyRoot}/`)
    .replace(/(url\(\s*["']?)\/(?!\/|proxy\/u\/)/gi, `$1${proxyRoot}/`)
    .replace(/(\b(?:src|href|action|poster)=)\/(?!\/|proxy\/u\/)/gi, `$1${proxyRoot}/`);
}

function stripMetaContentSecurityPolicy(html: string) {
  return html.replace(
    /<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi,
    ""
  );
}

function isRewritableContentType(contentType: string) {
  return [
    "text/html",
    "text/css",
    "text/javascript",
    "application/javascript",
    "application/json"
  ].some((type) => contentType.includes(type));
}

function getProxyRoot(targetOrigin: string) {
  return `/proxy/u/${encodeTargetOrigin(targetOrigin)}`;
}

function getProxiedBaseUrl(targetOrigin: string, requestPath: string) {
  const parsed = new URL(requestPath, targetOrigin);
  const directory = parsed.pathname.endsWith("/")
    ? parsed.pathname
    : parsed.pathname.slice(0, parsed.pathname.lastIndexOf("/") + 1);

  return `${getProxyRoot(parsed.origin)}${directory}`;
}

function decodeTargetOrigin(value: string | undefined) {
  if (!value) {
    throw new Error("Missing proxy origin.");
  }

  const legacyDecoded = decodeURIComponent(value);
  const decoded = legacyDecoded.startsWith("http")
    ? legacyDecoded
    : Buffer.from(value, "base64url").toString("utf8");
  const parsed = new URL(decoded);

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only HTTP and HTTPS URLs can be proxied.");
  }

  return parsed.origin;
}

function encodeTargetOrigin(targetOrigin: string) {
  return Buffer.from(targetOrigin, "utf8").toString("base64url");
}

function getOriginParam(request: IncomingMessage) {
  const origin = (request as ProxiedRequest).params?.origin;
  if (!origin) {
    throw new Error("Missing proxy origin.");
  }

  return origin;
}

async function assertRegisteredOrigin(targetOrigin: string) {
  const cachedUntil = approvedOriginCache.get(targetOrigin) ?? 0;
  if (cachedUntil > Date.now()) {
    return;
  }

  if (!supabaseAdmin) {
    if (isProduction) {
      throw new Error("Proxy authorization is not configured.");
    }

    return;
  }

  const { data, error } = await supabaseAdmin
    .from("canvases")
    .select("id")
    .eq("site_origin", targetOrigin)
    .limit(1);

  if (error) {
    throw error;
  }

  if (!data?.length) {
    throw new Error(`Origin is not registered: ${targetOrigin}`);
  }

  approvedOriginCache.set(targetOrigin, Date.now() + 5 * 60 * 1000);
}

async function assertPublicTarget(targetOrigin: string) {
  const parsed = new URL(targetOrigin);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const cachedUntil = publicHostnameCache.get(hostname) ?? 0;
  if (cachedUntil > Date.now()) {
    return;
  }

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new Error("Local hostnames cannot be proxied.");
  }

  const addresses = ipaddr.isValid(hostname)
    ? [hostname]
    : (await lookup(hostname, { all: true, verbatim: true })).map((result) => result.address);

  if (!addresses.length || addresses.some((address) => !isPublicAddress(address))) {
    throw new Error("Private, reserved, and link-local addresses cannot be proxied.");
  }

  publicHostnameCache.set(hostname, Date.now() + 5 * 60 * 1000);
}

function isPublicAddress(address: string) {
  let parsedAddress = ipaddr.parse(address);
  if (parsedAddress.kind() === "ipv6") {
    const ipv6Address = parsedAddress as ipaddr.IPv6;
    if (ipv6Address.isIPv4MappedAddress()) {
      parsedAddress = ipv6Address.toIPv4Address();
    }
  }

  return parsedAddress.range() === "unicast";
}

function getTargetPath(request: IncomingMessage) {
  const proxiedRequest = request as ProxiedRequest;
  const originalUrl = proxiedRequest.originalUrl || proxiedRequest.url || "/";
  const pathname = new URL(originalUrl, "http://local").pathname;
  const originParam = getOriginParam(request);

  if (!originParam) {
    return pathname;
  }

  return pathname.replace(new RegExp(`^/proxy/u/${escapeRegExp(originParam)}`), "") || "/";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
