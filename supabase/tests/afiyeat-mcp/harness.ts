// Local stand-in for a Supabase project, for afiyeat-mcp integration tests.
// TEST USE ONLY. Nothing here talks to the real project.
//
//   gateway (Deno, random port)          ← what SUPABASE_URL points at
//     /rest/v1/*                  → PostgREST → local Postgres built from the
//                                   repo's real migrations (setup_db.sh)
//     /auth/v1/.well-known/jwks.json → the test signing keys
//     /auth/v1/user               → validates HS256 tokens (legacy projects)
//     /functions/v1/afiyeat-mcp/* → the edge function under test, with the
//                                   prefix stripped and X-Forwarded-* set the
//                                   way the Supabase gateway does
//
// Requirements: psql on PATH and a Postgres reachable via PGHOST/PGPORT/
// PGUSER with the database from setup_db.sh, and a PostgREST binary at
// $POSTGREST_BIN (default: `postgrest` on PATH).

import { exportJWK, generateKeyPair, SignJWT } from "npm:jose@6.2.15";

export const FUNCTION_SLUG = "afiyeat-mcp";
const HS256_SECRET = "afiyeat-mcp-local-test-hs256-secret-not-for-production";
const KID = "afiyeat-mcp-test-es256";

export interface Harness {
  baseUrl: string;
  functionUrl: string;
  issuer: string;
  db: string;
  mint(claims: TokenClaims, opts?: MintOptions): Promise<string>;
  sql(query: string): Promise<string>;
  createUser(email: string): Promise<string>;
  stop(): Promise<void>;
}

export interface TokenClaims {
  sub: string;
  role?: string;
  client_id?: string | null;
  iss?: string;
  is_anonymous?: boolean;
  expiresInSeconds?: number;
  email?: string;
}

export interface MintOptions {
  alg?: "ES256" | "HS256";
  /** Sign with a different key than the project's (forged token). */
  foreignKey?: boolean;
}

async function freePort(): Promise<number> {
  const l = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (l.addr as Deno.NetAddr).port;
  l.close();
  return port;
}

