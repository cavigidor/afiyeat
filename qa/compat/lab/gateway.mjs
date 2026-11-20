// Lab gateway: one local origin that serves an app build AND stands in for
// Supabase's HTTP surface, so the real app runs unmodified against the
// isolated local Postgres. Listens on 127.0.0.1 only; makes no outbound calls.
//
//   /rest/v1/*      -> PostgREST (real), same headers as Supabase's gateway
//   /auth/v1/*      -> minimal GoTrue stand-in: password + refresh grants for
//                      lab test accounts only, /user, /logout
//   /storage/v1/*   -> storage stand-in that writes storage.objects AS THE
//                      SIGNED-IN USER, so the real storage RLS policies decide
//                      every upload, signed URL and delete; files on local disk
//   /functions/v1/* -> 503 (Edge Functions aren't part of the lab)
//   everything else -> the app build (SPA fallback to index.html)
import http from 'node:http';
import crypto from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, rmSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const LAB = path.dirname(new URL(import.meta.url).pathname);
export const STATE = path.join(LAB, '..', 'state');
mkdirSync(STATE, { recursive: true });

export function jwtSecret() {
  const f = path.join(STATE, 'jwt-secret');
  if (!existsSync(f)) writeFileSync(f, crypto.randomBytes(32).toString('hex'));
  return readFileSync(f, 'utf8').trim();
}
const b64u = (b) => Buffer.from(b).toString('base64url');
export function signJwt(payload) {
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify(payload));
  return `${h}.${p}.${crypto.createHmac('sha256', jwtSecret()).update(`${h}.${p}`).digest('base64url')}`;
}
export function verifyJwt(token) {
  const [h, p, s] = String(token || '').split('.');
  if (!s) return null;
  const want = crypto.createHmac('sha256', jwtSecret()).update(`${h}.${p}`).digest('base64url');
  if (want.length !== s.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(s))) return null;
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  if (claims.exp && claims.exp * 1000 < Date.now()) return null;
  return claims;
}
export const anonKey = () => signJwt({ iss: 'afiyeat-compat-lab', role: 'anon', iat: 1700000000, exp: 2100000000 });

const users = () => JSON.parse(readFileSync(path.join(STATE, 'users.json'), 'utf8'));
const userObj = (u) => ({
  id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: '2026-01-01T00:00:00Z',
  phone: '', confirmed_at: '2026-01-01T00:00:00Z', last_sign_in_at: new Date().toISOString(),
  app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [],
  created_at: '2026-01-01T00:00:00Z', updated_at: new Date().toISOString(),
});
const refreshTokens = new Map();
function session(u) {
  const now = Math.floor(Date.now() / 1000);
  const access_token = signJwt({ sub: u.id, role: 'authenticated', aud: 'authenticated', email: u.email, iat: now, exp: now + 3600, session_id: crypto.randomUUID() });
  const refresh_token = crypto.randomBytes(16).toString('hex');
  refreshTokens.set(refresh_token, u.email);
  return { access_token, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token, user: userObj(u) };
}

const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((ok, no) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); req.on('error', no); });
const bearer = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.headers.apikey;

// Minimal multipart: return the first part that has a filename or an empty name (storage-js appends the file under '').
function filePart(body, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) return { data: body, type: contentType };
  const boundary = Buffer.from(`--${m[1] || m[2]}`);
  let start = body.indexOf(boundary);
  while (start >= 0) {
    const next = body.indexOf(boundary, start + boundary.length);
    if (next < 0) break;
    const part = body.subarray(start + boundary.length + 2, next - 2);
    const sep = part.indexOf('\r\n\r\n');
    const head = part.subarray(0, sep).toString();
    if (/name=""|filename=/.test(head)) return { data: part.subarray(sep + 4), type: (/content-type:\s*([^\r\n]+)/i.exec(head) || [])[1] };
    start = next;
  }
  return { data: Buffer.alloc(0), type: null };
}

