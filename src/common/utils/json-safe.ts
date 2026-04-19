/**
 * Strip values that break JSON.stringify (e.g. bigint from some PG json paths).
 * Dates → ISO strings. Drops circular refs defensively.
 */
export function toJsonSafeDeep(input: unknown): unknown {
  const seen = new WeakSet<object>();

  const walk = (v: unknown): unknown => {
    if (v === null || v === undefined) return v;
    if (typeof v === 'bigint') return Number(v);
    if (typeof v !== 'object') return v;
    if (v instanceof Date) return v.toISOString();
    if (Array.isArray(v)) return v.map(walk);
    if (seen.has(v as object)) return null;
    seen.add(v as object);
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = walk(val);
    }
    return out;
  };

  return walk(input);
}
