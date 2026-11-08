// Who is calling, and a database client that acts as them.
//
// The caller is the Afiyeat user who approved the connection on the
// /oauth/consent page; ChatGPT holds an access token issued to it by this
// project's Supabase Auth (OAuth 2.1 server). Each request's token is
// verified here, and the user id comes only from that verified token, never
// from tool input. The database client carries the same token with the
// project's public (publishable/anon) key, so RLS applies exactly as it does
// in the app. No service-role or secret key is read or used.

import { createClient, type SupabaseClient } from "./deps.ts";

export interface AuthConfig {
  supabaseUrl: string;
  /** The project's public key: safe to ship in a web page, grants nothing on its own. */
  publicKey: string;
  /** The Supabase Auth issuer, `https://<ref>.supabase.co/auth/v1`. */
  issuer: string;
  /** Accept only tokens minted for an OAuth client (they carry `client_id`). */
  requireOAuthClient: boolean;
  /** If non-empty, only these OAuth client ids may call. */
  allowedClientIds: string[];
}

export type AuthResult =
  | { ok: true; userId: string; clientId: string | null; client: SupabaseClient }
  | { ok: false; reason: "missing_token" | "invalid_token"; description: string };

function env(name: string): string | undefined {
  const v = Deno.env.get(name);
  return v && v.trim() ? v.trim() : undefined;
}

/**
 * The project's public API key. Newer projects expose publishable keys as
 * JSON in SUPABASE_PUBLISHABLE_KEYS; older ones (including Lovable Cloud
 * today) expose the legacy anon key. Both are public by design.
 */
export function resolvePublicKey(): string {
  const many = env("SUPABASE_PUBLISHABLE_KEYS");
  if (many) {
    try {
      const parsed = JSON.parse(many) as Record<string, string>;
      const key = parsed.default ?? Object.values(parsed)[0];
      if (key) return key;
    } catch {
      // fall through to the single-key forms
    }
  }
  const key = env("SUPABASE_PUBLISHABLE_KEY") ?? env("SUPABASE_ANON_KEY");
  if (!key) throw new Error("No public Supabase key in the environment (SUPABASE_PUBLISHABLE_KEYS or SUPABASE_ANON_KEY).");
  return key;
}

export function loadAuthConfig(): AuthConfig {
  const supabaseUrl = env("SUPABASE_URL");
  if (!supabaseUrl) throw new Error("SUPABASE_URL is not set.");
  const base = supabaseUrl.replace(/\/+$/, "");
  return {
    supabaseUrl: base,
    publicKey: resolvePublicKey(),
    issuer: env("MCP_TOKEN_ISSUER") ?? `${base}/auth/v1`,
    requireOAuthClient: env("MCP_REQUIRE_OAUTH_CLIENT") !== "false",
    allowedClientIds: (env("MCP_ALLOWED_CLIENT_IDS") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]*)\s*$/i.exec(header);
  return match ? match[1] : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function authenticate(req: Request, config: AuthConfig): Promise<AuthResult> {
  const header = req.headers.get("authorization");
  if (!header) {
    return { ok: false, reason: "missing_token", description: "Sign in to Afiyeat to use this connector." };
  }
  const token = bearerToken(req);
  if (!token) {
    return { ok: false, reason: "invalid_token", description: "Malformed bearer token." };
  }

  const client = createClient(config.supabaseUrl, config.publicKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  // Verifies the signature against the project's JWKS (asymmetric keys) or,
  // for legacy HS256 projects, asks Supabase Auth to validate the token.
  // Either way it also rejects expired tokens.
  const { data, error } = await client.auth.getClaims(token);
  if (error || !data?.claims) {
    return { ok: false, reason: "invalid_token", description: "The access token is invalid or has expired." };
  }
  const claims = data.claims as Record<string, unknown>;

  if (typeof claims.iss !== "string" || claims.iss.replace(/\/+$/, "") !== config.issuer.replace(/\/+$/, "")) {
    return { ok: false, reason: "invalid_token", description: "The access token was issued by a different server." };
  }
  if (claims.role !== "authenticated") {
    return { ok: false, reason: "invalid_token", description: "The access token is not for a signed-in user." };
  }
  if (claims.is_anonymous === true) {
    return { ok: false, reason: "invalid_token", description: "Anonymous sessions cannot use this connector." };
  }
  if (typeof claims.sub !== "string" || !UUID.test(claims.sub)) {
    return { ok: false, reason: "invalid_token", description: "The access token has no user." };
  }

  const clientId = typeof claims.client_id === "string" && claims.client_id ? claims.client_id : null;
  if (config.requireOAuthClient && !clientId) {
    return {
      ok: false,
      reason: "invalid_token",
      description: "This endpoint accepts tokens issued through the Afiyeat OAuth connection only.",
    };
  }
  if (config.allowedClientIds.length > 0 && (!clientId || !config.allowedClientIds.includes(clientId))) {
    return { ok: false, reason: "invalid_token", description: "This OAuth client is not allowed to use Afiyeat." };
  }

  return { ok: true, userId: claims.sub, clientId, client };
}
