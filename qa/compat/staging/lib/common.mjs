// Shared pieces for the own-data export / import / compare tools.
import crypto from 'node:crypto';
import readline from 'node:readline';

/**
 * Tables copied, in foreign-key order. `own` is the column that must equal the account's user id for
 * a row to count as the PM's own; `other` lists columns that may hold OTHER people's ids (pseudonymised).
 */
export const TABLES = [
  { t: 'folders', own: 'user_id' },
  { t: 'custom_lists', own: 'user_id' },
  { t: 'custom_list_statuses', own: 'user_id' },
  { t: 'custom_list_types', own: 'user_id' },
  { t: 'custom_list_items', own: 'user_id' },
  { t: 'custom_list_item_images', own: 'user_id', photo: { col: 'image_url', bucket: 'custom-list-images' } },
  { t: 'restaurants', own: 'user_id' },
  { t: 'restaurant_images', own: 'user_id', photo: { col: 'image_url', bucket: 'restaurant-images' } },
  { t: 'shared_lists', member: ['user_a', 'user_b'] },
  { t: 'shared_list_items', byList: 'shared_lists', author: 'added_by' },
  { t: 'shared_list_item_comments', byList: 'shared_lists', author: 'user_id' },
  { t: 'follows', member: ['follower_id', 'following_id'] },
  { t: 'blocked_users', own: 'blocker_id', other: ['blocked_id'] },
];

/** Columns never copied anywhere, even for the PM's own profile. */
export const PROFILE_COLUMNS = ['id', 'user_id', 'username', 'display_name', 'bio', 'created_at', 'updated_at', 'is_private', 'avatar_emoji', 'avatar_color', 'timezone'];

/** Storage location of a stored photo value: a full Supabase storage URL, or a bare object path. */
export function storageLocation(value, defaultBucket) {
  const v = String(value ?? '');
  const m = /\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/([^?#]+)/.exec(v);
  if (m) return { bucket: m[1], path: decodeURIComponent(m[2]), format: 'full-url' };
  if (/^https?:\/\//.test(v)) return { bucket: null, path: null, format: 'external-url' };
  return { bucket: defaultBucket, path: v.replace(/^\/+/, ''), format: 'path' };
}

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
/** Canonical JSON (sorted keys) so a row hashes the same wherever it was read. */
export const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v));

/** Pseudonymous, unlinkable id for another person: HMAC with a salt that is never saved. */
export function pseudonymiser() {
  const salt = crypto.randomBytes(32);
  const map = new Map();
  const fn = (uuid) => {
    if (uuid == null) return uuid;
    if (!map.has(uuid)) {
      const h = crypto.createHmac('sha256', salt).update(String(uuid)).digest('hex');
      map.set(uuid, { id: `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`, n: map.size + 1 });
    }
    return map.get(uuid).id;
  };
  fn.label = (uuid) => `Member ${map.get(uuid)?.n ?? '?'}`;
  fn.all = () => [...map.values()];
  return fn;
}

/** Prompt on the terminal; hidden input for passwords and keys. */
export function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(s); };
    rl.question(question, (a) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(a.trim()); });
  });
}
