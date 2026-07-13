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

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Trust the claims here: the Supabase gateway already verified this JWT's
    // signature before invoking the function (verify_jwt = true for this
    // function in supabase/config.toml).
    const claims = JSON.parse(atob(jwt.split(".")[1]));
    const isServiceRole = claims.role === "service_role";
    const callerUserId: string | undefined = claims.sub;

    const body: SendPushRequest = await req.json();
    if (!body.title || !body.body) {
      return new Response(JSON.stringify({ error: "title and body are required" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Regular authenticated users can only ever send a test push to
    // themselves. Only service-role callers (other backend functions) may
    // target an arbitrary user_id.
    const targetUserId = isServiceRole ? body.user_id : callerUserId;
    if (!targetUserId) {
      return new Response(JSON.stringify({ error: "user_id is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
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
