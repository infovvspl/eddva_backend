import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PdfTextParser, checkUpload, isPdf, readPdfText, tidyText } from './lesson-plan-upload';
import { UPLOAD_MAX_BYTES, UPLOAD_MAX_TEXT_CHARS } from './lesson-plan.constants';
import { SAMPLE_UPLOADED_PLAN, minimalPdf } from './test-lesson-plan-fixtures';

/** A stand-in for pdf-parse: pdf.js cannot run inside jest's VM (it needs --experimental-vm-modules). */
const fakeParser = (result: { text?: string; total?: number } | Error) => {
  const destroy = jest.fn(async () => undefined);
  const make = (): PdfTextParser => ({
    getText: async () => { if (result instanceof Error) throw result; return result; },
    destroy,
  });
  return { make, destroy };
};

describe('uploaded lesson plans — file checks', () => {
  const pdf = minimalPdf(SAMPLE_UPLOADED_PLAN);

  it('accepts a real PDF, judged by its content, not its name', () => {
    expect(isPdf(pdf)).toBe(true);
    expect(checkUpload({ buffer: pdf, originalname: 'plan.pdf', mimetype: 'application/pdf' })).toEqual({ ok: true });
    expect(checkUpload({ buffer: pdf, originalname: 'plan', mimetype: 'application/octet-stream' })).toEqual({ ok: true });
  });

  it('refuses a missing, oversized, Word or disguised file with the right status', () => {
    expect(checkUpload(undefined)).toMatchObject({ ok: false, status: 400 });
    expect(checkUpload({ buffer: pdf, size: UPLOAD_MAX_BYTES + 1, originalname: 'big.pdf' })).toMatchObject({ ok: false, status: 413 });
    expect(checkUpload({ buffer: Buffer.from('PK\u0003\u0004 word'), originalname: 'plan.docx' }))
      .toMatchObject({ ok: false, status: 415, message: expect.stringContaining('Save the plan as PDF') });
    expect(checkUpload({ buffer: Buffer.from('<html>not a pdf</html>'), originalname: 'plan.pdf', mimetype: 'application/pdf' }))
      .toMatchObject({ ok: false, status: 415, message: 'Only PDF files can be uploaded' });
  });

  it('tidies whitespace without losing line structure', () => {
    expect(tidyText('Period 1\r\n\r\n\r\n   explain \t the lemma  \n\nPeriod 2')).toBe('Period 1\n\nexplain the lemma\n\nPeriod 2');
  });
});

describe('uploaded lesson plans — reading the text', () => {
  const text = SAMPLE_UPLOADED_PLAN.join('\n');

  it('returns the tidied text and page count, and always releases the parser', async () => {
    const p = fakeParser({ text: `  ${text}\n\n\n`, total: 2 });
    const r = await readPdfText(Buffer.from('%PDF-'), p.make);
    expect(r).toMatchObject({ text, truncated: false, pages: 2 });
    expect(p.destroy).toHaveBeenCalled();
  });

  it('a PDF with no text (a scan) is refused with a reason the teacher can act on', async () => {
    const p = fakeParser({ text: ' \n 1 \n', total: 3 });
    await expect(readPdfText(Buffer.from('%PDF-'), p.make)).rejects.toThrow('looks like a scanned image');
    expect(p.destroy).toHaveBeenCalled();
  });

  it('a long scan is still a scan: pdf-parse page separators are not text', async () => {
    const separators = Array.from({ length: 40 }, (_, i) => `\n\n-- ${i + 1} of 40 --\n\n`).join('');
    await expect(readPdfText(Buffer.from('%PDF-'), fakeParser({ text: separators, total: 40 }).make)).rejects.toThrow('scanned image');
    const r = await readPdfText(Buffer.from('%PDF-'), fakeParser({ text: `${text}\n\n-- 1 of 1 --\n`, total: 1 }).make);
    expect(r.text).toBe(text);
  });

  it('password-protected and broken files get their own messages', async () => {
    const pw = Object.assign(new Error('No password given'), { name: 'PasswordException' });
    await expect(readPdfText(Buffer.from('%PDF-'), fakeParser(pw).make)).rejects.toThrow('password-protected');
    await expect(readPdfText(Buffer.from('%PDF-'), fakeParser(new Error('Invalid XRef')).make)).rejects.toThrow('could not be read');
  });

  it('a long plan is cut to what the AI service reads, and says so', async () => {
    const long = 'Practise the division algorithm with two more examples. '.repeat(800);
    const r = await readPdfText(Buffer.from('%PDF-'), fakeParser({ text: long, total: 9 }).make);
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBe(UPLOAD_MAX_TEXT_CHARS);
    expect(r.chars).toBeGreaterThan(UPLOAD_MAX_TEXT_CHARS);
  });
});

describe('uploaded lesson plans — real pdf-parse (child Node process)', () => {
  it('the real library reads the fixture PDF, and finds no text in an image-only page', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lp-pdf-'));
    try {
      const withText = join(dir, 'plan.pdf');
      const noText = join(dir, 'scan.pdf');
      writeFileSync(withText, minimalPdf(SAMPLE_UPLOADED_PLAN));
      writeFileSync(noText, minimalPdf([], false));
      const script = `
        const { PDFParse } = require('pdf-parse'); const fs = require('fs');
        (async () => { const out = [];
          for (const f of process.argv.slice(1)) { const p = new PDFParse({ data: new Uint8Array(fs.readFileSync(f)) });
            const r = await p.getText(); await p.destroy(); out.push({ total: r.total, text: r.text }); }
          process.stdout.write(JSON.stringify(out)); })().catch((e) => { console.error(e); process.exit(1); });`;
      const out = JSON.parse(execFileSync(process.execPath, ['-e', script, withText, noText], { cwd: process.cwd(), encoding: 'utf8', timeout: 60_000 }));
      expect(out[0].total).toBe(1);
      expect(out[0].text).toContain('division lemma');
      expect(out[0].text).toContain('Period 2 (45 min)');
      expect(out[1].text.replace(/\s|--\s*\d+\s*of\s*\d+\s*--/g, '')).toBe('');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
