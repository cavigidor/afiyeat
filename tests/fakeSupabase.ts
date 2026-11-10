import { vi } from 'vitest';

/**
 * A small in-memory stand-in for the parts of the Supabase client the photo
 * code uses: storage upload / createSignedUrl / remove, and insert-select /
 * select-by-id / select-eq-order on the two attachment tables. It records
 * every call, so tests can assert exactly what was written and that nothing
 * else was touched.
 *
 * Signing honours a per-viewer "can read" rule that mirrors the storage
 * policies (owner folder, or an accepted follower for restaurant-images):
 * objects the viewer can't read are answered with "Object not found", exactly
 * like the real API.
 *
 * Failure "plans" script what the network does on the next calls. Each entry
 * is consumed by one call; an empty plan means "works normally".
 *  - upload:  'rejected'  413 from storage, nothing stored
 *             'lost'      stored, but the response is lost (network error)
 *             'dropped'   network error, nothing stored
 *             'hang'      never answers (and stores nothing)
 *  - insert:  'rejected'  403 + 42501 from PostgREST, nothing written
 *             'lost'      written, but the response is lost (status 0)
 *             'dropped'   network error before the write (status 0)
 *             'noReadback' written, but no row comes back (406 PGRST116)
 *             'hang'      never answers; writes after `lateCommitMs` if set
 *             'gateway'   502 without a database error code, nothing written
 *  - lookup:  'error'     the lookup itself fails
 *             'hang'      never answers
 */
export interface FakeRow {
  id: string;
  image_url: string;
  restaurant_id?: string;
  item_id?: string;
  user_id: string;
  created_at: string;
}

type UploadMode = 'rejected' | 'lost' | 'dropped' | 'hang';
type InsertMode = 'rejected' | 'lost' | 'dropped' | 'noReadback' | 'hang' | 'gateway';
type LookupMode = 'error' | 'hang';

