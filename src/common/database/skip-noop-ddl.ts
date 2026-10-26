/**
 * Skips start-up `ALTER TABLE … ADD COLUMN IF NOT EXISTS …` statements whose
 * columns already exist.
 *
 * Why: modules ensure their schema on every boot with hundreds of these
 * statements. Postgres takes the table's ACCESS EXCLUSIVE lock BEFORE it checks
 * "IF NOT EXISTS", so each no-op still blocks every reader of that table for as
 * long as it waits for the lock — and a reader queued behind it waits too. On the
 * shared dev database this made login (users ⋈ institutes) take 33–153 s while
 * any backend was booting (24 Oct 2026). Checking information_schema takes no
 * table lock, so a statement whose columns are all present is answered without
 * touching the table. A statement that would really add a column runs unchanged.
 *
 * Only statements made of nothing but `ADD [COLUMN] IF NOT EXISTS` clauses are
 * considered; anything else (other ALTERs, CREATE, DML) passes straight through.
 * Turn off with DB_SKIP_NOOP_DDL=false.
 */
import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

const logger = new Logger('SkipNoopDdl');
const PATCHED = Symbol.for('eddva.skipNoopDdl');

/** Splits on commas that are outside quotes, double quotes and parentheses. */
export function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0; let quote: string | null = null; let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) {
        if (text[i + 1] === quote) { i++; continue; } // escaped '' or ""
        quote = null;
      }
      continue;
    }
    if (ch === '\'' || ch === '"') quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

const ident = (raw: string): string => (raw.startsWith('"') ? raw.slice(1, -1).replace(/""/g, '"') : raw.toLowerCase());

export interface AddColumnsStatement { schema: string | null; table: string; columns: string[] }

/** The table and columns of an ALTER made only of ADD [COLUMN] IF NOT EXISTS clauses; null otherwise. */
export function parseAddColumnsIfNotExists(sql: string): AddColumnsStatement | null {
  const text = String(sql || '').trim().replace(/;\s*$/, '');
  const m = /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?((?:"[^"]+"|[A-Za-z_][\w$]*)(?:\s*\.\s*(?:"[^"]+"|[A-Za-z_][\w$]*))?)\s+([\s\S]+)$/i.exec(text);
  if (!m) return null;
  const nameParts = m[1].split(/\s*\.\s*/);
  const clauses = splitTopLevel(m[2]);
  if (!clauses.length) return null;
  const columns: string[] = [];
  for (const clause of clauses) {
    const c = /^ADD\s+(?:COLUMN\s+)?IF\s+NOT\s+EXISTS\s+("[^"]+"|[A-Za-z_][\w$]*)\s/i.exec(`${clause} `);
    if (!c) return null;
    columns.push(ident(c[1]));
  }
  return {
    schema: nameParts.length === 2 ? ident(nameParts[0]) : null,
    table: ident(nameParts[nameParts.length - 1]),
    columns,
  };
}

/** Patches DataSource.prototype.query once per process. */
export function installSkipNoopDdl(): void {
  if (String(process.env.DB_SKIP_NOOP_DDL ?? 'true').toLowerCase() === 'false') return;
  const proto: any = DataSource.prototype;
  if (proto[PATCHED]) return;
  const original = proto.query;
  let skipped = 0;
  let summaryTimer: NodeJS.Timeout | undefined;

  proto.query = async function patchedQuery(this: DataSource, query: string, parameters?: any[], queryRunner?: any) {
    const stmt = typeof query === 'string' && /^\s*ALTER\s+TABLE/i.test(query) ? parseAddColumnsIfNotExists(query) : null;
    if (stmt) {
      try {
        const rows: Array<{ column_name: string }> = await original.call(
          this,
          `SELECT column_name FROM information_schema.columns
            WHERE table_schema = COALESCE($1, current_schema()) AND table_name = $2 AND column_name = ANY($3)`,
          [stmt.schema, stmt.table, stmt.columns],
          queryRunner,
        );
        const present = new Set(rows.map((r) => r.column_name));
        if (stmt.columns.every((c) => present.has(c))) {
          skipped++;
          if (summaryTimer) clearTimeout(summaryTimer);
          summaryTimer = setTimeout(() => logger.log(`Skipped ${skipped} start-up ALTER TABLE statement(s) whose columns already exist (no table lock taken)`), 5000);
          summaryTimer.unref?.();
          return [];
        }
      } catch {
        // Any doubt: run the statement exactly as written.
      }
    }
    return original.call(this, query, parameters, queryRunner);
  };
  proto[PATCHED] = true;
}
