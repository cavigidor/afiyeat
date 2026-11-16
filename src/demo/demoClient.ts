// Demo build only (vite --mode demo): vite.config.ts points "@/integrations/supabase/client" here.
// Same export as the real client, but every request is answered in the browser by demo/backend.ts
// from fixture data kept in this browser's storage. Nothing is sent to Supabase or any server.
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { createDemoFetch, demoUser, type DemoDb } from './backend';
import { demoFixtures, DEMO_BASE_URL, DEMO_USER } from './fixtures';
import { demoImage } from './images';
import { installFakeMapKit } from './fakeMapKit';
import { demoApplePlaces } from './places';

const DB_KEY = 'afiyeat-demo-db-v1';
const UPLOADS_KEY = 'afiyeat-demo-uploads-v1';

function load<T>(key: string, fallback: () => T): T {
  try {
    if (new URLSearchParams(location.search).has('reset')) localStorage.removeItem(key);
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T;
  } catch { /* storage unavailable: start fresh */ }
  return fallback();
}
function save(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* full or unavailable: keep in memory */ }
}

const db: DemoDb = load(DB_KEY, demoFixtures);
save(DB_KEY, db); // so a fresh preview's data is readable (and survives reloads) before the first change
const uploads: Record<string, string> = load(UPLOADS_KEY, () => ({}));

const demoFetch = createDemoFetch({
  baseUrl: DEMO_BASE_URL,
  user: DEMO_USER,
  db,
  latencyMs: 120,
  onChange: (d) => save(DB_KEY, d),
  rpc: {
    get_shared_preview: () => null,
    claim_device_token: () => null,
    get_passport_summary: () => ({ countries: 0, cities: 0, places: 0 }),
  },
  functions: { 'apple-maps': demoApplePlaces },
});

// The session the app finds on launch: the demo user, never expiring.
const storageKey = `sb-${new URL(DEMO_BASE_URL).hostname.split('.')[0]}-auth-token`;
try {
  if (!localStorage.getItem(storageKey)) {
    localStorage.setItem(storageKey, JSON.stringify({
      access_token: 'demo-access-token', token_type: 'bearer', expires_in: 315360000,
      expires_at: Math.floor(Date.now() / 1000) + 315360000, refresh_token: 'demo-refresh-token', user: demoUser(DEMO_USER),
    }));
  }
} catch { /* without storage the app shows the sign-in screen */ }

// Realtime would try to open a socket to the demo host; this one simply never connects.
class NoSocket {
  readyState = 0;
  onopen: unknown = null; onclose: unknown = null; onerror: unknown = null; onmessage: unknown = null;
  constructor(_url: string) {}
  send() {}
  close() {}
}

export const supabase = createClient<Database>(DEMO_BASE_URL, 'demo-anon-key', {
  auth: { storage: localStorage, persistSession: true, autoRefreshToken: false },
  global: { fetch: demoFetch as typeof fetch },
  realtime: { transport: NoSocket as unknown as typeof WebSocket },
});

// Storage: images load through <img src>, which no fetch hook can answer, so signing returns a data
// URL - the uploaded picture itself, or a generated placeholder for fixture paths.
const toDataUrl = (file: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(r.error);
  r.readAsDataURL(file);
});
const objectUrl = (bucket: string, path: string) => `${DEMO_BASE_URL}/storage/v1/object/public/${bucket}/${path}`;
supabase.storage.from = ((bucket: string) => ({
  async upload(path: string, file: Blob) {
    uploads[`${bucket}/${path}`] = await toDataUrl(file);
    save(UPLOADS_KEY, uploads);
    return { data: { id: path, path, fullPath: `${bucket}/${path}` }, error: null };
  },
  async createSignedUrl(path: string) {
    return { data: { signedUrl: uploads[`${bucket}/${path}`] ?? demoImage(path) }, error: null };
  },
  async createSignedUrls(paths: string[]) {
    return { data: paths.map((path) => ({ path, signedUrl: uploads[`${bucket}/${path}`] ?? demoImage(path), error: null })), error: null };
  },
  async remove(paths: string[]) {
    paths.forEach((p) => delete uploads[`${bucket}/${p}`]);
    save(UPLOADS_KEY, uploads);
    return { data: paths.map((name) => ({ name })), error: null };
  },
  getPublicUrl(path: string) { return { data: { publicUrl: objectUrl(bucket, path) } }; },
})) as unknown as typeof supabase.storage.from;

installFakeMapKit();

// A small, always-visible marker so nobody mistakes the preview for the real app.
function ribbon() {
  const el = document.createElement('div');
  el.setAttribute('role', 'note');
  el.style.cssText = 'position:fixed;top:calc(env(safe-area-inset-top,0px) + 2px);left:50%;transform:translateX(-50%);z-index:2147483647;display:flex;gap:6px;align-items:center;font:700 9px/1 system-ui;letter-spacing:.06em;color:#fff;background:#111b;border-radius:999px;padding:3px 3px 3px 8px;pointer-events:auto;';
  el.innerHTML = '<span>DEMO</span>';
  el.title = 'Demo data in this browser only. Nothing is saved online.';
  const reset = document.createElement('button');
  reset.textContent = 'Reset';
  reset.style.cssText = 'font:inherit;letter-spacing:0;color:#111;background:#fff;border:0;border-radius:999px;padding:2px 6px;';
  reset.onclick = () => { try { localStorage.removeItem(DB_KEY); localStorage.removeItem(UPLOADS_KEY); } catch { /* ignore */ } location.reload(); };
  el.appendChild(reset);
  document.body.appendChild(el);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ribbon); else ribbon();
