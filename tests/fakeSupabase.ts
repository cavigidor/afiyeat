import { vi } from 'vitest';

/**
 * A small in-memory stand-in for the parts of the Supabase client the photo
 * code uses: storage upload / createSignedUrl / remove, and insert-select /
 * select-eq-order on the two attachment tables. It records every call, so
 * tests can assert exactly what was written and that nothing else was touched.
 *
 * Signing honours a per-viewer "can read" rule that mirrors the storage
 * policies (owner folder, or an accepted follower for restaurant-images):
 * objects the viewer can't read are answered with "Object not found", exactly
 * like the real API.
 */
export interface FakeRow {
  id: string;
  image_url: string;
  restaurant_id?: string;
  item_id?: string;
  user_id: string;
  created_at: string;
}

export function createFakeSupabase() {
  const objects = new Map<string, Blob>(); // `${bucket}/${path}`
  const tables: Record<string, FakeRow[]> = { restaurant_images: [], custom_list_item_images: [] };
  const calls: { op: string; bucket?: string; table?: string; path?: string; payload?: unknown }[] = [];
  const state = {
    viewer: 'user-1',
    followers: new Set<string>(), // `${follower}->${owner}` accepted follows
    failUpload: 0, // number of upcoming uploads to fail
    failInsert: 0,
    failSign: null as null | { status: number; message: string },
    signCount: 0,
    seq: 0,
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
        if (state.failUpload > 0) {
          state.failUpload--;
          return { data: null, error: { message: 'The object exceeded the maximum allowed size', statusCode: '413' } };
        }
        if (path.split('/')[0] !== state.viewer) {
          return { data: null, error: { message: 'new row violates row-level security policy', statusCode: '403' } };
        }
        objects.set(`${bucket}/${path}`, file);
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

  const from = (table: string) => ({
    insert: (row: Omit<FakeRow, 'id' | 'created_at'>) => ({
      select: () => ({
        single: async () => {
          calls.push({ op: 'insert', table, payload: row });
          if (state.failInsert > 0) {
            state.failInsert--;
            return { data: null, error: { message: 'insert failed', code: '42501' } };
          }
          const saved: FakeRow = { ...row, id: `img-${++state.seq}`, created_at: new Date(2026, 0, state.seq).toISOString() };
          tables[table].push(saved);
          return { data: { id: saved.id, image_url: saved.image_url }, error: null };
        },
      }),
    }),
    select: () => ({
      eq: (column: keyof FakeRow, value: string) => ({
        order: async () => ({
          data: tables[table]
            .filter((r) => r[column] === value && (r.user_id === state.viewer || state.followers.has(`${state.viewer}->${r.user_id}`)))
            .map(({ id, image_url }) => ({ id, image_url })),
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
  });

  /** Put an object (and optionally its row) in place, as if uploaded earlier. */
  const seed = (bucket: string, path: string, row?: Partial<FakeRow> & { table: string; image_url: string }) => {
    objects.set(`${bucket}/${path}`, new Blob(['x'], { type: 'image/jpeg' }));
    if (row) {
      const { table, ...rest } = row;
      tables[table].push({
        id: rest.id ?? `seed-${++state.seq}`,
        user_id: rest.user_id ?? path.split('/')[0],
        created_at: new Date(2025, 0, state.seq).toISOString(),
        ...rest,
      } as FakeRow);
    }
  };

  return { client: { storage, from }, objects, tables, calls, state, seed };
}

export type FakeSupabase = ReturnType<typeof createFakeSupabase>;
