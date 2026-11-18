// Demo build only (vite --mode demo). An in-browser stand-in for the Supabase HTTP API, so the real
// app code can run against fixture data with no network at all: PostgREST queries and writes over
// in-memory tables, auth answers for one signed-in demo user, RPC and Edge Function stubs.
//
// It implements the parts of PostgREST this app uses (checked against every .from()/.rpc() call):
// select lists with renames and three embedded relations, eq/neq/gt/gte/lt/lte/is/in/cs/like/ilike,
// not.*, or=(...), order (multi, nulls first/last), limit/offset, single/maybeSingle, exact counts and
// HEAD, insert/upsert/update/delete with return=representation, and ON DELETE cascades.
// There is no row-level security: the demo has one user and fixture rows for everyone else.
import { DEMO_SCHEMA } from './schema';

export type Row = Record<string, unknown>;
export type DemoDb = Record<string, Row[]>;

export interface DemoBackendOptions {
  baseUrl: string;
  user: { id: string; email: string };
  db: DemoDb;
  onChange?: (db: DemoDb) => void;
  rpc?: Record<string, (args: Record<string, unknown>, db: DemoDb) => unknown>;
  functions?: Record<string, (body: Record<string, unknown>) => unknown | Promise<unknown>>;
  /** Milliseconds of simulated latency per request (0 in tests). */
  latencyMs?: number;
}

// --- relations used by embedded selects (alias:table(cols)) --------------------------------------
const RELATIONS: Record<string, { kind: 'many'; fk: string } | { kind: 'one'; local: string }> = {
  'custom_list_items>custom_list_item_images': { kind: 'many', fk: 'item_id' },
  'custom_list_items>custom_list_statuses': { kind: 'one', local: 'status_id' },
  'custom_list_items>custom_list_types': { kind: 'one', local: 'type_id' },
  'restaurants>restaurant_images': { kind: 'many', fk: 'restaurant_id' },
  'shared_list_items>shared_list_item_comments': { kind: 'many', fk: 'item_id' },
};

// --- deletes that cascade, as the real foreign keys do --------------------------------------------
const CASCADES: Record<string, { table: string; fk: string; action: 'delete' | 'null' }[]> = {
  custom_lists: [
    { table: 'custom_list_items', fk: 'list_id', action: 'delete' },
    { table: 'custom_list_statuses', fk: 'list_id', action: 'delete' },
    { table: 'custom_list_types', fk: 'list_id', action: 'delete' },
  ],
  custom_list_items: [{ table: 'custom_list_item_images', fk: 'item_id', action: 'delete' }],
  custom_list_statuses: [{ table: 'custom_list_items', fk: 'status_id', action: 'null' }],
  custom_list_types: [{ table: 'custom_list_items', fk: 'type_id', action: 'null' }],
  restaurants: [{ table: 'restaurant_images', fk: 'restaurant_id', action: 'delete' }],
  shared_lists: [{ table: 'shared_list_items', fk: 'list_id', action: 'delete' }],
  shared_list_items: [{ table: 'shared_list_item_comments', fk: 'item_id', action: 'delete' }],
  folders: [],
};

export function uuid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// --- small parsers ------------------------------------------------------------------------------
/** Split on commas that are not inside parentheses, braces or double quotes. */
export function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0, quoted = false, cur = '';
  for (const ch of s) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && (ch === '(' || ch === '{')) depth++;
    if (!quoted && (ch === ')' || ch === '}')) depth--;
    if (ch === ',' && depth === 0 && !quoted) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.length) out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}
const unquote = (v: string) => (v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1).replace(/\\"/g, '"') : v);

type SelectNode = { kind: 'star' } | { kind: 'col'; name: string; alias: string } | { kind: 'embed'; table: string; alias: string; children: SelectNode[] };

export function parseSelect(sel: string | null): SelectNode[] {
  if (!sel || sel === '*') return [{ kind: 'star' }];
  return splitTop(sel.replace(/\s+/g, '')).map((part) => {
    if (part === '*') return { kind: 'star' } as const;
    const m = part.match(/^(?:([\w]+):)?([\w]+)(?:![\w]+)?\((.*)\)$/);
    if (m) return { kind: 'embed', alias: m[1] ?? m[2], table: m[2], children: parseSelect(m[3]) } as const;
    const c = part.match(/^(?:([\w]+):)?([\w]+)(?:::\w+)?$/);
    if (!c) throw new Error(`demo backend: unsupported select "${part}"`);
    return { kind: 'col', alias: c[1] ?? c[2], name: c[2] } as const;
  });
}

// --- filtering ----------------------------------------------------------------------------------
type Pred = (row: Row) => boolean;

function compare(a: unknown, b: string): number {
  if (typeof a === 'number') return a - Number(b);
  const as = String(a);
  return as < b ? -1 : as > b ? 1 : 0;
}
const likeToRegex = (p: string, flags: string) =>
  new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[*%]/g, '.*') + '$', flags);
