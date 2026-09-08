/**
 * P0 — SSRF policy for GET /school/materials/proxy-pdf.
 *
 * The endpoint fetches a caller-supplied URL server-side, so without validation
 * it is a full read SSRF: an attacker reaches anything the EC2 host can reach
 * (VPC services, cloud metadata) and gets the body back. These helpers are the
 * only thing standing between the query string and fetch().
 *
 * Kept as pure functions with the allowlist passed in, so every rule is unit
 * testable without booting Nest or touching the network.
 */

/** The single externally visible failure message. Never leak why. */
export const PROXY_PDF_GENERIC_ERROR = 'Unable to load PDF.';

export const PROXY_PDF_ALLOWED_HOSTS_ENV = 'SCHOOL_PROXY_PDF_ALLOWED_HOSTS';
export const PROXY_PDF_MAX_BYTES_ENV = 'SCHOOL_PROXY_PDF_MAX_BYTES';

/** Upstream read budget. Long enough for a large textbook, short enough to bound a stuck socket. */
export const PROXY_PDF_TIMEOUT_MS = 15_000;

/**
 * Default body cap: 64 MiB.
 *
 * Deliberately not a round-but-small number. Measured DEV data: 576 PDF
 * materials, p95 ~10.6 MB, max ~56.5 MB, with a live 48.9 MB file observed. A
 * 10 MB cap would break real textbooks; 64 MiB clears the largest known file
 * with headroom while still bounding memory per request.
 */
export const PROXY_PDF_DEFAULT_MAX_BYTES = 64 * 1024 * 1024;

/** Reasons are for server-side logs only — never for the response body. */
export type ProxyPdfRejection =
  | 'not_configured'
  | 'malformed_url'
  | 'scheme_not_https'
  | 'embedded_credentials'
  | 'non_default_port'
  | 'host_not_allowed';

export class ProxyPdfPolicyError extends Error {
  constructor(readonly reason: ProxyPdfRejection) {
    super(reason);
    this.name = 'ProxyPdfPolicyError';
  }
}

/**
 * A hostname, and nothing else: no scheme, port, path, userinfo or wildcard.
 * Labels are alphanumeric with internal hyphens. IP literals are permitted only
 * because an operator may deliberately configure one; they are still matched
 * exactly, so this grants no range.
 */
const HOSTNAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

/**
 * Parse the configured allowlist.
 *
 * Throws on a malformed entry so a typo fails at startup rather than silently
 * shrinking the allowlist and breaking PDFs in production. An absent or empty
 * value is NOT an error here — it is a valid "nothing is allowed yet" state that
 * the request path turns into a fail-closed rejection.
 */
export function parseAllowedHosts(raw: string | undefined | null): string[] {
  if (!raw || !raw.trim()) return [];

  const hosts: string[] = [];
  for (const part of raw.split(',')) {
    const host = part.trim().toLowerCase();
    if (!host) continue; // tolerate "a,,b" and trailing commas
    if (host.includes('*')) {
      throw new Error(
        `${PROXY_PDF_ALLOWED_HOSTS_ENV}: wildcards are not supported ("${host}") — list each host exactly.`,
      );
    }
    if (!HOSTNAME_RE.test(host)) {
      throw new Error(
        `${PROXY_PDF_ALLOWED_HOSTS_ENV}: "${host}" is not a bare hostname (no scheme, port, path or credentials).`,
      );
    }
    if (!hosts.includes(host)) hosts.push(host);
  }
  return hosts;
}

/**
 * The configured allowlist, parsed once.
 *
 * Evaluated at module load, so a malformed entry fails the process at startup
 * instead of silently dropping a host and breaking PDFs later. An absent value
 * yields [] — startup succeeds and every request fails closed, which is the
 * correct posture while the production host inventory is still unknown.
 */
let cachedAllowedHosts: string[] | null = null;

export function getProxyPdfAllowedHosts(): string[] {
  if (cachedAllowedHosts === null) {
    cachedAllowedHosts = parseAllowedHosts(process.env[PROXY_PDF_ALLOWED_HOSTS_ENV]);
  }
  return cachedAllowedHosts;
}

/** Test-only: drop the memoised list so a case can vary the environment. */
export function resetProxyPdfAllowedHostsCache(): void {
  cachedAllowedHosts = null;
}

/**
 * Validate a caller-supplied URL against the allowlist.
 *
 * Exact hostname equality only. Suffix matching would accept
 * `eddva.in.evil.com`, and wildcard R2 matching would accept every public R2
 * bucket on the internet.
 */
export function assertAllowedPdfUrl(raw: string, allowedHosts: readonly string[]): URL {
  // Fail closed. An unset allowlist must never mean "allow everything".
  if (!allowedHosts.length) throw new ProxyPdfPolicyError('not_configured');

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ProxyPdfPolicyError('malformed_url');
  }

  if (url.protocol !== 'https:') throw new ProxyPdfPolicyError('scheme_not_https');
  // `https://allowed-host@evil.example.com/x` parses with hostname evil.example.com,
  // but credentials in a proxied URL are never legitimate here regardless.
  if (url.username || url.password) throw new ProxyPdfPolicyError('embedded_credentials');
  // Empty means the default 443. A port would let an allowlisted name reach an
  // unrelated internal service on that host.
  if (url.port !== '') throw new ProxyPdfPolicyError('non_default_port');
  if (!allowedHosts.includes(url.hostname.toLowerCase())) {
    throw new ProxyPdfPolicyError('host_not_allowed');
  }

  return url;
}

/** Media type only: `application/pdf; charset=binary` is still a PDF. */
export function isPdfContentType(contentType: string | null | undefined): boolean {
  if (!contentType) return false;
  return contentType.split(';')[0].trim().toLowerCase() === 'application/pdf';
}

/** Configured body cap, falling back to the default when unset or nonsensical. */
export function resolveMaxBytes(raw: string | undefined | null): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : PROXY_PDF_DEFAULT_MAX_BYTES;
}

/**
 * Read a body without ever holding more than `maxBytes`.
 *
 * Content-Length is checked first as a cheap rejection, but it is only a claim:
 * a chunked response omits it and a hostile one can lie, so the running total is
 * the real bound and the stream is cancelled the moment it is exceeded.
 */
export async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  declaredLength: string | null,
  maxBytes: number,
): Promise<Buffer> {
  const declared = Number(declaredLength);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error('proxy_pdf_too_large');
  }
  if (!body) throw new Error('proxy_pdf_no_body');

  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) throw new Error('proxy_pdf_too_large');
      chunks.push(Buffer.from(value));
    }
  } finally {
    // Releases the socket on the oversize path too, so a rejected 1 GB response
    // is not left draining in the background.
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks);
}
