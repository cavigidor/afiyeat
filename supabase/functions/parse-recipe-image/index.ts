import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Each scan is a paid AI request, so it's limited per signed-in user per
// day (see migration ai_scan_daily_limit) and capped in size.
const DAILY_SCAN_LIMIT = 20;
// Base64 is ~4/3 the size of the file; this allows a photo of about 8 MB,
// matching the app's own check.
const MAX_BASE64_LENGTH = 11_200_000;
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

// One prompt per kind of scan. Only "recipe" exists today; the planned
// "Scan anything" feature adds kinds here rather than a new function, so
// sign-in, limits and the privacy disclosure stay in one place.
const PROMPTS: Record<string, { system: string; user: string }> = {
  recipe: {
    system: `You extract structured recipe data from photos of handwritten or printed recipes, in any language.
Return ONLY a valid JSON object (no markdown, no commentary) matching exactly this shape:
{
  "title": string,
  "description": string,
  "prep_time_minutes": number | null,
  "cook_time_minutes": number | null,
  "servings": number | null,
  "cook_temp": number | null,
  "cook_temp_unit": "F" | "C" | null,
  "difficulty": "easy" | "medium" | "hard" | null,
  "ingredients": string[],
  "instructions": string[],
  "tags": string[]
}
Rules:
- Use empty string "" for unknown text fields, null for unknown numbers, [] for unknown lists.
- Keep the recipe in its original language. Preserve original measurements and ordering.
- Each instruction is a single step (no leading numbers).
- Do not invent data; only extract what is clearly visible.
- If the image does not contain a recipe, return the shape with empty values.`,
    user: "Extract the recipe from this image as JSON.",
  },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const str = (v: unknown, max = 2000): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 100000 ? v : null;
const strList = (v: unknown, maxItems = 100): string[] =>
  Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).slice(0, maxItems).map((x) => str(x)) : [];
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | null =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : null;

// The model's output is untrusted input: keep only the expected fields,
// with the expected types and sensible lengths.
function cleanRecipe(raw: unknown) {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    title: str(r.title, 200),
    description: str(r.description, 2000),
    prep_time_minutes: num(r.prep_time_minutes),
    cook_time_minutes: num(r.cook_time_minutes),
    servings: num(r.servings),
    cook_temp: num(r.cook_temp),
    cook_temp_unit: oneOf(r.cook_temp_unit, ["F", "C"] as const),
    difficulty: oneOf(r.difficulty, ["easy", "medium", "hard"] as const),
    ingredients: strList(r.ingredients),
    instructions: strList(r.instructions),
    tags: strList(r.tags, 20),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // 1. Signed-in users only. The platform's JWT check alone accepts the
    //    app's public anon key, which anyone can read from the website, so
    //    the caller's token is resolved to a real user here.
    const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Please sign in to scan." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: userData, error: userError } = await anonClient.auth.getUser(jwt);
    if (userError || !userData?.user) return json({ error: "Please sign in to scan." }, 401);
    const userId = userData.user.id;

    // 2. Validate the request before spending anything on it.
    const body = await req.json().catch(() => null);
    const imageBase64 = typeof body?.imageBase64 === "string" ? body.imageBase64 : "";
    const mimeType = typeof body?.mimeType === "string" ? body.mimeType.toLowerCase() : "image/jpeg";
    const kind = typeof body?.kind === "string" ? body.kind : "recipe";
    const prompt = PROMPTS[kind];

    if (!prompt) return json({ error: "Unsupported scan type." }, 400);
    if (!imageBase64) return json({ error: "No image received." }, 400);
    if (imageBase64.length > MAX_BASE64_LENGTH) {
      return json({ error: "That photo is too large. Please use one under 8 MB." }, 413);
    }
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return json({ error: "Please use a JPEG, PNG, WebP or HEIC photo." }, 415);
    }

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      console.error("LOVABLE_API_KEY missing");
      return json({ error: "Scanning isn't available right now." }, 503);
    }

    // 3. Count the scan against today's limit (atomic, server-side).
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: allowed, error: limitError } = await admin.rpc("ai_scan_try_consume", {
      p_user_id: userId,
      p_daily_limit: DAILY_SCAN_LIMIT,
    });
    if (limitError) {
      console.error("ai_scan_try_consume failed:", limitError.message);
      return json({ error: "Scanning isn't available right now." }, 503);
    }
    if (!allowed) {
      return json(
        { error: `You've reached today's limit of ${DAILY_SCAN_LIMIT} scans. You can still type the recipe in.` },
        429,
      );
    }

    // 4. Ask the model. The image is sent to Google's Gemini through
    //    Lovable's AI gateway; Afiyeat doesn't store it.
    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: prompt.system },
          {
            role: "user",
            content: [
              { type: "text", text: prompt.user },
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
            ],
          },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!aiResp.ok) {
      // Details stay in the server log; the provider's error text isn't
      // passed back to the app.
      console.error("AI gateway error:", aiResp.status, (await aiResp.text()).slice(0, 500));
      return json({ error: "Couldn't read that photo. Please try again or type the recipe in." }, 502);
    }

    const aiJson = await aiResp.json();
    const content = aiJson?.choices?.[0]?.message?.content ?? "{}";
    let parsed: unknown;
    try {
      parsed = typeof content === "string" ? JSON.parse(content) : content;
    } catch (_e) {
      try {
        parsed = JSON.parse(String(content).replace(/```json|```/g, "").trim());
      } catch (_e2) {
        return json({ error: "Couldn't read that photo. Please try again or type the recipe in." }, 502);
      }
    }

    return json({ recipe: cleanRecipe(parsed) });
  } catch (err) {
    console.error("parse-recipe-image error:", err);
    return json({ error: "Something went wrong while scanning. Please try again." }, 500);
  }
});
