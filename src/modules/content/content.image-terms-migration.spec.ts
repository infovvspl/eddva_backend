/**
 * G3 Class-A — _extractNoteImageSearchTerms no longer calls Groq directly.
 *
 * The method used a raw fetch() to api.groq.com with llama-3.3-70b-versatile,
 * bypassing AiBridgeService and therefore admission control, attribution and
 * centralised key rotation. It now goes through the bridge.
 *
 * content.service is not directly instantiable in a unit test without broad
 * integration scaffolding, so the structural assertions are source guards — the
 * same approach already accepted for battle.service and for R1. The best-effort
 * contract is the one thing worth proving behaviourally, so that one invokes the
 * real method against a rejecting bridge.
 */
import * as fs from 'fs';
import * as path from 'path';

const CONTENT_SERVICE = path.join(__dirname, 'content.service.ts');
const MATERIAL_CONTROLLER = path.join(
  __dirname, '..', 'school', 'material', 'school-material.controller.ts',
);

const source = (p: string) => fs.readFileSync(p, 'utf8');

/** The body of a named method, up to the next method at the same indent. */
function methodBlock(src: string, signature: string): string {
  const start = src.indexOf(signature);
  expect(start).toBeGreaterThan(-1);
  const rest = src.slice(start + signature.length);
  const end = rest.search(/\n {4}(private|public|protected|async)\s/);
  return rest.slice(0, end === -1 ? 4000 : end);
}

describe('G3 Class-A — content.service image-term extraction', () => {
  it('1. the method no longer contains a direct provider call', () => {
    const block = methodBlock(
      source(CONTENT_SERVICE),
      'private async _extractNoteImageSearchTerms(',
    );
    expect(block).not.toContain('fetch(');
    expect(block).not.toContain('GROQ_URL');
    expect(block).not.toContain('llama-3.3-70b-versatile');
    expect(block).not.toContain('GROQ_API_KEY');
  });

  it('2. the method calls the bridge instead', () => {
    const block = methodBlock(
      source(CONTENT_SERVICE),
      'private async _extractNoteImageSearchTerms(',
    );
    expect(block).toContain('this.aiBridgeService.extractImageSearchTerms(');
    // tenantId must reach the bridge, or attribution and per-tenant admission
    // both lose the identity they key on.
    expect(block).toMatch(/extractImageSearchTerms\(\s*\{[^}]*\},\s*tenantId,/);
  });

  it('2b. the single call site forwards tenantId', () => {
    expect(source(CONTENT_SERVICE)).toContain(
      '_extractNoteImageSearchTerms(notes, language, tenantId)',
    );
  });

  it('4. no direct api.groq.com inference reference remains in the file', () => {
    const src = source(CONTENT_SERVICE);
    expect(src).not.toContain('api.groq.com');
    expect(src).not.toContain('GROQ_URL');
    expect(src).not.toContain('llama-3.3-70b-versatile');
  });

  it('5. no explicit pool override was added — the path defaults to BACKGROUND', () => {
    // /stt/extract-image-terms is unclassified, so classifyPath() resolves it to
    // DEFAULT_ADMISSION_POOL. Adding an override here would be redundant, and a
    // third override would break the R1 count guard.
    const overrides = (source(CONTENT_SERVICE)
      .match(/\{ pool: AdmissionPool\.BACKGROUND \}/g) || []).length;
    expect(overrides).toBe(2);
  });
});

describe('G3 Class-A — best-effort contract survives the migration', () => {
  // The raw fetch returned [] on a non-2xx; the bridge throws. Without a catch
  // this optional enrichment would become a hard failure of note generation.
  it('3. returns [] when the bridge rejects', async () => {
    const { ContentService } = require('./content.service');

    const ctx = {
      aiBridgeService: {
        extractImageSearchTerms: jest
          .fn()
          .mockRejectedValue(new Error('admission rejected')),
      },
      logger: { warn: jest.fn() },
    };

    const result = await (ContentService.prototype as any)
      ._extractNoteImageSearchTerms.call(ctx, '# Notes', 'en', 'tenant-1');

    expect(result).toEqual([]);
    expect(ctx.logger.warn).toHaveBeenCalled();
  });

  it('3b. returns [] when the bridge resolves without a sections array', async () => {
    const { ContentService } = require('./content.service');
    const ctx = {
      aiBridgeService: { extractImageSearchTerms: jest.fn().mockResolvedValue({}) },
      logger: { warn: jest.fn() },
    };
    const result = await (ContentService.prototype as any)
      ._extractNoteImageSearchTerms.call(ctx, '# Notes', 'en', 'tenant-1');
    expect(result).toEqual([]);
  });

  it('3c. caps at 4 sections and drops malformed entries', async () => {
    // The caller issues one image search per section, so the cap bounds
    // outbound work and the filter stops a malformed entry reaching that loop.
    const { ContentService } = require('./content.service');
    const sections = [
      { heading: '## A', searchTerm: 'a diagram', caption: 'cap a' },
      { heading: '## B', searchTerm: 'b diagram' },      // caption falls back
      { searchTerm: 'no heading' },                       // dropped
      { heading: '## D', searchTerm: 'd diagram', caption: 'cap d' },
      { heading: '## E', searchTerm: 'e diagram', caption: 'cap e' },
      { heading: '## F', searchTerm: 'f diagram', caption: 'cap f' },
    ];
    const ctx = {
      aiBridgeService: { extractImageSearchTerms: jest.fn().mockResolvedValue({ sections }) },
      logger: { warn: jest.fn() },
    };
    const result = await (ContentService.prototype as any)
      ._extractNoteImageSearchTerms.call(ctx, '# Notes', 'en', 'tenant-1');

    expect(result).toHaveLength(3);              // 4 taken, 1 malformed dropped
    expect(result[1].caption).toBe('b diagram'); // caption falls back to searchTerm
  });
});

describe('G3 — unsafe debug endpoint is gone', () => {
  it('school-material.controller exposes no POST /dump and writes no files', () => {
    const src = source(MATERIAL_CONTROLLER);
    expect(src).not.toContain("@Post('dump')");
    expect(src).not.toContain('dumpData');
    expect(src).not.toContain('writeFileSync');
  });
});
