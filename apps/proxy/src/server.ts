import compression from "compression";
import cors from "cors";
import "dotenv/config";
import express from "express";
import { responseInterceptor, createProxyMiddleware } from "http-proxy-middleware";
import morgan from "morgan";
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

app.use(compression());
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(morgan("dev"));

app.get("/health", (_request, response) => {
  response.json({ ok: true });
});

app.use(
  "/proxy/u/:origin",
  createProxyMiddleware({
    target: "https://example.com",
    changeOrigin: true,
    secure: false,
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
        if (!contentType.includes("text/html")) {
          return responseBuffer;
        }

        const body = responseBuffer.toString("utf8");
        const targetOrigin = decodeTargetOrigin(getOriginParam(request));
        const proxiedBase = getProxiedBaseUrl(targetOrigin, getTargetPath(request));
        return injectBaseTag(body, proxiedBase);
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
  response.setHeader("location", `/proxy/u/${encodeURIComponent(nextUrl.origin)}${nextUrl.pathname}${nextUrl.search}`);
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

function getProxiedBaseUrl(targetOrigin: string, requestPath: string) {
  const parsed = new URL(requestPath, targetOrigin);
  const directory = parsed.pathname.endsWith("/")
    ? parsed.pathname
    : parsed.pathname.slice(0, parsed.pathname.lastIndexOf("/") + 1);

  return `/proxy/u/${encodeURIComponent(parsed.origin)}${directory}`;
}

function decodeTargetOrigin(value: string | undefined) {
  if (!value) {
    throw new Error("Missing proxy origin.");
  }

  const decoded = decodeURIComponent(value);
  const parsed = new URL(decoded);

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only HTTP and HTTPS URLs can be proxied.");
  }

  return parsed.origin;
}

function getOriginParam(request: IncomingMessage) {
  const origin = (request as ProxiedRequest).params?.origin;
  if (!origin) {
    throw new Error("Missing proxy origin.");
  }

  return origin;
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