const parseList = (v: string) => splitTop(v.replace(/^[({]|[)}]$/g, '')).map(unquote);
const eqValue = (a: unknown, v: string) => (a === null || a === undefined ? false : typeof a === 'boolean' ? String(a) === v : String(a) === v);

export function predicate(col: string, expr: string): Pred {
  let negate = false;
  if (expr.startsWith('not.')) { negate = true; expr = expr.slice(4); }
  const dot = expr.indexOf('.');
  const op = expr.slice(0, dot);
  const raw = expr.slice(dot + 1);
  let p: Pred;
  switch (op) {
    case 'eq': p = (r) => eqValue(r[col], unquote(raw)); break;
    case 'neq': p = (r) => r[col] !== null && r[col] !== undefined && !eqValue(r[col], unquote(raw)); break;
    case 'gt': p = (r) => r[col] != null && compare(r[col], raw) > 0; break;
    case 'gte': p = (r) => r[col] != null && compare(r[col], raw) >= 0; break;
    case 'lt': p = (r) => r[col] != null && compare(r[col], raw) < 0; break;
    case 'lte': p = (r) => r[col] != null && compare(r[col], raw) <= 0; break;
    case 'is': p = raw === 'null' ? (r) => r[col] === null || r[col] === undefined : (r) => String(r[col]) === raw; break;
    case 'in': { const set = new Set(parseList(raw)); p = (r) => r[col] != null && set.has(String(r[col])); break; }
    case 'cs': { const want = parseList(raw); p = (r) => Array.isArray(r[col]) && want.every((w) => (r[col] as unknown[]).map(String).includes(w)); break; }
    case 'ov': { const want = parseList(raw); p = (r) => Array.isArray(r[col]) && want.some((w) => (r[col] as unknown[]).map(String).includes(w)); break; }
    case 'like': { const re = likeToRegex(raw, ''); p = (r) => r[col] != null && re.test(String(r[col])); break; }
    case 'ilike': { const re = likeToRegex(raw, 'i'); p = (r) => r[col] != null && re.test(String(r[col])); break; }
    default: throw new Error(`demo backend: unsupported filter ${op}`);
  }
  return negate ? (r) => !p(r) : p;
}

function orPredicate(group: string, conj: 'or' | 'and' = 'or'): Pred {
  const parts = splitTop(group.replace(/^\(|\)$/g, '')).map((c): Pred => {
    const nested = c.match(/^(and|or)\((.*)\)$/);
    if (nested) return orPredicate(`(${nested[2]})`, nested[1] as 'and' | 'or');
    const i = c.indexOf('.');
    return predicate(c.slice(0, i), c.slice(i + 1));
  });
  return conj === 'or' ? (r) => parts.some((p) => p(r)) : (r) => parts.every((p) => p(r));
}

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);

function filtersOf(params: URLSearchParams): Pred[] {
  const preds: Pred[] = [];
  for (const [k, v] of params) {
    if (RESERVED.has(k)) continue;
    if (k === 'or') preds.push(orPredicate(v));
    else if (k === 'and') preds.push(orPredicate(v, 'and'));
    else if (k.includes('.')) continue; // filters on embedded resources: not used by the app
    else preds.push(predicate(k, v));
  }
  return preds;
}

function sortRows(rows: Row[], order: string | null): Row[] {
  if (!order) return rows;
  const keys = splitTop(order).map((o) => {
    const [col, ...mods] = o.split('.');
    return { col, desc: mods.includes('desc'), nullsFirst: mods.includes('nullsfirst') ? true : mods.includes('nullslast') ? false : mods.includes('desc') };
  });
  return [...rows].sort((a, b) => {
    for (const k of keys) {
      const x = a[k.col], y = b[k.col];
      const xn = x === null || x === undefined, yn = y === null || y === undefined;
      if (xn || yn) { if (xn && yn) continue; return (xn ? -1 : 1) * (k.nullsFirst ? 1 : -1); }
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      if (c !== 0) return k.desc ? -c : c;
    }
    return 0;
  });
}

