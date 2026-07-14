import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SignJWT, importPKCS8 } from "https://esm.sh/jose@5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// --- APNs config (set these as Supabase Edge Function secrets) ---
// APNS_KEY           full contents of the .p8 private key file
// APNS_KEY_ID        the Key ID shown when you created the key
// APNS_TEAM_ID       your Apple Developer Team ID (A7V4PN4DWK for this project)
// APNS_BUNDLE_ID     app bundle id (com.afiyeat.app)
// APNS_ENV           "sandbox" while testing via Xcode/TestFlight-internal,
//                    "production" once shipped through App Store review
const APNS_KEY_ID = Deno.env.get("APNS_KEY_ID") ?? "";
const APNS_TEAM_ID = Deno.env.get("APNS_TEAM_ID") ?? "";
const APNS_BUNDLE_ID = Deno.env.get("APNS_BUNDLE_ID") ?? "com.afiyeat.app";
const APNS_HOST =
  Deno.env.get("APNS_ENV") === "production"
    ? "https://api.push.apple.com"
    : "https://api.sandbox.push.apple.com";

interface SendPushRequest {
  user_id?: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

// APNs provider tokens are valid up to 1 hour; cache and reuse within
// this warm function instance instead of re-signing on every call.
let cachedApnsJwt: { token: string; issuedAt: number } | null = null;

async function getApnsJwt(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedApnsJwt && now - cachedApnsJwt.issuedAt < 45 * 60) {
    return cachedApnsJwt.token;
  }
  const pkcs8 = Deno.env.get("APNS_KEY")!.replace(/\\n/g, "\n");
  const privateKey = await importPKCS8(pkcs8, "ES256");
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: APNS_KEY_ID })
    .setIssuedAt(now)
    .setIssuer(APNS_TEAM_ID)
    .sign(privateKey);
  cachedApnsJwt = { token, issuedAt: now };
  return token;
}

async function sendToDevice(
  deviceToken: string,
  apnsJwt: string,
  payload: SendPushRequest,
): Promise<{ ok: boolean; status: number; reason?: string }> {
  const res = await fetch(`${APNS_HOST}/3/device/${deviceToken}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${apnsJwt}`,
      "apns-topic": APNS_BUNDLE_ID,
      "apns-push-type": "alert",
      "apns-priority": "10",
    },
    body: JSON.stringify({
      aps: {
        alert: { title: payload.title, body: payload.body },
        sound: "default",
      },
      ...payload.data,
    }),
  });

  if (res.ok) return { ok: true, status: res.status };

  let reason: string | undefined;
  try {
    const body = await res.json();
    reason = body?.reason;
  } catch {
    // ignore parse failure
  }
  return { ok: false, status: res.status, reason };
}

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// This function has `verify_jwt = false` in config.toml, so it does its own
// auth below rather than relying on the API gateway. Two ways in:
//   1. x-internal-secret header matching INTERNAL_PUSH_SECRET - used by
//      notify_user() (a Postgres trigger/cron function) to send a push to
//      *any* user_id. Deliberately a narrow, single-purpose secret rather
//      than the service-role key, so a leak of it can only ever be used to
//      send push notifications, not read/write the whole database.
//   2. A regular Supabase auth JWT - a logged-in user hitting this directly
//      can only ever send a test push to themselves.
async function authorizeRequest(
  req: Request,
): Promise<{ ok: true; targetUserId: string } | { ok: false; status: number; error: string }> {
  const internalSecret = req.headers.get("x-internal-secret");
  const expectedSecret = Deno.env.get("INTERNAL_PUSH_SECRET");
  if (expectedSecret && internalSecret === expectedSecret) {
    const body = await req.json().catch(() => ({}));
    if (!body.user_id) {
      return { ok: false, status: 400, error: "user_id is required" };
    }
    return { ok: true, targetUserId: body.user_id };
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) {
    return { ok: false, status: 401, error: "Missing authorization" };
  }

  const anonClient = createClient(supabaseUrl, supabaseAnonKey);
  const { data, error } = await anonClient.auth.getUser(jwt);
  if (error || !data.user) {
    return { ok: false, status: 401, error: "Invalid authorization" };
  }

  return { ok: true, targetUserId: data.user.id };
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Read the body once for auth (internal-secret path needs user_id from
    // it), then again for the real payload - Request bodies can only be
    // consumed once, so clone before authorizeRequest touches it.
    const bodyForAuth = req.clone();
    const auth = await authorizeRequest(bodyForAuth);
    if (!auth.ok) {
      return new Response(JSON.stringify({ error: auth.error }), {
        status: auth.status,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
    const targetUserId = auth.targetUserId;

    const body: SendPushRequest = await req.json();
    if (!body.title || !body.body) {
      return new Response(JSON.stringify({ error: "title and body are required" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: tokens, error: tokensError } = await supabase
      .from("device_tokens")
      .select("id, token")
      .eq("user_id", targetUserId);

    if (tokensError) {
      console.error("Failed to load device tokens:", tokensError);
      return new Response(JSON.stringify({ error: "Failed to load device tokens" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    if (!tokens || tokens.length === 0) {
      return new Response(JSON.stringify({ success: true, sent: 0, message: "No registered devices" }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const apnsJwt = await getApnsJwt();
    let sent = 0;
    const staleIds: string[] = [];

    for (const row of tokens) {
      const result = await sendToDevice(row.token, apnsJwt, body);
      if (result.ok) {
        sent++;
      } else {
        console.error(`APNs send failed for token ${row.token}:`, result.status, result.reason);
        if (result.reason === "Unregistered" || result.reason === "BadDeviceToken") {
          staleIds.push(row.id);
        }
      }
    }

    if (staleIds.length > 0) {
      await supabase.from("device_tokens").delete().in("id", staleIds);
    }

    return new Response(
      JSON.stringify({ success: true, sent, total: tokens.length, removed_stale: staleIds.length }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  } catch (error) {
    console.error("Error in send-push function:", error);
    return new Response(JSON.stringify({ error: "An unexpected error occurred" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
};

serve(handler);