export function startGateway({ port, appDir, dbName, pgrstPort, label }) {
  const pool = new pg.Pool({ host: '127.0.0.1', port: Number(process.env.LAB_PGPORT ?? 54329), user: 'postgres', database: dbName, max: 4 });
  const filesDir = path.join(STATE, 'storage-files');
  const signSecret = jwtSecret() + ':storage';

  // Run SQL as the request's role with its JWT claims, exactly as PostgREST does, so RLS applies.
  async function asUser(claims, fn) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
      await c.query(`SET LOCAL ROLE ${claims.role === 'authenticated' ? 'authenticated' : claims.role === 'service_role' ? 'service_role' : 'anon'}`);
      const r = await fn(c);
      await c.query('COMMIT');
      return r;
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  }
  const claimsOf = (req) => verifyJwt(bearer(req)) ?? { role: 'anon' };
  const signToken = (bucket, name, exp) => crypto.createHmac('sha256', signSecret).update(`${bucket}/${name}:${exp}`).digest('base64url') + '.' + exp;
  const tokenOk = (bucket, name, token) => { const [s, exp] = String(token || '').split('.'); return exp && Number(exp) * 1000 > Date.now() && signToken(bucket, name, exp) === `${s}.${exp}`; };
  const sendFile = (res, bucket, name) => {
    const f = path.join(filesDir, bucket, name);
    if (!existsSync(f) || !statSync(f).isFile()) return json(res, 404, { statusCode: '404', error: 'not_found', message: 'Object not found' });
    const meta = existsSync(f + '.meta') ? JSON.parse(readFileSync(f + '.meta', 'utf8')) : {};
    res.writeHead(200, { 'content-type': meta.type || 'application/octet-stream' });
    res.end(readFileSync(f));
  };

  async function storage(req, res, rest) {
    const claims = claimsOf(req);
    // Signed download: GET /object/sign/<bucket>/<path>?token=
    let m = /^\/object\/sign\/([^/]+)\/(.+)$/.exec(rest.path);
    if (m && req.method === 'GET') {
      const [bucket, name] = [m[1], decodeURIComponent(m[2])];
      return tokenOk(bucket, name, rest.query.get('token')) ? sendFile(res, bucket, name) : json(res, 400, { statusCode: '400', error: 'InvalidSignature', message: 'invalid signature' });
    }
    // Create signed URL(s): POST /object/sign/<bucket>/<path>  or  /object/sign/<bucket> {paths}
    if (m || (/^\/object\/sign\/([^/]+)$/.test(rest.path) && req.method === 'POST')) {
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      const bucket = m ? m[1] : /^\/object\/sign\/([^/]+)$/.exec(rest.path)[1];
      const names = m ? [decodeURIComponent(m[2])] : body.paths;
      const visible = await asUser(claims, (c) => c.query('SELECT name FROM storage.objects WHERE bucket_id = $1 AND name = ANY($2)', [bucket, names]));
      const ok = new Set(visible.rows.map((r) => r.name));
      const exp = Math.floor(Date.now() / 1000) + Number(body.expiresIn || 60);
      const one = (n) => ok.has(n) ? { path: n, signedURL: `/object/sign/${bucket}/${n}?token=${signToken(bucket, n, exp)}`, error: null } : { path: n, signedURL: null, error: 'Either the requested resource does not exist or you do not have access to it' };
      if (m) { const r = one(names[0]); return r.error ? json(res, 400, { statusCode: '404', error: 'not_found', message: r.error }) : json(res, 200, { signedURL: r.signedURL }); }
      return json(res, 200, names.map(one));
    }
    // Bucket info: GET /bucket/<id> (service_role only), as the storage API answers it
    m = /^\/bucket\/([^/]+)$/.exec(rest.path);
    if (m && req.method === 'GET') {
      if (claims.role !== 'service_role') return json(res, 400, { statusCode: '404', error: 'not_found', message: 'Bucket not found' });
      const b = await pool.query('SELECT id, name, public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = $1', [m[1]]);
      return b.rowCount ? json(res, 200, b.rows[0]) : json(res, 400, { statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' });
    }
    // Public / authenticated download
    m = /^\/object\/(public|authenticated)\/([^/]+)\/(.+)$/.exec(rest.path);
    if (m && req.method === 'GET') {
      const [kind, bucket, name] = [m[1], m[2], decodeURIComponent(m[3])];
      const b = await pool.query('SELECT public FROM storage.buckets WHERE id = $1', [bucket]);
      if (kind === 'public' && !b.rows[0]?.public) return json(res, 400, { statusCode: '404', error: 'not_found', message: 'Bucket not public' });
      if (kind === 'authenticated') { const v = await asUser(claims, (c) => c.query('SELECT 1 FROM storage.objects WHERE bucket_id=$1 AND name=$2', [bucket, name])); if (!v.rowCount) return json(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' }); }
      return sendFile(res, bucket, name);
    }
    // Delete: DELETE /object/<bucket> {prefixes}
    m = /^\/object\/([^/]+)$/.exec(rest.path);
    if (m && req.method === 'DELETE') {
      const { prefixes = [] } = JSON.parse((await readBody(req)).toString() || '{}');
      const del = await asUser(claims, (c) => c.query('DELETE FROM storage.objects WHERE bucket_id = $1 AND name = ANY($2) RETURNING name, id', [m[1], prefixes]));
      for (const r of del.rows) rmSync(path.join(filesDir, m[1], r.name), { force: true });
      return json(res, 200, del.rows.map((r) => ({ name: r.name, id: r.id, bucket_id: m[1] })));
    }
    // Upload: POST/PUT /object/<bucket>/<path>
    m = /^\/object\/([^/]+)\/(.+)$/.exec(rest.path);
    if (m && (req.method === 'POST' || req.method === 'PUT')) {
      const [bucket, name] = [m[1], decodeURIComponent(m[2])];
      const { data, type } = filePart(await readBody(req), req.headers['content-type']);
      const upsert = req.method === 'PUT' || req.headers['x-upsert'] === 'true';
      try {
        const r = await asUser(claims, (c) => c.query(
          `INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata) VALUES ($1, $2, $3::uuid, $5::text, $4)
           ${upsert ? 'ON CONFLICT (bucket_id, name) DO UPDATE SET updated_at = now(), metadata = EXCLUDED.metadata' : ''} RETURNING id`,
          [bucket, name, claims.sub ?? null, { mimetype: type, size: data.length }, claims.sub ?? null]));
        const f = path.join(filesDir, bucket, name);
        mkdirSync(path.dirname(f), { recursive: true });
        writeFileSync(f, data); writeFileSync(f + '.meta', JSON.stringify({ type }));
        return json(res, 200, { Id: r.rows[0].id, Key: `${bucket}/${name}` });
      } catch (e) {
        const rls = /row-level security|permission denied/.test(e.message);
        const dup = /duplicate key/.test(e.message);
        return json(res, dup ? 409 : rls ? 403 : 400, { statusCode: dup ? '409' : rls ? '403' : '400', error: dup ? 'Duplicate' : rls ? 'Unauthorized' : 'Error', message: dup ? 'The resource already exists' : e.message });
      }
    }
    return json(res, 404, { statusCode: '404', error: 'not_found', message: `lab storage: ${req.method} ${rest.path} not supported` });
  }

  async function auth(req, res, rest) {
    if (rest.path === '/token') {
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      const grant = rest.query.get('grant_type');
      if (grant === 'password') {
        const u = users().find((x) => x.email.toLowerCase() === String(body.email || '').toLowerCase());
        if (!u || u.password !== body.password) return json(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', code: 'invalid_credentials', msg: 'Invalid login credentials' });
        return json(res, 200, session(u));
      }
      if (grant === 'refresh_token') {
        const email = refreshTokens.get(body.refresh_token);
        const u = email && users().find((x) => x.email === email);
        if (!u) return json(res, 400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token', code: 'refresh_token_not_found' });
        return json(res, 200, session(u));
      }
      return json(res, 400, { error: 'unsupported_grant_type' });
    }
    if (rest.path === '/user') {
      const c = verifyJwt(bearer(req));
      const u = c?.sub && users().find((x) => x.id === c.sub);
      return u ? json(res, 200, userObj(u)) : json(res, 401, { code: 401, msg: 'invalid JWT' });
    }
    if (rest.path === '/logout') { res.writeHead(204); return res.end(); }
    // Admin create-user (service_role only), used to rehearse the staging importer against the lab.
    // Like GoTrue's POST /admin/users, it accepts a caller-chosen id.
    if (rest.path === '/admin/users' && req.method === 'POST') {
      const c = verifyJwt(bearer(req));
      if (c?.role !== 'service_role') return json(res, 403, { code: 403, msg: 'service_role required' });
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      const id = body.id ?? crypto.randomUUID();
      const all = users();
      const clash = await pool.query('SELECT 1 FROM auth.users WHERE id = $1 OR lower(email) = lower($2)', [id, body.email]);
      if (clash.rowCount || all.some((u) => u.email.toLowerCase() === String(body.email).toLowerCase())) return json(res, 422, { code: 422, msg: 'A user with this email address has already been registered' });
      await pool.query('INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at) VALUES ($1, $2, $3, now())', [id, body.email, body.user_metadata ?? {}]);
      const u = { id, email: body.email, password: body.password, key: `admin-${id.slice(0, 8)}` };
      writeFileSync(path.join(STATE, 'users.json'), JSON.stringify([...all, u], null, 1));
      return json(res, 200, userObj(u));
    }
    if (rest.path === '/settings') return json(res, 200, { external: { email: true }, disable_signup: true, mailer_autoconfirm: true });
    return json(res, 400, { code: 400, msg: `lab auth: ${rest.path} not supported (sign-up, OTP and reset aren't part of the lab)` });
  }

  function proxyRest(req, res, restPath) {
    const headers = { ...req.headers, host: `127.0.0.1:${pgrstPort}` };
    if (!headers.authorization && headers.apikey) headers.authorization = `Bearer ${headers.apikey}`;
    const p = http.request({ host: '127.0.0.1', port: pgrstPort, path: restPath, method: req.method, headers }, (r) => {
      res.writeHead(r.statusCode, r.headers); r.pipe(res);
    });
    p.on('error', (e) => json(res, 502, { message: `PostgREST unreachable: ${e.message}` }));
    req.pipe(p);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      const at = (prefix) => url.pathname.startsWith(prefix) ? { path: url.pathname.slice(prefix.length) || '/', query: url.searchParams } : null;
      let r;
      if ((r = at('/rest/v1'))) return proxyRest(req, res, r.path + url.search);
      if ((r = at('/auth/v1'))) return await auth(req, res, r);
      if ((r = at('/storage/v1'))) return await storage(req, res, r);
      if (at('/functions/v1')) return json(res, 503, { error: 'Edge Functions are not available in the isolated lab' });
      if (at('/realtime/v1')) { res.writeHead(404); return res.end(); }
      // Static app
      let f = path.join(appDir, decodeURIComponent(url.pathname));
      if (!f.startsWith(appDir) || !existsSync(f) || statSync(f).isDirectory()) f = path.join(appDir, 'index.html');
      const ext = path.extname(f);
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
      res.writeHead(200, { 'content-type': types[ext] || 'application/octet-stream' });
      res.end(readFileSync(f));
    } catch (e) { json(res, 500, { message: `lab gateway (${label}): ${e.message}` }); }
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok({ server, pool, close: async () => { server.close(); await pool.end(); } })));
}
