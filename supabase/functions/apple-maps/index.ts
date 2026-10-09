import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Apple Maps for Afiyeat: map tokens, place search and place details.
//
// Apple's terms let us keep a place's Apple Place ID permanently, but its
// name, address, coordinates and category only temporarily. So this
// function is the only thing that talks to Apple, and the only writer of
// public.place_cache, where details live for CACHE_TTL_DAYS before they
// expire and must be fetched again. See migration apple_places_foundation.
//
// Secrets: APPLE_MAPS_KEY_ID, APPLE_MAPS_PRIVATE_KEY (.p8 contents) and
// APNS_TEAM_ID (same Apple developer team as push notifications).
//
// Actions (POST JSON { action, ... }):
//   mapkit-token  -> { token, expiresAt }      short-lived MapKit JS token
//   search        -> { results: PlaceResult[] } signed-in users only
//   resolve       -> { places: Record<id, PlaceDetails>, missing: string[] }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const APPLE_API = "https://maps-api.apple.com";
const CACHE_TTL_DAYS = 7;
// Apple's free quota is 25,000 service calls a day, shared with MapKit JS
// services used in the browser. Stop well short of it so a busy day
// degrades to "details unavailable" rather than a hard Apple 429.
const DAILY_CALL_CAP = 20000;
const RESOLVE_BATCH = 20;
const MAX_RESOLVE_IDS = 200;
// Origins MapKit JS maps may load on: the website, Lovable previews, and
// the iOS app's WebView (capacitor://localhost).
const MAPKIT_ORIGINS =
  "afiyeat.com,*.afiyeat.com,localhost,capacitor://localhost,*.lovable.app,*.lovableproject.com";
const MAPKIT_TOKEN_TTL_SECONDS = 60 * 60;

// Food-related Apple POI categories, for the restaurant search.
const FOOD_CATEGORIES = [
  "Restaurant",
  "Cafe",
  "Bakery",
  "Brewery",
  "Winery",
  "Distillery",
  "FoodMarket",
  "Nightlife",
];

const ID_PATTERN = /^[A-Za-z0-9._-]{4,80}$/;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------
// Signing (ES256 JWTs with the Maps private key)
// ---------------------------------------------------------------------

function base64url(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

let signingKey: CryptoKey | null = null;

async function getSigningKey(): Promise<CryptoKey> {
  if (signingKey) return signingKey;
  const pem = Deno.env.get("APPLE_MAPS_PRIVATE_KEY") ?? "";
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\\n/g, "")
    .replace(/\s+/g, "");
  if (!body) throw new HttpError(503, "Apple Maps isn't configured.");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  signingKey = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  return signingKey;
}

async function signToken(claims: Record<string, unknown>): Promise<string> {
  const keyId = Deno.env.get("APPLE_MAPS_KEY_ID");
  const teamId = Deno.env.get("APNS_TEAM_ID");
  if (!keyId || !teamId) throw new HttpError(503, "Apple Maps isn't configured.");

  const header = { alg: "ES256", kid: keyId, typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: teamId, iat: now, ...claims };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  // WebCrypto's ECDSA output is already the raw r||s form that JWS ES256 uses.
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      await getSigningKey(),
      new TextEncoder().encode(signingInput),
    ),
  );
  return `${signingInput}.${base64url(signature)}`;
}

// ---------------------------------------------------------------------
// Maps Server API access
// ---------------------------------------------------------------------

let accessToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(force = false): Promise<string> {
  if (!force && accessToken && accessToken.expiresAt - Date.now() > 60_000) {
    return accessToken.value;
  }
  const authToken = await signToken({
    exp: Math.floor(Date.now() / 1000) + 600,
    scope: "server_api",
  });
  const resp = await fetch(`${APPLE_API}/v1/token`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  if (!resp.ok) {
    console.error("Apple token exchange failed:", resp.status, (await resp.text()).slice(0, 300));
    throw new HttpError(503, "Apple Maps is unavailable right now.");
  }
  const data = await resp.json();
  accessToken = {
    value: data.accessToken,
    expiresAt: Date.now() + (Number(data.expiresInSeconds) || 1800) * 1000,
  };
  return accessToken.value;
}

async function spendQuota(admin: SupabaseClient, calls: number): Promise<void> {
  const { data, error } = await admin.rpc("apple_maps_try_spend", {
    p_calls: calls,
    p_cap: DAILY_CALL_CAP,
  });
  if (error) {
    console.error("apple_maps_try_spend failed:", error.message);
    throw new HttpError(503, "Apple Maps is unavailable right now.");
  }
  if (!data) throw new HttpError(503, "Place search is busy today. Please try again later.");
}

async function appleGet(admin: SupabaseClient, path: string, params: URLSearchParams) {
  await spendQuota(admin, 1);
  const url = `${APPLE_API}${path}?${params.toString()}`;
  let resp = await fetch(url, { headers: { Authorization: `Bearer ${await getAccessToken()}` } });
  if (resp.status === 401) {
    resp = await fetch(url, { headers: { Authorization: `Bearer ${await getAccessToken(true)}` } });
  }
  if (resp.status === 429) throw new HttpError(503, "Place search is busy today. Please try again later.");
  if (!resp.ok) {
    console.error("Apple Maps error:", path, resp.status, (await resp.text()).slice(0, 300));
    throw new HttpError(502, "Apple Maps is unavailable right now.");
  }
  return await resp.json();
}

// ---------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------

interface PlaceDetails {
  id: string;
  name: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  category: string | null;
  countryCode: string | null;
}

interface ApplePlaceJson {
  id?: unknown;
  name?: unknown;
  formattedAddressLines?: unknown;
  coordinate?: { latitude?: unknown; longitude?: unknown };
  poiCategory?: unknown;
  countryCode?: unknown;
  alternateIds?: unknown;
}

/** The body the app sends; every field is checked before use. */
interface RequestBody {
  action?: unknown;
  query?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  kind?: unknown;
  ids?: unknown;
}

function toDetails(raw: unknown): PlaceDetails | null {
  const p = raw as ApplePlaceJson | null;
  if (!p || typeof p.id !== "string") return null;
  const lines = Array.isArray(p.formattedAddressLines)
    ? p.formattedAddressLines.filter((l): l is string => typeof l === "string")
    : [];
  return {
    id: p.id,
    name: typeof p.name === "string" ? p.name : null,
    address: lines.length ? lines.join(", ") : null,
    latitude: typeof p.coordinate?.latitude === "number" ? p.coordinate.latitude : null,
    longitude: typeof p.coordinate?.longitude === "number" ? p.coordinate.longitude : null,
    category: typeof p.poiCategory === "string" ? p.poiCategory : null,
    countryCode: typeof p.countryCode === "string" ? p.countryCode : null,
  };
}

function fromCacheRow(row: Record<string, unknown>): PlaceDetails {
  return {
    id: String(row.apple_place_id),
    name: (row.name as string) ?? null,
    address: (row.address as string) ?? null,
    latitude: (row.latitude as number) ?? null,
    longitude: (row.longitude as number) ?? null,
    category: (row.category as string) ?? null,
    countryCode: (row.country_code as string) ?? null,
  };
}

// ---------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------

async function requireUser(req: Request): Promise<string> {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) throw new HttpError(401, "Please sign in to search places.");
  const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
  const { data, error } = await anon.auth.getUser(jwt);
  if (error || !data?.user) throw new HttpError(401, "Please sign in to search places.");
  return data.user.id;
}

async function mapkitToken() {
  const exp = Math.floor(Date.now() / 1000) + MAPKIT_TOKEN_TTL_SECONDS;
  const token = await signToken({ exp, scope: "mapkit_js", origin: MAPKIT_ORIGINS });
  return { token, expiresAt: exp * 1000 };
}

