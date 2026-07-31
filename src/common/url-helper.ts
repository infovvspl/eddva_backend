/**
 * Dynamically resolves the public API base URL for file serving, OCR, and AI callbacks.
 * Fully environment-agnostic: works seamlessly across local dev (localhost),
 * staging (dev.eddva.in → dev-api.eddva.in), and production (eddva.in → api.eddva.in).
 */
export function resolvePublicApiUrl(req?: any): string {
  // 1. Explicit env configuration (recommended for production deployments)
  const envUrl = process.env.PUBLIC_API_URL || process.env.APP_URL;
  if (envUrl && envUrl.trim()) {
    return envUrl.trim().replace(/\/$/, '');
  }

  // 2. Reverse-proxy headers (X-Forwarded-Host & X-Forwarded-Proto)
  const forwardedHost = req?.headers?.['x-forwarded-host'];
  const forwardedProto = req?.headers?.['x-forwarded-proto'] || 'https';
  if (forwardedHost && !forwardedHost.includes('127.0.0.1') && !forwardedHost.includes('localhost')) {
    return `${forwardedProto}://${forwardedHost}`.replace(/\/$/, '');
  }

  // 3. Inspect Referer / Origin header from client request
  const referer = String(req?.headers?.['referer'] || req?.headers?.['origin'] || '');
  if (referer && referer.startsWith('http')) {
    try {
      const url = new URL(referer);
      const host = url.hostname;
      const proto = url.protocol;

      if (host.includes('dev.eddva.in')) {
        return 'https://dev-api.eddva.in';
      }
      if (host.includes('eddva.in')) {
        return 'https://api.eddva.in';
      }
      if (host === 'localhost' || host === '127.0.0.1') {
        return `${proto}//${host}:3000`;
      }
      // Dynamic subdomain matching: e.g. dev.school.com → dev-api.school.com, app.school.com → api.school.com
      if (host.startsWith('dev.')) {
        return `${proto}//dev-api.${host.slice(4)}`;
      }
      if (host.startsWith('app.')) {
        return `${proto}//api.${host.slice(4)}`;
      }
      return `${proto}//api.${host}`;
    } catch {
      /* fallback */
    }
  }

  // 4. Inspect Direct Host Header if non-local
  const directHost = req?.get ? req.get('host') : req?.headers?.['host'];
  if (directHost && !directHost.includes('127.0.0.1') && !directHost.includes('localhost')) {
    const proto = req?.protocol || 'https';
    return `${proto}://${directHost}`.replace(/\/$/, '');
  }

  // 5. Development fallback for local execution
  return 'http://localhost:3000';
}

/**
 * Transforms relative paths or legacy localhost/127.0.0.1 URLs into a fully
 * accessible public URL for browser rendering and AI service consumption.
 */
export function normalizeAccessibleUrl(url?: string | null, req?: any): string | null {
  if (!url) return null;
  let target = String(url).trim();
  if (!target) return null;

  const publicApi = resolvePublicApiUrl(req);

  // Replace local IP artifacts (e.g. http://127.0.0.1:3000/uploads/...) with real API host
  if (target.includes('127.0.0.1') || target.includes('localhost')) {
    target = target.replace(/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?/, publicApi);
  } else if (target.startsWith('/uploads/') || target.startsWith('uploads/')) {
    const cleanPath = target.replace(/^\/+/, '');
    target = `${publicApi}/${cleanPath}`;
  }

  return target;
}
