/**
 * P0 — SSRF guard for GET /school/materials/proxy-pdf.
 *
 * The endpoint fetches a caller-supplied URL server-side. Before this fix it was
 * @SchoolPublic() with no validation, no redirect policy, no timeout and no size
 * bound — a full unauthenticated read SSRF reachable from the internet.
 *
 * No test here performs real network I/O. Private-address and metadata cases are
 * asserted through the allowlist rule (they are simply hosts that are not
 * configured), never by sending a request anywhere.
 */
import {
  assertAllowedPdfUrl,
  isPdfContentType,
  parseAllowedHosts,
  readBoundedBody,
  resolveMaxBytes,
  ProxyPdfPolicyError,
  PROXY_PDF_DEFAULT_MAX_BYTES,
  PROXY_PDF_GENERIC_ERROR,
  PROXY_PDF_TIMEOUT_MS,
} from './proxy-pdf.policy';

const ALLOWED = ['media.eddva.in', 'pub-abc123.r2.dev'];

const reasonOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e: any) {
    return e instanceof ProxyPdfPolicyError ? e.reason : `unexpected:${e?.message}`;
  }
  return 'no_error';
};

/** A ReadableStream over fixed chunks, so body handling is tested without a socket. */
function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(chunks[i++]);
      else controller.close();
    },
  });
}

describe('proxy-pdf allowlist parsing', () => {
  it('1. parses, trims, lowercases and de-duplicates', () => {
    expect(parseAllowedHosts(' Media.Eddva.IN , pub-abc123.r2.dev ,media.eddva.in'))
      .toEqual(['media.eddva.in', 'pub-abc123.r2.dev']);
  });

  it('2. absent or empty config yields an empty list, not an error', () => {
    // Startup must still succeed; the request path is what fails closed.
    expect(parseAllowedHosts(undefined)).toEqual([]);
    expect(parseAllowedHosts('')).toEqual([]);
    expect(parseAllowedHosts('   ')).toEqual([]);
    expect(parseAllowedHosts(',,')).toEqual([]);
  });

  it('3. rejects wildcards outright', () => {
    expect(() => parseAllowedHosts('*.eddva.in')).toThrow(/wildcard/i);
  });

  it('4. rejects anything that is not a bare hostname', () => {
    for (const bad of [
      'https://media.eddva.in',      // scheme
      'media.eddva.in/path',         // path
      'media.eddva.in:8443',         // port
      'user@media.eddva.in',         // userinfo
      'media eddva in',              // spaces
      '-leading.eddva.in',           // invalid label
    ]) {
      expect(() => parseAllowedHosts(bad)).toThrow();
    }
  });
});