async function search(admin: SupabaseClient, body: RequestBody) {
  const query = typeof body?.query === "string" ? body.query.trim() : "";
  if (query.length < 2 || query.length > 120) return { results: [] };

  const params = new URLSearchParams({ q: query, resultTypeFilter: "Poi", lang: "en-US" });
  const lat = Number(body?.latitude);
  const lng = Number(body?.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
    params.set("searchLocation", `${lat},${lng}`);
    params.set("userLocation", `${lat},${lng}`);
  }
  if (body?.kind !== "any") params.set("includePoiCategories", FOOD_CATEGORIES.join(","));

  const data = await appleGet(admin, "/v1/search", params);
  const results = (Array.isArray(data?.results) ? data.results : [])
    .map(toDetails)
    .filter((p: PlaceDetails | null): p is PlaceDetails => !!p && !!p.name)
    .slice(0, 10);
  return { results };
}

async function resolve(admin: SupabaseClient, body: RequestBody) {
  const requested: string[] = Array.from(
    new Set(
      (Array.isArray(body?.ids) ? body.ids : [])
        .filter((id: unknown): id is string => typeof id === "string" && ID_PATTERN.test(id)),
    ),
  ).slice(0, MAX_RESOLVE_IDS) as string[];
  if (requested.length === 0) return { places: {}, missing: [] };

  const places: Record<string, PlaceDetails> = {};

  const { data: cached, error: cacheError } = await admin
    .from("place_cache")
    .select("*")
    .in("apple_place_id", requested)
    .gt("expires_at", new Date().toISOString());
  if (cacheError) console.error("place_cache read failed:", cacheError.message);
  for (const row of cached ?? []) places[row.apple_place_id] = fromCacheRow(row);

  let toFetch = requested.filter((id) => !places[id]);
  if (toFetch.length > 0) {
    // Only look up places someone has actually saved, so this endpoint
    // can't be used to query arbitrary IDs on Afiyeat's quota.
    const { data: referenced, error: refError } = await admin.rpc("apple_place_is_referenced", {
      p_ids: toFetch,
    });
    if (refError) {
      console.error("apple_place_is_referenced failed:", refError.message);
      toFetch = [];
    } else {
      toFetch = (referenced ?? []).map((r: { apple_place_id: string }) => r.apple_place_id);
    }
  }

  const expiresAt = new Date(Date.now() + CACHE_TTL_DAYS * 86400_000).toISOString();
  for (let i = 0; i < toFetch.length; i += RESOLVE_BATCH) {
    const batch = toFetch.slice(i, i + RESOLVE_BATCH);
    let data;
    try {
      data = await appleGet(admin, "/v1/place", new URLSearchParams({ ids: batch.join(","), lang: "en-US" }));
    } catch (err) {
      // Partial results are better than none; the rest stay "missing".
      console.error("Place lookup batch failed:", err instanceof Error ? err.message : err);
      break;
    }
    const rows = [];
    for (const raw of Array.isArray(data?.results) ? data.results : []) {
      const details = toDetails(raw);
      if (!details) continue;
      // A place can come back under a newer ID; map it to whichever
      // requested ID it answers so the caller finds it.
      const altIds = (raw as ApplePlaceJson).alternateIds;
      const alternates = Array.isArray(altIds) ? altIds.filter((x): x is string => typeof x === "string") : [];
      const answers = batch.find((id) => id === details.id || alternates.includes(id)) ?? details.id;
      places[answers] = { ...details, id: answers };
      rows.push({
        apple_place_id: answers,
        name: details.name,
        address: details.address,
        latitude: details.latitude,
        longitude: details.longitude,
        category: details.category,
        country_code: details.countryCode,
        fetched_at: new Date().toISOString(),
        expires_at: expiresAt,
      });
    }
    if (rows.length > 0) {
      const { error } = await admin.from("place_cache").upsert(rows, { onConflict: "apple_place_id" });
      if (error) console.error("place_cache upsert failed:", error.message);
    }
  }

  return { places, missing: requested.filter((id) => !places[id]) };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = ((await req.json().catch(() => null)) ?? {}) as RequestBody;
    const action = typeof body?.action === "string" ? body.action : "";
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    switch (action) {
      case "mapkit-token":
        return json(await mapkitToken());
      case "search":
        await requireUser(req);
        return json(await search(admin, body));
      case "resolve":
        return json(await resolve(admin, body));
      default:
        return json({ error: "Unknown action." }, 400);
    }
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error("apple-maps error:", err);
    return json({ error: "Something went wrong with maps. Please try again." }, 500);
  }
});