// --- shaping ------------------------------------------------------------------------------------
function relation(parent: string, child: string) {
  const known = RELATIONS[`${parent}>${child}`];
  if (known) return known;
  const singular = (t: string) => t.replace(/ies$/, 'y').replace(/s$/, '');
  if (DEMO_SCHEMA[child]?.columns.includes(`${singular(parent)}_id`)) return { kind: 'many' as const, fk: `${singular(parent)}_id` };
  if (DEMO_SCHEMA[parent]?.columns.includes(`${singular(child)}_id`)) return { kind: 'one' as const, local: `${singular(child)}_id` };
  throw new Error(`demo backend: no relation ${parent} -> ${child}`);
}

function shape(db: DemoDb, table: string, row: Row, nodes: SelectNode[]): Row {
  const out: Row = {};
  for (const n of nodes) {
    if (n.kind === 'star') Object.assign(out, structuredClone(row));
    else if (n.kind === 'col') out[n.alias] = structuredClone(row[n.name] ?? null);
    else {
      const rel = relation(table, n.table);
      const rows = db[n.table] ?? [];
      if (rel.kind === 'many') out[n.alias] = rows.filter((r) => r[rel.fk] === row.id).map((r) => shape(db, n.table, r, n.children));
      else { const hit = rows.find((r) => r.id === row[rel.local]); out[n.alias] = hit ? shape(db, n.table, hit, n.children) : null; }
    }
  }
  return out;
}

function withDefaults(table: string, input: Row): Row {
  const schema = DEMO_SCHEMA[table];
  const now = new Date().toISOString();
  const row: Row = {};
  if (schema) {
    for (const c of schema.columns) {
      if (c in input) continue;
      const d = schema.defaults[c];
      row[c] = d === '__now__' ? now : d === '__uuid__' ? uuid() : d === undefined ? null : structuredClone(d);
    }
  }
  return { ...row, ...input };
}

function pgError(status: number, code: string, message: string) {
  return new Response(JSON.stringify({ code, message, details: null, hint: null }), { status, headers: { 'content-type': 'application/json' } });
}