describe('proxy-pdf URL validation', () => {
  it('5. accepts a configured https host', () => {
    const u = assertAllowedPdfUrl('https://media.eddva.in/tenants/x/a.pdf', ALLOWED);
    expect(u.hostname).toBe('media.eddva.in');
  });

  it('5b. preserves the query string (presigned URLs must survive)', () => {
    const u = assertAllowedPdfUrl('https://media.eddva.in/a.pdf?sig=abc&x=1', ALLOWED);
    expect(u.search).toBe('?sig=abc&x=1');
  });

  it('6. FAILS CLOSED when no allowlist is configured', () => {
    // The single most important assertion: missing config must never mean allow-all.
    expect(reasonOf(() => assertAllowedPdfUrl('https://media.eddva.in/a.pdf', [])))
      .toBe('not_configured');
  });

  it('7. rejects http', () => {
    expect(reasonOf(() => assertAllowedPdfUrl('http://media.eddva.in/a.pdf', ALLOWED)))
      .toBe('scheme_not_https');
  });

  it('7b. rejects non-http schemes', () => {
    for (const bad of ['file:///etc/passwd', 'ftp://media.eddva.in/a.pdf', 'gopher://media.eddva.in/']) {
      expect(reasonOf(() => assertAllowedPdfUrl(bad, ALLOWED))).not.toBe('no_error');
    }
  });

  it('8. rejects an unknown host', () => {
    expect(reasonOf(() => assertAllowedPdfUrl('https://evil.example.com/a.pdf', ALLOWED)))
      .toBe('host_not_allowed');
  });

  it('9. rejects suffix-confusion hosts', () => {
    // The exact reason endsWith()-style matching is banned.
    for (const bad of [
      'https://eddva.in.evil.com/a.pdf',
      'https://media.eddva.in.evil.com/a.pdf',
      'https://notmedia.eddva.in/a.pdf',
      'https://evil.eddva.in/a.pdf', // subdomain, not explicitly configured
    ]) {
      expect(reasonOf(() => assertAllowedPdfUrl(bad, ALLOWED))).toBe('host_not_allowed');
    }
  });

  it('10. rejects embedded credentials', () => {
    expect(reasonOf(() => assertAllowedPdfUrl('https://media.eddva.in:x@evil.example.com/a.pdf', ALLOWED)))
      .toBe('embedded_credentials');
  });

  it('11. rejects a non-default port on an allowed host', () => {
    expect(reasonOf(() => assertAllowedPdfUrl('https://media.eddva.in:8443/a.pdf', ALLOWED)))
      .toBe('non_default_port');
  });

  it('12. rejects malformed URLs', () => {
    for (const bad of ['not-a-url', '', '///', 'https://']) {
      expect(reasonOf(() => assertAllowedPdfUrl(bad, ALLOWED))).not.toBe('no_error');
    }
  });

  it('13. rejects private, loopback, link-local and metadata addresses', () => {
    // Asserted as ordinary un-allowlisted hosts. No request is made to any of these.
    for (const bad of [
      'https://169.254.169.254/latest/meta-data/',   // cloud metadata
      'https://127.0.0.1/a.pdf',
      'https://localhost/a.pdf',
      'https://10.0.0.5/a.pdf',
      'https://172.16.0.5/a.pdf',
      'https://192.168.1.5/a.pdf',
      'https://[::1]/a.pdf',
      'https://[fd00::1]/a.pdf',
      'https://[fe80::1]/a.pdf',
      'https://2852039166/a.pdf',                   // decimal IP encoding
      'https://0x7f000001/a.pdf',                   // hex IP encoding
    ]) {
      expect(reasonOf(() => assertAllowedPdfUrl(bad, ALLOWED))).toBe('host_not_allowed');
    }
  });

  it('13b. an IP literal is reachable only if explicitly configured', () => {
    // Exact match still applies — configuring one address grants no range.
    expect(assertAllowedPdfUrl('https://203.0.113.9/a.pdf', ['203.0.113.9']).hostname)
      .toBe('203.0.113.9');
    expect(reasonOf(() => assertAllowedPdfUrl('https://203.0.113.10/a.pdf', ['203.0.113.9'])))
      .toBe('host_not_allowed');
  });
});

describe('proxy-pdf content type', () => {
  it('14. accepts application/pdf with and without parameters', () => {
    expect(isPdfContentType('application/pdf')).toBe(true);
    expect(isPdfContentType('application/pdf; charset=binary')).toBe(true);
    expect(isPdfContentType('APPLICATION/PDF')).toBe(true);
    expect(isPdfContentType(' application/pdf ')).toBe(true);
  });

  it('15. rejects everything else, including a missing header', () => {
    for (const bad of ['text/html', 'application/json', 'image/png', 'text/plain', '', null, undefined]) {
      expect(isPdfContentType(bad as any)).toBe(false);
    }
  });
});

