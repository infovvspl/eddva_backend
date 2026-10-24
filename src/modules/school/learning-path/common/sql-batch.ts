import { EntityManager } from 'typeorm';

/**
 * TypeORM's postgres driver returns `[rows, affectedCount]` for UPDATE/DELETE ... RETURNING
 * (but plain rows for SELECT/INSERT). Normalise to the rows.
 */
export function rowsOf(result: any): any[] {
  return Array.isArray(result) && result.length === 2 && Array.isArray(result[0]) && typeof result[1] === 'number'
    ? result[0]
    : result;
}

/** Postgres allows 65535 bind parameters per statement; stay well below it. */
const MAX_PARAMS = 20_000;

/**
 * Multi-row INSERT in as few statements as the parameter limit allows.
 * `table` and `columns` must be trusted identifiers (never user input).
 */
export async function insertRows(
  manager: Pick<EntityManager, 'query'>,
  table: string,
  columns: string[],
  rows: unknown[][],
  suffix = '',
): Promise<void> {
  if (!rows.length) return;
  const perStatement = Math.max(1, Math.floor(MAX_PARAMS / columns.length));
  for (let start = 0; start < rows.length; start += perStatement) {
    const chunk = rows.slice(start, start + perStatement);
    const params: unknown[] = [];
    const tuples = chunk.map((row) => {
      const placeholders = row.map((value) => {
        params.push(value);
        return `$${params.length}`;
      });
      return `(${placeholders.join(', ')})`;
    });
    await manager.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${tuples.join(', ')} ${suffix}`, params);
  }
}