async function waitFor(url: string, timeoutMs = 30_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < until) {
    try {
      const r = await fetch(url);
      await r.body?.cancel();
      if (r.status < 500) return;
      last = `status ${r.status}`;
    } catch (e) {
      last = (e as Error).message;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out waiting for ${url}: ${last}`);
}

const b64url = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function startHarness(): Promise<Harness> {
  const db = Deno.env.get("TEST_DB") ?? "afiyeat_mcp_test";
  const pgHost = Deno.env.get("PGHOST") ?? "/tmp";
  const pgPort = Deno.env.get("PGPORT") ?? "54329";
  const pgUser = Deno.env.get("PGUSER") ?? "postgres";
  const postgrestBin = Deno.env.get("POSTGREST_BIN") ?? "postgrest";
  const denoBin = Deno.execPath();

  const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
  const foreign = await generateKeyPair("ES256", { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid: KID, alg: "ES256", use: "sig" };
  const octJwk = { kty: "oct", k: b64url(HS256_SECRET), alg: "HS256" };
  const hsKey = new TextEncoder().encode(HS256_SECRET);

  const gatewayPort = await freePort();
  const restPort = await freePort();
  const fnPort = 8000; // Deno.serve()'s default, as the edge function doesn't pick a port.
  const baseUrl = `http://127.0.0.1:${gatewayPort}`;
  const issuer = `${baseUrl}/auth/v1`;

  const mint = async (c: TokenClaims, opts: MintOptions = {}): Promise<string> => {
    const now = Math.floor(Date.now() / 1000);
    const payload: Record<string, unknown> = {
      sub: c.sub,
      role: c.role ?? "authenticated",
      aud: "authenticated",
      email: c.email ?? `${c.sub.slice(0, 8)}@example.test`,
      is_anonymous: c.is_anonymous ?? false,
      session_id: crypto.randomUUID(),
    };
    if (c.client_id !== null) payload.client_id = c.client_id ?? "chatgpt-test-client";
    const jwt = new SignJWT(payload)
      .setIssuer(c.iss ?? issuer)
      .setIssuedAt(now - 5)
      .setExpirationTime(now + (c.expiresInSeconds ?? 3600));
    if (opts.alg === "HS256") return jwt.setProtectedHeader({ alg: "HS256", typ: "JWT" }).sign(hsKey);
    return jwt
      .setProtectedHeader({ alg: "ES256", typ: "JWT", kid: KID })
      .sign(opts.foreignKey ? foreign.privateKey : privateKey);
  };

  const psqlArgs = ["-h", pgHost, "-p", pgPort, "-U", pgUser, "-d", db, "-v", "ON_ERROR_STOP=1", "-qAt"];
  const sql = async (query: string): Promise<string> => {
    const out = await new Deno.Command("psql", { args: [...psqlArgs, "-c", query], stdout: "piped", stderr: "piped" })
      .output();
    if (!out.success) throw new Error(`psql failed: ${new TextDecoder().decode(out.stderr)}`);
    return new TextDecoder().decode(out.stdout).trim();
  };

  const createUser = async (email: string): Promise<string> => {
    const id = crypto.randomUUID();
    await sql(
      `INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ('${id}', '${email}', ` +
        `'{"display_name":"${email.split("@")[0]}"}'::jsonb)`,
    );
    return id;
  };

  // PostgREST, configured like Supabase's (roles, schemas, JWKS).
  const anonKey = await new SignJWT({ role: "anon" })
    .setProtectedHeader({ alg: "ES256", typ: "JWT", kid: KID })
    .setIssuer(issuer)
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(privateKey);
  const pgrstEnv = {
    PGRST_DB_URI: `postgres://authenticator:authenticator@127.0.0.1:${pgPort}/${db}`,
    PGRST_DB_SCHEMAS: "public",
    PGRST_DB_ANON_ROLE: "anon",
    PGRST_DB_EXTRA_SEARCH_PATH: "public,extensions",
    PGRST_JWT_SECRET: JSON.stringify({ keys: [jwk, octJwk] }),
    PGRST_SERVER_HOST: "127.0.0.1",
    PGRST_SERVER_PORT: String(restPort),
    PGRST_DB_CHANNEL_ENABLED: "false",
    PGRST_LOG_LEVEL: "crit",
  };
  const postgrest = new Deno.Command(postgrestBin, { env: pgrstEnv, stdout: "null", stderr: "inherit" }).spawn();

  // The edge function, with the environment the platform injects.
  const fnEnv = {
    SUPABASE_URL: baseUrl,
    SUPABASE_ANON_KEY: anonKey,
    SUPABASE_FUNCTION_SLUG: FUNCTION_SLUG,
    DENO_CERT: Deno.env.get("DENO_CERT") ?? "",
    DENO_DIR: Deno.env.get("DENO_DIR") ?? "",
    NO_COLOR: "1",
  };
  const fnDir = new URL("../../functions/afiyeat-mcp/", import.meta.url);
  const fnLog: string[] = [];
  const edge = new Deno.Command(denoBin, {
    args: ["run", "--allow-net", "--allow-env", "--no-lock", "--node-modules-dir=none", "--no-config", "index.ts"],
    cwd: fnDir,
    env: fnEnv,
    clearEnv: false,
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const pump = async (stream: ReadableStream<Uint8Array>) => {
    for await (const chunk of stream.pipeThrough(new TextDecoderStream())) {
      fnLog.push(chunk);
      if (Deno.env.get("SHOW_FUNCTION_LOGS")) console.error(chunk.trimEnd());
    }
  };
  const pumps = [pump(edge.stdout), pump(edge.stderr)];

  const ac = new AbortController();
  const gateway = Deno.serve(
    { hostname: "127.0.0.1", port: gatewayPort, signal: ac.signal, onListen: () => {} },
    async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/auth/v1/.well-known/jwks.json") {
        return Response.json({ keys: [jwk] });
      }
      if (url.pathname === "/auth/v1/user") {
        // Legacy HS256 projects: supabase-js asks Auth to validate the token.
        const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
        try {
          const { jwtVerify } = await import("npm:jose@6.2.15");
          const { payload } = await jwtVerify(token, hsKey, { algorithms: ["HS256"] });
          return Response.json({ id: payload.sub, aud: "authenticated", role: "authenticated", email: payload.email });
        } catch {
          return Response.json({ code: 403, error_code: "bad_jwt", msg: "invalid JWT" }, { status: 403 });
        }
      }
      if (url.pathname.startsWith("/rest/v1/")) {
        const target = `http://127.0.0.1:${restPort}${url.pathname.slice("/rest/v1".length)}${url.search}`;
        const headers = new Headers(req.headers);
        headers.delete("host");
        return fetch(target, {
          method: req.method,
          headers,
          body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
        });
      }
      if (url.pathname === `/functions/v1/${FUNCTION_SLUG}` || url.pathname.startsWith(`/functions/v1/${FUNCTION_SLUG}/`)) {
        const target = `http://127.0.0.1:${fnPort}${url.pathname.slice("/functions/v1".length)}${url.search}`;
        const headers = new Headers(req.headers);
        headers.delete("host");
        headers.set("x-forwarded-host", url.host);
        headers.set("x-forwarded-proto", "http");
        const res = await fetch(target, {
          method: req.method,
          headers,
          body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
        });
        return new Response(res.body, { status: res.status, headers: res.headers });
      }
      return new Response("not found", { status: 404 });
    },
  );

  try {
    await waitFor(`http://127.0.0.1:${restPort}/`);
    await waitFor(`${baseUrl}/functions/v1/${FUNCTION_SLUG}/oauth-protected-resource`, 120_000);
  } catch (e) {
    console.error(fnLog.join(""));
    throw e;
  }

  return {
    baseUrl,
    functionUrl: `${baseUrl}/functions/v1/${FUNCTION_SLUG}`,
    issuer,
    db,
    mint,
    sql,
    createUser,
    stop: async () => {
      for (const p of [edge, postgrest]) {
        try {
          p.kill("SIGTERM");
        } catch { /* already gone */ }
        await p.status;
      }
      await Promise.allSettled(pumps);
      ac.abort();
      await gateway.finished;
    },
  };
}
