// Representative dataset for the compatibility lab. SYNTHETIC: no production
// data is read or copied. It reproduces the SHAPES existing users have,
// as the old app (main 9baf34e) created them:
//   - every old preset (Movies, Shows, Books, Concerts, Wines, Beers, Coffee
//     Shops) plus a plain list, with the exact field settings, price/rating
//     modes and status names the old app used
//   - "legacy" lists from before custom statuses existed (no
//     custom_list_statuses rows; items use status todo/done + list labels)
//   - items using single (type_id) and multiple (type_ids) categories,
//     manual price/rating, completed_at, notes on lists whose notes field is
//     now HIDDEN (show_notes=false), emoji/long text, no address but coords
//   - photos in both stored formats: full production-style public URL (old
//     app) and bare storage path, plus one row whose file is missing
//   - My Restaurants with folders (folder_id and folder_ids) and photos
//   - privacy: public, private, accepted and pending follows, a block
//   - a shared list between two users with items from both and comments
// Deterministic UUIDs, so snapshots and reports are stable across runs.
import crypto from 'node:crypto';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { psql } from './db.mjs';
import { STATE } from './gateway.mjs';

export const id = (name) => {
  const h = crypto.createHash('sha1').update(`afiyeat-compat-lab:${name}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const q = (v) => v === null || v === undefined ? 'NULL' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : Array.isArray(v) ? `ARRAY[${v.map(q).join(',')}]::uuid[]` : `'${String(v).replace(/'/g, "''")}'`;
const PROD = 'https://dmlkjpjubneqhbqoxlct.supabase.co';

export const USERS = {
  ayla: { email: 'ayla@lab.afiyeat.test', username: 'ayla', name: 'Ayla (owner, public)', private: false },
  bora: { email: 'bora@lab.afiyeat.test', username: 'bora', name: 'Bora (mutual follower)', private: false },
  cem: { email: 'cem@lab.afiyeat.test', username: 'cem_private', name: 'Cem (private account)', private: true },
  deniz: { email: 'deniz@lab.afiyeat.test', username: 'deniz', name: 'Deniz (stranger, pending on Cem)', private: false },
  ece: { email: 'ece@lab.afiyeat.test', username: 'ece', name: 'Ece (shares a list with Ayla)', private: false },
  fikret: { email: 'fikret@lab.afiyeat.test', username: 'fikret', name: 'Fikret (blocked by Ayla)', private: false },
};
for (const [k, u] of Object.entries(USERS)) { u.key = k; u.id = id(`user:${k}`); u.password = `lab-${k}-password`; }

// Old-app presets, copied from main's CreateListDialog LIST_PRESETS.
const PRESETS = {
  Movies: { icon: '🎬', loc: false, price: false, pm: 'dollar', rating: true, rm: 'stars_5', notes: true, photos: false, statuses: ['Want to Watch', 'Watched'] },
  Shows: { icon: '📺', loc: false, price: false, pm: 'dollar', rating: true, rm: 'stars_5', notes: true, photos: false, statuses: ['Want to Watch', 'Watching', 'Finished'] },
  Books: { icon: '📚', loc: false, price: false, pm: 'dollar', rating: true, rm: 'stars_5', notes: true, photos: true, statuses: ['Want to Read', 'Reading', 'Read'] },
  Concerts: { icon: '🎵', loc: true, price: true, pm: 'manual', rating: true, rm: 'stars_5', notes: true, photos: true, statuses: ['Want to Go', 'Been'] },
  Wines: { icon: '🍷', loc: false, price: true, pm: 'manual', rating: true, rm: 'scale_10', notes: true, photos: true, statuses: ['Want to Try', 'Tried'] },
  Beers: { icon: '🍺', loc: false, price: false, pm: 'dollar', rating: true, rm: 'scale_10', notes: true, photos: true, statuses: ['Want to Try', 'Tried'] },
  'Coffee Shops': { icon: '☕', loc: true, price: true, pm: 'dollar', rating: true, rm: 'scale_10', notes: true, photos: true, statuses: ['Want to Go', 'Been There'] },
  Plain: { icon: '📋', loc: true, price: true, pm: 'dollar', rating: false, rm: 'scale_10', notes: true, photos: true, statuses: ['To Do', 'Done'] },
};