const never = () => new Promise<never>(() => {});
const networkError = { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' };

export function createFakeSupabase() {
  const objects = new Map<string, Blob>(); // `${bucket}/${path}`
  const tables: Record<string, FakeRow[]> = { restaurant_images: [], custom_list_item_images: [] };
  const calls: { op: string; bucket?: string; table?: string; path?: string; payload?: unknown }[] = [];
  const state = {
    viewer: 'user-1',
    followers: new Set<string>(), // `${follower}->${owner}` accepted follows
    uploadPlan: [] as UploadMode[],
    insertPlan: [] as InsertMode[],
    lookupPlan: [] as LookupMode[],
    /** For insert 'hang': commit this long after the call (simulates a slow server). */
    lateCommitMs: null as number | null,
    failSign: null as null | { status: number; message: string },
    signCount: 0,
    seq: 0,
    /** Back-compat shorthands used by older tests. */
    set failUpload(n: number) {
      state.uploadPlan.push(...Array<UploadMode>(n).fill('rejected'));
    },
    set failInsert(n: number) {
      state.insertPlan.push(...Array<InsertMode>(n).fill('rejected'));
    },
  };

  const canRead = (bucket: string, path: string) => {
    const owner = path.split('/')[0];
    if (owner === state.viewer) return true;
    return bucket === 'restaurant-images' && state.followers.has(`${state.viewer}->${owner}`);
  };

  const storage = {
    from: (bucket: string) => ({
      upload: vi.fn(async (path: string, file: Blob) => {
        calls.push({ op: 'upload', bucket, path });
        const key = `${bucket}/${path}`;
        const mode = state.uploadPlan.shift();
        if (mode === 'rejected') {
          return { data: null, error: { message: 'The object exceeded the maximum allowed size', status: 413, statusCode: '413' } };
        }
        if (mode === 'dropped') return { data: null, error: { name: 'StorageUnknownError', message: 'Failed to fetch' } };
        if (mode === 'hang') return never();
        if (path.split('/')[0] !== state.viewer) {
          return { data: null, error: { message: 'new row violates row-level security policy', status: 403, statusCode: '403' } };
        }
        if (objects.has(key)) {
          return { data: null, error: { message: 'The resource already exists', status: 409, statusCode: '409' } };
        }
        objects.set(key, file);
        if (mode === 'lost') return { data: null, error: { name: 'StorageUnknownError', message: 'Failed to fetch' } };
        return { data: { path }, error: null };
      }),
      createSignedUrl: vi.fn(async (path: string, expiresIn: number) => {
        state.signCount++;
        calls.push({ op: 'sign', bucket, path });
        if (state.failSign) return { data: null, error: state.failSign };
        if (!objects.has(`${bucket}/${path}`) || !canRead(bucket, path)) {
          return { data: null, error: { message: 'Object not found', status: 400, statusCode: '404' } };
        }
        return {
          data: { signedUrl: `https://cdn.test/storage/v1/object/sign/${bucket}/${path}?token=t${state.signCount}&e=${expiresIn}` },
          error: null,
        };
      }),
      remove: vi.fn(async (paths: string[]) => {
        calls.push({ op: 'remove', bucket, payload: paths });
        for (const p of paths) objects.delete(`${bucket}/${p}`);
        return { data: [], error: null };
      }),
    }),
  };

  const visible = (r: FakeRow) => r.user_id === state.viewer || state.followers.has(`${state.viewer}->${r.user_id}`);

  const from = (table: string) => {
    const write = (row: Partial<FakeRow>) => {
      if (tables[table].some((r) => r.id === row.id)) return 'duplicate' as const;
      const saved = {
        ...row,
        id: row.id ?? `img-${++state.seq}`,
        created_at: new Date(2026, 0, ++state.seq).toISOString(),
      } as FakeRow;
      tables[table].push(saved);
      return saved;
    };

    return {
      insert: (row: Partial<FakeRow>) => ({
        select: () => ({
          single: async () => {
            calls.push({ op: 'insert', table, payload: row });
            const mode = state.insertPlan.shift();
            if (mode === 'rejected') {
              return { data: null, status: 403, error: { message: 'new row violates row-level security policy', code: '42501' } };
            }
            if (mode === 'gateway') return { data: null, status: 502, error: { message: 'Bad Gateway', code: '' } };
            if (mode === 'dropped') return { data: null, status: 0, error: networkError };
            if (mode === 'hang') {
              if (state.lateCommitMs != null) setTimeout(() => write(row), state.lateCommitMs);
              return never();
            }
            const saved = write(row);
            if (saved === 'duplicate') {
              return { data: null, status: 409, error: { message: 'duplicate key value violates unique constraint', code: '23505' } };
            }
            if (mode === 'lost') return { data: null, status: 0, error: networkError };
            if (mode === 'noReadback') {
              return { data: null, status: 406, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' } };
            }
            return { data: { id: saved.id, image_url: saved.image_url }, status: 201, error: null };
          },
        }),
      }),
      select: () => ({
        eq: (column: keyof FakeRow, value: string) => ({
          // Lookup by id after an unclear insert.
          maybeSingle: async () => {
            calls.push({ op: 'lookup', table, payload: value });
            const mode = state.lookupPlan.shift();
            if (mode === 'error') return { data: null, status: 0, error: networkError };
            if (mode === 'hang') return never();
            const found = tables[table].find((r) => r[column] === value && visible(r));
            return { data: found ? { id: found.id, image_url: found.image_url } : null, status: 200, error: null };
          },
          order: async () => ({
            data: tables[table].filter((r) => r[column] === value && visible(r)).map(({ id, image_url }) => ({ id, image_url })),
            error: null,
          }),
        }),
      }),
      delete: () => ({
        eq: async (_column: string, id: string) => {
          calls.push({ op: 'delete', table, payload: id });
          tables[table] = tables[table].filter((r) => r.id !== id);
          return { error: null };
        },
      }),
    };
  };

  /** Put an object (and optionally its row) in place, as if uploaded earlier. */
  const seed = (bucket: string, path: string, row?: Partial<FakeRow> & { table: string; image_url: string }) => {
    objects.set(`${bucket}/${path}`, new Blob(['x'], { type: 'image/jpeg' }));
    if (row) {
      const { table, ...rest } = row;
      tables[table].push({
        id: rest.id ?? `seed-${++state.seq}`,
        user_id: rest.user_id ?? path.split('/')[0],
        created_at: new Date(2025, 0, ++state.seq).toISOString(),
        ...rest,
      } as FakeRow);
    }
  };

  return { client: { storage, from }, objects, tables, calls, state, seed };
}

export type FakeSupabase = ReturnType<typeof createFakeSupabase>;
