// Row-level snapshots of the lab database and a field-by-field diff.
// Every base table in public, plus storage.objects/buckets and auth.users,
// keyed by primary key. Read-only.
import pg from 'pg';

export async function snapshot(db) {
  const c = new pg.Client({ host: '127.0.0.1', port: Number(process.env.LAB_PGPORT ?? 54329), user: 'postgres', database: db });
  await c.connect();
  try {
    const tables = (await c.query(`
      SELECT n.nspname AS s, cl.relname AS t,
             array_agg(a.attname::text ORDER BY array_position(i.indkey::int2[], a.attnum)) AS pk
      FROM pg_class cl JOIN pg_namespace n ON n.oid = cl.relnamespace
      JOIN pg_index i ON i.indrelid = cl.oid AND i.indisprimary
      JOIN pg_attribute a ON a.attrelid = cl.oid AND a.attnum = ANY(i.indkey)
      WHERE cl.relkind = 'r' AND (n.nspname = 'public' OR (n.nspname, cl.relname) IN (('storage','objects'),('storage','buckets'),('auth','users')))
      GROUP BY 1, 2 ORDER BY 1, 2`)).rows;
    const snap = { _columns: {} };
    for (const { s, t, pk } of tables) {
      const name = `${s}.${t}`;
      const rows = (await c.query(`SELECT * FROM ${s}."${t}"`)).rows;
      snap._columns[name] = (await c.query(`SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position`, [s, t])).rows.map((r) => r.column_name);
      snap[name] = Object.fromEntries(rows.map((r) => [pk.map((k) => String(r[k])).join('|'), JSON.parse(JSON.stringify(r))]));
    }
    return snap;
  } finally { await c.end(); }
}

/** Per table: added / deleted / changed rows (with the columns that changed), and added / removed columns. */
export function diff(a, b) {
  const out = {};
  const tables = new Set([...Object.keys(a), ...Object.keys(b)].filter((k) => k !== '_columns'));
  for (const t of tables) {
    const A = a[t] ?? {}, B = b[t] ?? {};
    const colsA = a._columns?.[t] ?? [], colsB = b._columns?.[t] ?? [];
    const addedCols = colsB.filter((c) => !colsA.includes(c)), removedCols = colsA.filter((c) => !colsB.includes(c));
    const added = Object.keys(B).filter((k) => !(k in A));
    const deleted = Object.keys(A).filter((k) => !(k in B));
    const changed = [];
    for (const k of Object.keys(A)) {
      if (!(k in B)) continue;
      const cols = colsA.filter((c) => colsB.includes(c) && JSON.stringify(A[k][c]) !== JSON.stringify(B[k][c]));
      if (cols.length) changed.push({ key: k, cols: Object.fromEntries(cols.map((c) => [c, [A[k][c], B[k][c]]])) });
    }
    if (added.length || deleted.length || changed.length || addedCols.length || removedCols.length || !(t in a) || !(t in b)) {
      out[t] = { rowsBefore: Object.keys(A).length, rowsAfter: Object.keys(B).length, added, deleted, changed, addedCols, removedCols, ...(t in a ? {} : { newTable: true }), ...(t in b ? {} : { droppedTable: true }) };
    }
  }
  return out;
}

export const count = (snap) => Object.fromEntries(Object.keys(snap).filter((k) => k !== '_columns').map((k) => [k, Object.keys(snap[k]).length]));