// A tiny valid PNG in a given colour (so photos render and differ).
function png(r, g, b) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const W = 16, H = 16, ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((W * 3 + 1) * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) raw.set([r, g, b], y * (W * 3 + 1) + 1 + x * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export function buildSeed() {
  const sql = [];
  const files = []; // {bucket, name, data}
  const ins = (table, row) => sql.push(`INSERT INTO ${table} (${Object.keys(row).join(', ')}) VALUES (${Object.values(row).map(q).join(', ')});`);
  const t0 = Date.parse('2026-03-01T12:00:00Z');
  let tick = 0; const ts = () => new Date(t0 + (tick++) * 3600_000).toISOString();

  // Users (auth.users insert fires handle_new_user -> profile + default folders, as in production)
  for (const u of Object.values(USERS)) {
    sql.push(`INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at, created_at) VALUES (${q(u.id)}, ${q(u.email)}, ${q(JSON.stringify({ username: u.username, display_name: u.name }))}::jsonb, now(), ${q(ts())});`);
    sql.push(`UPDATE public.profiles SET is_private = ${u.private}, bio = ${q(`Lab account: ${u.name}`)}, timezone = 'America/Chicago' WHERE user_id = ${q(u.id)};`);
  }
  // Follows (insert as accepted/pending; enforce_follow_status trigger may adjust - snapshot records what production logic stored)
  const follow = (a, b, status) => ins('public.follows', { id: id(`follow:${a}->${b}`), follower_id: USERS[a].id, following_id: USERS[b].id, status, created_at: ts() });
  follow('bora', 'ayla', 'accepted'); follow('ayla', 'bora', 'accepted');
  follow('ayla', 'cem', 'accepted'); follow('deniz', 'cem', 'pending'); follow('ece', 'ayla', 'accepted');
  // Production's enforce_follow_status trigger makes a follow of a private account 'pending';
  // Cem then approves Ayla's request (Deniz's stays pending), exactly as in the app.
  sql.push(`UPDATE public.follows SET status = 'accepted' WHERE follower_id = ${q(USERS.ayla.id)} AND following_id = ${q(USERS.cem.id)};`);
  ins('public.blocked_users', { id: id('block:ayla->fikret'), blocker_id: USERS.ayla.id, blocked_id: USERS.fikret.id, created_at: ts() });

  // Buckets: restaurant-images comes from the migrations; custom-list-images was created outside them in production.
  sql.push(`INSERT INTO storage.buckets (id, name, public) VALUES ('custom-list-images', 'custom-list-images', false) ON CONFLICT (id) DO NOTHING;`);

  const photo = (bucket, owner, folderId, n, fmt, color) => {
    const name = `${owner.id}/${folderId}/${n}.png`;
    files.push({ bucket, name, data: png(...color), owner: owner.id });
    return fmt === 'prod-url' ? `${PROD}/storage/v1/object/public/${bucket}/${name}` : name;
  };

  // ---- Custom lists
  const lists = [];
  const makeList = (owner, key, label, preset, opts = {}) => {
    const p = PRESETS[preset];
    const L = { id: id(`list:${owner}:${key}`), owner, key, preset, statuses: [], types: [] };
    ins('public.custom_lists', {
      id: L.id, user_id: USERS[owner].id, name: label, icon: opts.icon ?? p.icon, color: opts.color ?? '#E91E63',
      show_location: opts.loc ?? p.loc, show_notes: opts.notes ?? p.notes, show_photos: opts.photos ?? p.photos,
      show_price: opts.price ?? p.price, price_mode: p.pm, show_rating: opts.rating ?? p.rating, rating_mode: p.rm,
      status_todo_label: opts.todo ?? 'To Do', status_done_label: opts.done ?? 'Done', sort_order: lists.length, created_at: ts(),
    });
    if (!opts.legacyNoStatuses) {
      p.statuses.forEach((s, i) => { const sid = id(`status:${L.id}:${s}`); L.statuses.push({ id: sid, name: s }); ins('public.custom_list_statuses', { id: sid, list_id: L.id, user_id: USERS[owner].id, name: s, sort_order: i, created_at: ts() }); });
    }
    for (const [i, t] of (opts.types ?? []).entries()) { const tid = id(`type:${L.id}:${t}`); L.types.push({ id: tid, name: t }); ins('public.custom_list_types', { id: tid, list_id: L.id, user_id: USERS[owner].id, name: t, color: ['#E91E63', '#2196F3', '#4CAF50', '#FF9800'][i % 4], sort_order: i, created_at: ts() }); }
    lists.push(L);
    return L;
  };
  const item = (L, name, f = {}) => {
    const iid = id(`item:${L.id}:${name}`);
    const st = f.statusIdx !== undefined ? L.statuses[f.statusIdx] : null;
    ins('public.custom_list_items', {
      id: iid, list_id: L.id, user_id: USERS[L.owner].id, name, address: f.address ?? null, latitude: f.lat ?? null, longitude: f.lng ?? null,
      price_level: f.price ?? null, rating: f.rating ?? null, notes: f.notes ?? null, status: f.status ?? (st && f.statusIdx === L.statuses.length - 1 ? 'done' : 'todo'),
      completed_at: f.completed ?? null, type_id: f.type !== undefined ? L.types[f.type].id : null, price_manual: f.priceManual ?? null, rating_manual: f.ratingManual ?? null,
      status_id: st ? st.id : null, apple_place_id: f.apple ?? null, created_at: ts(), updated_at: ts(),
    });
    if (f.typeIds) sql.push(`UPDATE public.custom_list_items SET type_ids = ${q(f.typeIds.map((i) => L.types[i].id))} WHERE id = ${q(iid)};`);
    for (const [n, ph] of (f.photos ?? []).entries()) {
      const url = ph === 'missing' ? `${USERS[L.owner].id}/${iid}/missing-file.png` : photo('custom-list-images', USERS[L.owner], iid, n, ph, [40 * n + 60, 120, 200 - 30 * n]);
      ins('public.custom_list_item_images', { id: id(`cli-img:${iid}:${n}`), item_id: iid, user_id: USERS[L.owner].id, image_url: url, created_at: ts() });
    }
    return iid;
  };

  // Ayla: one list per old preset + plain + legacy shapes
  const coffee = makeList('ayla', 'coffee', 'Coffee Shops ☕ İstanbul', 'Coffee Shops', { types: ['Espresso bar', 'Roastery', 'Third wave'] });
  item(coffee, 'Kronotrop', { statusIdx: 1, address: 'Cihangir, Beyoğlu', lat: 41.0322, lng: 28.9827, price: 2, rating: 9, notes: 'Best V60 on the hill', type: 2, typeIds: [1, 2], apple: 'I1A2B3C4D5', completed: '2026-03-04T09:00:00Z', photos: ['prod-url', 'path'] });
  item(coffee, 'Petra Roasting Co.', { statusIdx: 0, address: 'Gayrettepe', lat: 41.068, lng: 29.006, price: 3, type: 1, photos: ['path'] });
  item(coffee, 'Café without address', { statusIdx: 0, lat: 41.0, lng: 29.0, notes: null });
  item(coffee, 'Tiny espresso window 🫘', { statusIdx: 1, address: 'Kadıköy', price: 1, rating: 7, typeIds: [0] });
  const wines = makeList('ayla', 'wines', 'Wines', 'Wines');
  item(wines, 'Ridge Lytton Springs 2019', { statusIdx: 1, priceManual: 48.5, rating: 9, notes: 'Zinfandel blend, jammy', photos: ['prod-url'] });
  item(wines, 'Kavaklıdere Yakut', { statusIdx: 0, priceManual: 12, notes: 'Weeknight bottle' });
  const books = makeList('ayla', 'books', 'Books 2026', 'Books');
  item(books, 'Kürk Mantolu Madonna', { statusIdx: 2, ratingManual: 4.5, rating: 9, notes: 'Re-read in March', completed: '2026-03-10T20:00:00Z' });
  item(books, 'The Overstory', { statusIdx: 1, notes: 'x'.repeat(1800) });
  item(books, 'Ince Memed', { statusIdx: 0 });
  const movies = makeList('ayla', 'movies', 'Movies', 'Movies');
  item(movies, 'Kış Uykusu', { statusIdx: 1, ratingManual: 5, rating: 10 });
  item(movies, 'Perfect Days', { statusIdx: 0 });
  const shows = makeList('ayla', 'shows', 'Shows', 'Shows');
  item(shows, 'Bir Başkadır', { statusIdx: 2, rating: 9 });
  const concerts = makeList('ayla', 'concerts', 'Concerts', 'Concerts');
  item(concerts, 'Jazz at Nardis', { statusIdx: 0, address: 'Galata', lat: 41.0256, lng: 28.9741, priceManual: 25, photos: ['path', 'missing'] });
  const beers = makeList('ayla', 'beers', 'Beers', 'Beers');
  item(beers, 'Bomonti Filtresiz', { statusIdx: 1, rating: 6 });
  // A list whose NOTES field the owner hid after writing notes: values must survive.
  const hidden = makeList('ayla', 'hidden-notes', 'Bakeries (notes hidden)', 'Plain', { notes: false, rating: true, price: false });
  item(hidden, 'Savoy Pastanesi', { statusIdx: 1, notes: 'HIDDEN-NOTE: get the profiterol', price: 2, rating: 8 });
  item(hidden, 'Divan Pastanesi', { statusIdx: 0, notes: 'HIDDEN-NOTE: try the cake' });
  // Legacy: created before custom statuses (no status rows, custom todo/done labels, status todo/done only)
  const legacy = makeList('ayla', 'legacy', 'Old travel list (pre-statuses)', 'Plain', { legacyNoStatuses: true, todo: 'Someday', done: 'Visited', icon: '✈️' });
  item(legacy, 'Kapadokya', { status: 'done', address: 'Göreme', lat: 38.6431, lng: 34.8289, completed: '2025-09-01T08:00:00Z', notes: 'Balloon at sunrise' });
  item(legacy, 'Mardin', { status: 'todo', address: 'Mardin' });
  makeList('ayla', 'empty', 'Empty list', 'Plain');
  const big = makeList('ayla', 'big', 'Big list (60 items)', 'Plain', { types: ['A', 'B'] });
  for (let i = 1; i <= 60; i++) item(big, `Place ${String(i).padStart(2, '0')}`, { statusIdx: i % 2, type: i % 2, price: (i % 4) + 1, address: `Street ${i}` });

  // Other users' lists (privacy)
  const boraL = makeList('bora', 'bora-coffee', "Bora's coffee", 'Coffee Shops');
  item(boraL, 'Bora pick 1', { statusIdx: 0, photos: ['path'] });
  const cemL = makeList('cem', 'cem-secret', "Cem's private list", 'Plain');
  item(cemL, 'Cem private place', { statusIdx: 0, notes: 'only followers' });
  const fikL = makeList('fikret', 'fikret-list', "Fikret's list", 'Plain');
  item(fikL, 'Fikret place', { statusIdx: 0 });

  // My Restaurants
  const folderOf = (u, name) => `(SELECT id FROM public.folders WHERE user_id = ${q(USERS[u].id)} ORDER BY created_at, name LIMIT 1 OFFSET ${name})`;
  const rest = (owner, key, f) => {
    const rid = id(`restaurant:${owner}:${key}`);
    sql.push(`INSERT INTO public.restaurants (id, user_id, name, address, latitude, longitude, notes, rating, price_level, status, visited_at, place_id, category, apple_place_id, folder_id, created_at, updated_at) VALUES (${[rid, USERS[owner].id, f.name, f.address ?? null, f.lat ?? null, f.lng ?? null, f.notes ?? null, f.rating ?? null, f.price ?? null, f.status ?? 'to_go', f.visited ?? null, f.place ?? null, f.category ?? null, f.apple ?? null].map(q).join(', ')}, ${f.folder !== undefined ? folderOf(owner, f.folder) : 'NULL'}, ${q(ts())}, ${q(ts())});`);
    if (f.folders) sql.push(`UPDATE public.restaurants SET folder_ids = ARRAY(SELECT id FROM public.folders WHERE user_id = ${q(USERS[owner].id)} ORDER BY created_at, name LIMIT ${f.folders}) WHERE id = ${q(rid)};`);
    for (const [n, ph] of (f.photos ?? []).entries()) {
      const url = photo('restaurant-images', USERS[owner], rid, n, ph, [220, 80 + 40 * n, 60]);
      ins('public.restaurant_images', { id: id(`r-img:${rid}:${n}`), restaurant_id: rid, user_id: USERS[owner].id, image_url: url, caption: n === 0 ? 'first photo' : null, created_at: ts() });
    }
  };
  rest('ayla', 'ciya', { name: 'Çiya Sofrası', address: 'Kadıköy', lat: 40.9905, lng: 29.0265, status: 'went_to', rating: 9, price: 2, visited: '2026-02-11T19:00:00Z', category: 'Turkish', notes: 'Kebab of the day', folder: 0, folders: 2, apple: 'IAPPLECIYA', place: 'ChIJ-legacy-google-id', photos: ['prod-url', 'path', 'prod-url'] });
  rest('ayla', 'karakoy', { name: 'Karaköy Lokantası', address: 'Karaköy', status: 'to_go', price: 3, category: 'Meyhane', photos: ['path'] });
  rest('ayla', 'no-photos', { name: 'Place with no photos', status: 'to_go' });
  rest('bora', 'bora-r', { name: "Bora's restaurant", status: 'went_to', rating: 7, photos: ['path'] });
  rest('cem', 'cem-r', { name: "Cem's restaurant (private acct)", status: 'went_to', rating: 8 });

  // Shared list Ayla <-> Ece
  const sl = id('shared:ayla-ece');
  ins('public.shared_lists', { id: sl, name: 'Date night ideas 💑', user_a: USERS.ayla.id, user_b: USERS.ece.id, created_at: ts(), updated_at: ts() });
  const sli = (k, by, f) => { const sid = id(`shared-item:${k}`); ins('public.shared_list_items', { id: sid, list_id: sl, added_by: USERS[by].id, name: f.name, address: f.address ?? null, status: f.status ?? 'to_go', rating: f.rating ?? null, price_level: f.price ?? null, notes: f.notes ?? null, created_at: ts(), updated_at: ts() }); return sid; };
  const s1 = sli('mikla', 'ayla', { name: 'Mikla', address: 'Beyoğlu', price: 4, notes: 'Rooftop' });
  sli('balikci', 'ece', { name: 'Balıkçı Sabahattin', status: 'went_to', rating: 8 });
  ins('public.shared_list_item_comments', { id: id('comment:1'), item_id: s1, list_id: sl, user_id: USERS.ece.id, comment: 'Book for Friday?', created_at: ts() });
  ins('public.shared_list_item_comments', { id: id('comment:2'), item_id: s1, list_id: sl, user_id: USERS.ayla.id, comment: 'Yes! 8pm', created_at: ts() });

  // storage.objects rows for every photo file (owner = uploader, like Supabase sets)
  for (const f of files) sql.push(`INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata) VALUES (${q(f.bucket)}, ${q(f.name)}, ${q(f.owner)}, ${q(f.owner)}, '{"mimetype":"image/png"}');`);
  return { sql: sql.join('\n'), files, lists };
}

export function seed(db) {
  const { sql, files } = buildSeed();
  psql(db, ['-1'], `SET search_path = public, extensions;\n${sql}`);
  const dir = path.join(STATE, 'storage-files');
  rmSync(dir, { recursive: true, force: true });
  for (const f of files) {
    const p = path.join(dir, f.bucket, f.name);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, f.data); writeFileSync(p + '.meta', JSON.stringify({ type: 'image/png' }));
  }
  writeFileSync(path.join(STATE, 'users.json'), JSON.stringify(Object.values(USERS).map(({ key, id: uid, email, password, name }) => ({ key, id: uid, email, password, name })), null, 1));
  return { files: files.length };
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(seed(process.argv[2])));
