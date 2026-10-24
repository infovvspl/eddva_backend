/**
 * Uploaded lesson plans: file checks and text extraction. The text is then read
 * by the AI service (content type lesson_plan_extract) into the v2 structure.
 */
import { PDFParse } from 'pdf-parse';
import { UPLOAD_MAX_BYTES, UPLOAD_MAX_TEXT_CHARS, UPLOAD_MIN_TEXT_CHARS } from './lesson-plan.constants';

/** `ok`, or the HTTP status and message to refuse the upload with. */
export interface UploadCheck { ok: boolean; status?: 400 | 413 | 415; message?: string }

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** A PDF starts with "%PDF-" (the extension and declared type are only hints). */
export function isPdf(buffer: Buffer | undefined): boolean {
  return !!buffer && buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}

export function checkUpload(file: { buffer?: Buffer; size?: number; originalname?: string; mimetype?: string } | undefined): UploadCheck {
  if (!file?.buffer?.length) return { ok: false, status: 400, message: 'Choose a PDF file to upload' };
  if ((file.size ?? file.buffer.length) > UPLOAD_MAX_BYTES) {
    return { ok: false, status: 413, message: `The file is larger than ${UPLOAD_MAX_BYTES / (1024 * 1024)} MB` };
  }
  const name = String(file.originalname || '').toLowerCase();
  if (name.endsWith('.docx') || name.endsWith('.doc') || file.mimetype === DOCX_MIME || file.mimetype === 'application/msword') {
    return { ok: false, status: 415, message: 'Word files are not supported yet. Save the plan as PDF (File → Save as → PDF) and upload that.' };
  }
  if (!isPdf(file.buffer)) return { ok: false, status: 415, message: 'Only PDF files can be uploaded' };
  return { ok: true };
}

/**
 * Whitespace tidied and pdf-parse's own page separators ("-- 3 of 12 --") removed:
 * left in, a long scanned PDF would look like it had readable text. The AI does
 * the structuring.
 */
export function tidyText(raw: string): string {
  return String(raw || '')
    .replace(/\r\n?/g, '\n')
    .replace(/^[ \t]*--[ \t]*\d+[ \t]+of[ \t]+\d+[ \t]*--[ \t]*$/gm, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface ExtractedText { text: string; chars: number; truncated: boolean; pages: number }

/** The part of pdf-parse's PDFParse this module uses (injectable for tests: pdf.js needs a real Node runtime). */
export interface PdfTextParser { getText(): Promise<{ text?: string; total?: number }>; destroy(): Promise<void> }
export const defaultPdfParser = (data: Uint8Array): PdfTextParser => new PDFParse({ data });

/** Reads the text layer of a PDF. Throws a readable Error for scanned, protected or broken files. */
export async function readPdfText(buffer: Buffer, makeParser: (data: Uint8Array) => PdfTextParser = defaultPdfParser): Promise<ExtractedText> {
  const parser = makeParser(new Uint8Array(buffer));
  let raw = '';
  let pages = 0;
  try {
    const result = await parser.getText();
    raw = result?.text ?? '';
    pages = Number(result?.total ?? 0) || 0;
  } catch (err) {
    const name = (err as Error)?.name || '';
    if (/Password/i.test(name)) throw new Error('The PDF is password-protected. Remove the password and upload it again.');
    throw new Error('The PDF could not be read. Check that the file opens, then upload it again.');
  } finally {
    await parser.destroy().catch(() => undefined);
  }
  const text = tidyText(raw);
  if (text.replace(/\s/g, '').length < UPLOAD_MIN_TEXT_CHARS) {
    throw new Error('No readable text was found in this PDF. It looks like a scanned image; upload a PDF with selectable text.');
  }
  return {
    text: text.slice(0, UPLOAD_MAX_TEXT_CHARS),
    chars: text.length,
    truncated: text.length > UPLOAD_MAX_TEXT_CHARS,
    pages,
  };
}
