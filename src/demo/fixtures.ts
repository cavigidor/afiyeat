// Demo build only. The starting data of the preview: one signed-in demo account with My Restaurants,
// folders, lists made with the older presets (so compatibility is visible), a shared list with a
// friend, and two other people. No real person or place data: names, addresses and coordinates are
// invented for illustration.
import type { DemoDb, Row } from './backend';

export const DEMO_USER = { id: 'd0000000-0000-4000-8000-000000000001', email: 'demo@afiyeat.example' };
export const FRIEND = 'd0000000-0000-4000-8000-000000000002';
export const OTHER = 'd0000000-0000-4000-8000-000000000003';
export const DEMO_BASE_URL = 'https://demo.afiyeat.invalid';

const U = DEMO_USER.id;
const t = (daysAgo: number) => new Date(Date.UTC(2026, 10, 15) - daysAgo * 86400000).toISOString();
const img = (bucket: string, path: string) => `${DEMO_BASE_URL}/storage/v1/object/public/${bucket}/${path}`;
let n = 0;
const id = (prefix: string) => `${prefix}000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

// Chicago-ish coordinates around a fictional neighbourhood grid.
const at = (dx: number, dy: number) => ({ latitude: 41.8935 + dy * 0.004, longitude: -87.6345 + dx * 0.005 });

function restaurants(): { rows: Row[]; images: Row[]; folders: Row[] } {
  const folders = [
    { id: id('f1'), user_id: U, name: 'Date night', icon: '💕', color: '#E91E63', sort_order: 0, created_at: t(200) },
    { id: id('f1'), user_id: U, name: 'Quick lunch', icon: '🥪', color: '#FF9800', sort_order: 1, created_at: t(190) },
    { id: id('f1'), user_id: U, name: 'Out-of-town guests', icon: '🧳', color: '#3F51B5', sort_order: 2, created_at: t(150) },
  ];
  const spots: [string, string, string, number | null, number | null, string, [number, number], number[]][] = [
    ['Luna Ramen House', 'Japanese', '214 W Grand Ave', 9, 2, 'went_to', [-2, 1], [1]],
    ['Bodega Verde', 'Mexican', '58 E Ohio St', 8, 1, 'went_to', [3, 0], [1]],
    ['The Larder', 'American', '901 N State St', null, 3, 'to_go', [0, 3], [0, 2]],
    ['Pasta Nonna', 'Italian', '330 W Huron St', 9, 3, 'went_to', [-3, -1], [0]],
    ['Kettle & Crumb', 'Bakery', '12 E Walton St', 7, 1, 'went_to', [1, 4], []],
    ['Saffron Table', 'Indian', '440 N Clark St', null, 2, 'to_go', [-1, -2], [2]],
    ['Harbor Oyster Bar', 'Seafood', '77 E Illinois St', 8, 4, 'to_go', [4, -1], [0, 2]],
    ['Pho Corner', 'Vietnamese', '615 N Wells St', 8, 1, 'went_to', [-2, 2], [1]],
    ['Sushi Komorebi', 'Japanese', '120 W Kinzie St', null, 3, 'to_go', [-1, -3], [0]],
    ['Taqueria del Sol', 'Mexican', '1001 N Rush St', 9, 1, 'went_to', [2, 5], [1]],
    ['Brick Oven Co.', 'Pizza', '233 E Erie St', 7, 2, 'went_to', [3, 2], []],
    ['Café Marigold', 'Café', '18 W Superior St', null, 1, 'to_go', [0, 1], []],
  ];
  const rows: Row[] = [];
  const images: Row[] = [];
  spots.forEach(([name, category, address, rating, price, status, [dx, dy], folderIdx], i) => {
    const rid = id('r1');
    rows.push({
      id: rid, user_id: U, name, category, address, ...at(dx, dy), rating, price_level: price, status,
      notes: i % 3 === 0 ? 'Ask for the seasonal special.' : null, folder_id: null,
      folder_ids: folderIdx.map((k) => folders[k].id), place_id: null, apple_place_id: null,
      visited_at: status === 'went_to' ? t(30 + i * 7) : null, created_at: t(120 - i * 6), updated_at: t(120 - i * 6),
    });
    const key = category === 'Japanese' ? 'ramen' : category === 'Mexican' ? 'taco' : category === 'Pizza' ? 'pizza' : category === 'Bakery' ? 'cake' : category === 'Seafood' ? 'sushi' : 'food';
    if (i % 2 === 0) images.push({ id: id('ri'), restaurant_id: rid, user_id: U, image_url: img('restaurant-images', `${U}/${rid}/${key}-${i}.jpg`), caption: null, created_at: t(100) });
  });
  return { rows, images, folders };
}

interface ListSpec {
  name: string; icon: string; color: string; visibility?: string; daysAgo: number;
  config: Partial<Row>;
  statuses: string[];
  types?: { name: string; color: string; icon?: string }[];
  items: { name: string; status: number; types?: number[]; rating?: number | null; price?: number | null; priceManual?: number | null; notes?: string; photo?: string; place?: [number, number, string] }[];
}

function list(spec: ListSpec, db: DemoDb) {
  const lid = id('c1');
  db.custom_lists.push({
    id: lid, user_id: U, name: spec.name, icon: spec.icon, color: spec.color, sort_order: null,
    show_location: false, show_notes: true, show_photos: true, show_price: false, show_rating: true,
    price_mode: 'dollar', rating_mode: 'scale_10', status_todo_label: 'To Do', status_done_label: 'Done',
    visibility: spec.visibility ?? 'profile', discovery_token: id('dt'), created_at: t(spec.daysAgo), updated_at: t(spec.daysAgo),
    ...spec.config,
  });
  const statusIds = spec.statuses.map((name, i) => {
    const sid = id('s1');
    db.custom_list_statuses.push({ id: sid, list_id: lid, user_id: U, name, sort_order: i, created_at: t(spec.daysAgo) });
    return sid;
  });
  const typeIds = (spec.types ?? []).map((ty, i) => {
    const tid = id('t1');
    db.custom_list_types.push({ id: tid, list_id: lid, user_id: U, name: ty.name, color: ty.color, icon: ty.icon ?? null, sort_order: i, created_at: t(spec.daysAgo) });
    return tid;
  });
  spec.items.forEach((it, i) => {
    const iid = id('i1');
    const loc = it.place ? { ...at(it.place[0], it.place[1]), address: it.place[2] } : { latitude: null, longitude: null, address: null };
    const tids = (it.types ?? []).map((k) => typeIds[k]);
    db.custom_list_items.push({
      id: iid, list_id: lid, user_id: U, name: it.name, ...loc, apple_place_id: null,
      status: i % 2 ? 'done' : 'todo', status_id: statusIds[it.status], type_id: tids[0] ?? null, type_ids: tids,
      rating: it.rating ?? null, rating_manual: null, price_level: it.price ?? null, price_manual: it.priceManual ?? null,
      notes: it.notes ?? null, completed_at: null, created_at: t(spec.daysAgo - 1 - i), updated_at: t(spec.daysAgo - 1 - i),
    });
    if (it.photo) db.custom_list_item_images.push({ id: id('p1'), item_id: iid, user_id: U, image_url: img('custom-list-images', `${U}/${iid}/${it.photo}.jpg`), created_at: t(10) });
  });
  return lid;
}

export function demoFixtures(): DemoDb {
  n = 0;
  const db: DemoDb = {
    profiles: [], follows: [], restaurants: [], restaurant_images: [], folders: [],
    custom_lists: [], custom_list_items: [], custom_list_statuses: [], custom_list_types: [], custom_list_item_images: [],
    shared_lists: [], shared_list_items: [], shared_list_item_comments: [], blocked_users: [], user_roles: [],
  };
  db.profiles.push(
    { id: id('pr'), user_id: U, username: 'sam_eats', display_name: 'Sam', avatar_emoji: '🦊', avatar_color: '#FF7043', avatar_url: null, bio: 'Always hungry.', is_private: false, referral_code: 'SAMDEMO', timezone: 'America/Chicago', created_at: t(300), updated_at: t(300) },
    { id: id('pr'), user_id: FRIEND, username: 'alex_tastes', display_name: 'Alex', avatar_emoji: '🐼', avatar_color: '#26A69A', avatar_url: null, bio: null, is_private: false, referral_code: null, timezone: 'America/Chicago', created_at: t(280), updated_at: t(280) },
    { id: id('pr'), user_id: OTHER, username: 'jordan', display_name: 'Jordan', avatar_emoji: '🐨', avatar_color: '#5C6BC0', avatar_url: null, bio: null, is_private: true, referral_code: null, timezone: null, created_at: t(250), updated_at: t(250) },
  );
  db.follows.push(
    { id: id('fo'), follower_id: U, following_id: FRIEND, status: 'accepted', created_at: t(200) },
    { id: id('fo'), follower_id: FRIEND, following_id: U, status: 'accepted', created_at: t(200) },
  );
  const r = restaurants();
  db.restaurants.push(...r.rows);
  db.restaurant_images.push(...r.images);
  db.folders.push(...r.folders);

  // Lists made with the older presets: they must keep looking and working as before.
  list({
    name: 'Wines', icon: '🍷', color: '#7B1F3A', daysAgo: 160,
    config: { show_price: true, price_mode: 'manual', show_rating: true, rating_mode: 'scale_10' },
    statuses: ['Want to Try', 'Tried'],
    types: [{ name: 'Red', color: '#8E2430' }, { name: 'White', color: '#D4B44A' }, { name: 'Sparkling', color: '#9FB7C9' }],
    items: [
      { name: 'Ridge Lytton Springs 2021', status: 1, types: [0], rating: 9, priceManual: 48, photo: 'wine-1', notes: 'Bramble, pepper, long finish.' },
      { name: 'Domaine Weinbach Riesling', status: 1, types: [1], rating: 8, priceManual: 36, photo: 'wine-2' },
      { name: 'Txakoli Ameztoi', status: 0, types: [1, 2], priceManual: 22 },
      { name: 'Barolo Vietti Castiglione', status: 0, types: [0], priceManual: 62, photo: 'wine-3' },
      { name: 'Crémant de Loire', status: 1, types: [2], rating: 7, priceManual: 24 },
      { name: 'Unlabelled orange wine from the market', status: 0 },
    ],
  }, db);
  list({
    name: 'Books', icon: '📚', color: '#455A64', daysAgo: 140,
    config: { show_rating: true, rating_mode: 'stars_5', show_photos: true },
    statuses: ['Want to Read', 'Reading', 'Read'],
    items: [
      { name: 'The Omnivore’s Dilemma', status: 2, rating: 4 },
      { name: 'Salt, Fat, Acid, Heat', status: 1, photo: 'book-1' },
      { name: 'Kitchen Confidential', status: 0 },
    ],
  }, db);
  list({
    name: 'Coffee Shops', icon: '☕', color: '#6D4C41', daysAgo: 90,
    config: { show_location: true, show_price: true, price_mode: 'dollar', show_rating: true, rating_mode: 'scale_10' },
    statuses: ['Want to Go', 'Been There'],
    items: [
      { name: 'Groundwork Coffee Bar', status: 1, rating: 9, price: 2, place: [1, -1, '300 N Dearborn St'], photo: 'coffee-1' },
      { name: 'Little Fern', status: 0, price: 1, place: [-2, 3, '19 W Chestnut St'] },
      { name: 'Ninth Street Roasters', status: 1, rating: 7, price: 2, place: [2, 1, '205 E Grand Ave'] },
    ],
  }, db);
  list({
    name: 'Gift ideas', icon: '🎁', color: '#E91E63', visibility: 'private', daysAgo: 30,
    config: { show_price: true, price_mode: 'manual', show_rating: false, show_photos: false },
    statuses: ['To Do', 'Done'],
    items: [{ name: 'Pour-over kettle for Alex', status: 0, priceManual: 55 }, { name: 'Cookbook stand', status: 1, priceManual: 28 }],
  }, db);

  // Lists as the V2 presets create them (same columns, same seeded statuses and categories).
  const drinkTypes = [
    { name: 'Beer', color: '#C9962B', icon: '🍺' }, { name: 'Wine', color: '#8E2430', icon: '🍷' },
    { name: 'Cocktails', color: '#2E86AB', icon: '🍸' }, { name: 'Spirits', color: '#9A5B2E', icon: '🥃' }, { name: 'Non-alcoholic', color: '#4C9A5B', icon: '🧃' },
  ];
  list({
    name: 'Drinks', icon: '🍸', color: '#7B4FA0', daysAgo: 25,
    config: { show_price: true, price_mode: 'manual', show_rating: true, rating_mode: 'scale_10' },
    statuses: ['Want to Try', 'Tried'], types: drinkTypes,
    items: [
      { name: 'Barolo Ravera 2019', status: 1, types: [1], rating: 9, priceManual: 58, photo: 'wine-ravera', notes: 'Roses and tar. Decant.' },
      { name: 'Paper Plane', status: 1, types: [2], rating: 8, photo: 'cocktail-paper' },
      { name: 'That orange wine from the market', status: 1, types: [1] },
      { name: 'Night Shift Pale Ale', status: 1, types: [0], priceManual: 7 },
      { name: 'Islay 12 Year', status: 1, types: [3], rating: 8, photo: 'cocktail-islay' },
      { name: 'Negroni Sbagliato', status: 0, types: [2] },
      { name: 'Hazy IPA from Ferment & Co.', status: 0, types: [0] },
      { name: 'Yuzu soda', status: 0, types: [4] },
      { name: 'Something sparkling for Saturday', status: 0 },
    ],
  }, db);
  list({
    name: 'Coffee Beans', icon: '🫘', color: '#7A4E2D', daysAgo: 20,
    config: { show_price: true, price_mode: 'manual', show_rating: true, rating_mode: 'scale_10' },
    statuses: ['Want to Try', 'Tried'],
    types: [{ name: 'Light roast', color: '#C99A62' }, { name: 'Medium roast', color: '#9A5B2E' }, { name: 'Dark roast', color: '#4E342E' }],
    items: [
      { name: 'Ethiopia Guji Natural', status: 1, types: [0], rating: 9, priceManual: 22, photo: 'bean-guji', notes: 'Blueberry, jasmine. 1:16 V60.' },
      { name: 'Colombia El Paraíso', status: 1, types: [1], rating: 7, priceManual: 19, photo: 'bean-paraiso' },
      { name: 'House espresso blend', status: 1, types: [2], rating: 6 },
      { name: 'Kenya AA Kiambu', status: 0, types: [0], priceManual: 24 },
    ],
  }, db);
  list({
    name: 'Shops I love', icon: '🛍️', color: '#1F7A80', daysAgo: 15,
    config: { show_location: true, show_price: true, price_mode: 'dollar', show_rating: false },
    statuses: ['Want to Visit', 'Visited'],
    types: [{ name: 'Clothing', color: '#5C6BC0', icon: '👕' }, { name: 'Home', color: '#8D6E63', icon: '🏠' }, { name: 'Books', color: '#455A64', icon: '📚' }, { name: 'Food & drink', color: '#C0763A', icon: '🧺' }, { name: 'Gifts', color: '#D2457A', icon: '🎁' }],
    items: [
      { name: 'Field & Thread', status: 1, types: [0], price: 3, place: [1, 2, '41 E Oak St'], photo: 'store-field' },
      { name: 'Paper Lantern Books', status: 1, types: [2], price: 2, place: [-1, 4, '1012 N State St'] },
      { name: 'Hearth Supply', status: 1, types: [1], price: 3, place: [2, -1, '215 W Ohio St'] },
      { name: 'Larder & Co.', status: 0, types: [3], price: 2, place: [-3, 1, '600 N Wells St'] },
      { name: 'Kiln Studio', status: 0, types: [1, 4], place: [0, -2, '130 E Grand Ave'] },
    ],
  }, db);
  list({
    name: 'Travel', icon: '🌍', color: '#2A5C9A', visibility: 'private', daysAgo: 10,
    config: { show_location: true, show_price: false, show_rating: true, rating_mode: 'stars_5' },
    statuses: ['Planned', 'Visited'],
    types: [{ name: 'Kyoto, Japan', color: '#2A5C9A' }, { name: 'Lisbon, Portugal', color: '#2A5C9A' }, { name: 'Mexico City, Mexico', color: '#2A5C9A' }],
    items: [
      { name: 'Fushimi Inari Shrine', status: 1, types: [0], rating: 5, photo: 'city-kyoto', notes: 'Go at 7am.' },
      { name: 'Nishiki Market', status: 1, types: [0], rating: 4 },
      { name: 'Time Out Market', status: 1, types: [1], rating: 4, photo: 'city-lisbon' },
      { name: 'Belém Tower', status: 0, types: [1] },
      { name: 'Museo Frida Kahlo', status: 0, types: [2] },
      { name: 'Grandma’s village', status: 1 },
    ],
  }, db);

  // A two-person shared list with the friend.
  const sl = id('sl');
  db.shared_lists.push({ id: sl, name: 'Date nights', user_a: U, user_b: FRIEND, created_at: t(60), updated_at: t(60) });
  db.shared_list_items.push(
    { id: id('si'), list_id: sl, added_by: FRIEND, name: 'Rooftop at The Vista', address: '150 E Ontario St', ...at(3, 1), apple_place_id: null, notes: 'Sunset!', price_level: 3, rating: null, status: 'to_go', visited_at: null, created_at: t(50), updated_at: t(50) },
    { id: id('si'), list_id: sl, added_by: U, name: 'Pasta Nonna', address: '330 W Huron St', ...at(-3, -1), apple_place_id: null, notes: null, price_level: 3, rating: 9, status: 'went_to', visited_at: t(20), created_at: t(45), updated_at: t(20) },
  );
  return db;
}