// --- the handler --------------------------------------------------------------------------------
export function createDemoFetch(opts: DemoBackendOptions): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  const { db } = opts;
  const changed = () => opts.onChange?.(db);
  const now = () => new Date().toISOString();
  const session = {
    access_token: 'demo-access-token', token_type: 'bearer', expires_in: 315360000,
    expires_at: Math.floor(Date.now() / 1000) + 315360000, refresh_token: 'demo-refresh-token',
    user: demoUser(opts.user),
  };

  const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });

  async function rest(method: string, path: string, params: URLSearchParams, headers: Headers, body: unknown): Promise<Response> {
    const table = path;
    if (!(table in db)) db[table] = [];
    const rows = db[table];
    const nodes = parseSelect(params.get('select'));
    const prefer = headers.get('prefer') ?? '';
    const wantObject = (headers.get('accept') ?? '').includes('vnd.pgrst.object');
    const wantCount = /count=(exact|planned|estimated)/.test(prefer);
    const representation = prefer.includes('return=representation');

    const finish = (result: Row[], status: number, total?: number) => {
      const shaped = result.map((r) => shape(db, table, r, nodes));
      const h: Record<string, string> = {};
      if (wantCount || total !== undefined) h['content-range'] = `${shaped.length ? `0-${shaped.length - 1}` : '*'}/${total ?? shaped.length}`;
      if (method === 'HEAD') return new Response(null, { status: 200, headers: h });
      if (wantObject) {
        if (shaped.length !== 1) return pgError(406, 'PGRST116', `JSON object requested, multiple (or no) rows returned`);
        return json(shaped[0], status, h);
      }
      if ((method === 'POST' || method === 'PATCH' || method === 'DELETE') && !representation) return new Response(null, { status: method === 'POST' ? 201 : 204, headers: h });
      return json(shaped, status, h);
    };

    if (method === 'GET' || method === 'HEAD') {
      const preds = filtersOf(params);
      const matched = sortRows(rows.filter((r) => preds.every((p) => p(r))), params.get('order'));
      const offset = Number(params.get('offset') ?? 0);
      const limit = params.has('limit') ? Number(params.get('limit')) : undefined;
      return finish(matched.slice(offset, limit === undefined ? undefined : offset + limit), 200, wantCount ? matched.length : undefined);
    }

    if (method === 'POST') {
      const list = (Array.isArray(body) ? body : [body]) as Row[];
      const onConflict = (params.get('on_conflict') ?? 'id').split(',');
      const merge = prefer.includes('resolution=merge-duplicates');
      const ignore = prefer.includes('resolution=ignore-duplicates');
      const out: Row[] = [];
      for (const input of list) {
        const candidate = withDefaults(table, input);
        const existing = rows.find((r) => onConflict.every((c) => candidate[c] !== undefined && candidate[c] !== null && r[c] === candidate[c]));
        if (existing) {
          if (merge) { Object.assign(existing, input, 'updated_at' in existing ? { updated_at: now() } : {}); out.push(existing); continue; }
          if (ignore) continue;
          return pgError(409, '23505', `duplicate key value violates unique constraint "${table}_pkey"`);
        }
        rows.push(candidate);
        out.push(candidate);
      }
      changed();
      return finish(out, 201);
    }

    if (method === 'PATCH') {
      const preds = filtersOf(params);
      const hit = rows.filter((r) => preds.every((p) => p(r)));
      for (const r of hit) Object.assign(r, body as Row, 'updated_at' in r && !(body as Row).updated_at ? { updated_at: now() } : {});
      changed();
      return finish(hit, 200);
    }

    if (method === 'DELETE') {
      const preds = filtersOf(params);
      const hit = rows.filter((r) => preds.every((p) => p(r)));
      const removeRows = (t: string, gone: Row[]) => {
        if (!gone.length) return;
        // Remove exactly the matched rows (by identity), so tables without an
        // `id` column (composite keys, e.g. notification_consents) only lose
        // the rows that matched, not every row whose id is undefined.
        const goneRows = new Set(gone);
        const ids = new Set(gone.map((g) => g.id).filter((id) => id !== undefined && id !== null));
        db[t] = (db[t] ?? []).filter((r) => !goneRows.has(r));
        for (const c of CASCADES[t] ?? []) {
          const children = (db[c.table] ?? []).filter((r) => ids.has(r[c.fk]));
          if (c.action === 'delete') removeRows(c.table, children);
          else children.forEach((r) => { r[c.fk] = null; });
        }
      };
      removeRows(table, hit);
      changed();
      return finish(hit, 200);
    }
    return pgError(405, 'PGRST000', `method ${method} not supported by the demo backend`);
  }

  return async (input, init) => {
    const req = input instanceof Request ? input : null;
    const url = new URL(req ? req.url : String(input));
    const method = (init?.method ?? req?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers ?? req?.headers);
    if (opts.latencyMs) await new Promise((r) => setTimeout(r, opts.latencyMs));
    let body: unknown = undefined;
    const rawBody = init?.body ?? (req && method !== 'GET' && method !== 'HEAD' ? await req.clone().text() : undefined);
    if (typeof rawBody === 'string' && rawBody.length) { try { body = JSON.parse(rawBody); } catch { body = rawBody; } }

    const p = url.pathname;
    try {
      if (p.startsWith('/rest/v1/rpc/')) {
        const fn = p.slice('/rest/v1/rpc/'.length);
        const handler = opts.rpc?.[fn];
        return json(handler ? await handler((body as Record<string, unknown>) ?? Object.fromEntries(url.searchParams), db) : []);
      }
      if (p.startsWith('/rest/v1/')) return await rest(method, p.slice('/rest/v1/'.length), url.searchParams, headers, body);
      if (p.startsWith('/auth/v1/')) {
        const what = p.slice('/auth/v1/'.length);
        if (what === 'user') return json(session.user);
        if (what.startsWith('token') || what === 'signup') return json(session);
        if (what === 'logout') return new Response(null, { status: 204 });
        return json({});
      }
      if (p.startsWith('/functions/v1/')) {
        const fn = p.slice('/functions/v1/'.length);
        const handler = opts.functions?.[fn];
        if (!handler) return json({ error: 'Not available in the demo.' }, 503);
        return json(await handler((body as Record<string, unknown>) ?? {}));
      }
      return json({ error: 'Not available in the demo.' }, 404);
    } catch (e) {
      return pgError(400, 'DEMO', e instanceof Error ? e.message : String(e));
    }
  };
}

export function demoUser(u: { id: string; email: string }) {
  return {
    id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: '2026-01-01T00:00:00Z',
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [],
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  };
}