describe('proxy-pdf body bound', () => {
  const max = 1000;

  it('16. rejects on a Content-Length above the cap without reading', () => {
    const body = streamOf([new Uint8Array(10)]);
    return expect(readBoundedBody(body, String(max + 1), max)).rejects.toThrow('proxy_pdf_too_large');
  });

  it('17. rejects an oversize chunked body that declares no length', () => {
    // The lying/absent Content-Length case: the running total is the real bound.
    const chunks = Array.from({ length: 5 }, () => new Uint8Array(400)); // 2000 > 1000
    return expect(readBoundedBody(streamOf(chunks), null, max)).rejects.toThrow('proxy_pdf_too_large');
  });

  it('18. reads a body at exactly the cap', async () => {
    const buf = await readBoundedBody(streamOf([new Uint8Array(max)]), String(max), max);
    expect(buf.length).toBe(max);
  });

  it('19. returns the bytes unchanged for a normal body', async () => {
    const payload = Buffer.from('%PDF-1.4 hello');
    const buf = await readBoundedBody(streamOf([new Uint8Array(payload)]), String(payload.length), max);
    expect(buf.equals(payload)).toBe(true);
  });

  it('20. rejects a missing body', () => {
    return expect(readBoundedBody(null, null, max)).rejects.toThrow('proxy_pdf_no_body');
  });
});

describe('proxy-pdf configuration', () => {
  it('21. max bytes falls back to the default when unset or nonsensical', () => {
    for (const bad of [undefined, null, '', 'abc', '0', '-5']) {
      expect(resolveMaxBytes(bad as any)).toBe(PROXY_PDF_DEFAULT_MAX_BYTES);
    }
    expect(resolveMaxBytes('1048576')).toBe(1048576);
  });

  it('22. the default accommodates the largest PDF observed in DEV', () => {
    // Measured: max ~56.5 MB. A 10 MB cap would break real textbooks.
    expect(PROXY_PDF_DEFAULT_MAX_BYTES).toBeGreaterThan(57 * 1024 * 1024);
  });

  it('23. the upstream timeout is bounded and not excessive', () => {
    expect(PROXY_PDF_TIMEOUT_MS).toBeGreaterThan(0);
    expect(PROXY_PDF_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });
});

describe('proxy-pdf controller wiring (source guards)', () => {
  const fs = require('fs');
  const path = require('path');
  const src: string = fs.readFileSync(path.join(__dirname, 'school-material.controller.ts'), 'utf8');
  const block = src.slice(src.indexOf("@Get('proxy-pdf')"), src.indexOf("@Get('proxy-pdf')") + 3000);

  it('24. the route is no longer public and is role-restricted', () => {
    expect(block).not.toContain('@SchoolPublic()');
    for (const role of ['SUPER_ADMIN', 'INSTITUTE_ADMIN', 'TEACHER', 'STUDENT']) {
      expect(block).toContain(role);
    }
  });

  it('25. redirects are not followed', () => {
    expect(block).toContain("redirect: 'manual'");
  });

  it('26. a timeout is applied to the upstream fetch', () => {
    expect(block).toContain('AbortSignal.timeout(PROXY_PDF_TIMEOUT_MS)');
  });

  it('27. the body is read through the bounded reader, never arrayBuffer()', () => {
    expect(block).toContain('readBoundedBody(');
    expect(block).not.toContain('arrayBuffer()');
  });

  it('28. the wildcard CORS header is gone', () => {
    expect(block).not.toContain('Access-Control-Allow-Origin');
    expect(src).not.toContain("res.setHeader('Access-Control-Allow-Origin', '*')");
  });

  it('29. no raw error is reflected to the caller', () => {
    // Every externally thrown message is the constant.
    expect(block).not.toMatch(/BadRequestException\(\s*err/);
    expect(block).not.toContain('err.message ||');
    expect(block).not.toContain('`S3 returned ${');
    const thrown = block.match(/throw new \w+Exception\(([^)]*)\)/g) || [];
    expect(thrown.length).toBeGreaterThan(0);
    for (const t of thrown) expect(t).toContain('PROXY_PDF_GENERIC_ERROR');
  });

  it('30. the generic message reveals nothing about the request', () => {
    expect(PROXY_PDF_GENERIC_ERROR).toBe('Unable to load PDF.');
    expect(PROXY_PDF_GENERIC_ERROR).not.toMatch(/http|host|url|dns|socket|refused/i);
  });
});
