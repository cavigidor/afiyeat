import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { latitude, longitude } = await req.json();

    if (typeof latitude !== "number" || typeof longitude !== "number") {
      return new Response(JSON.stringify({ error: "latitude and longitude (numbers) required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = Deno.env.get("MAPBOX_TOKEN");
    if (!token) {
      return new Response(JSON.stringify({ error: "MAPBOX_TOKEN missing" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url =
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${longitude},${latitude}.json` +
      `?types=region&limit=1&access_token=${token}`;

    const resp = await fetch(url);
    if (!resp.ok) {
      const detail = await resp.text();
      console.error("Mapbox reverse geocode failed:", resp.status, detail);
      return new Response(JSON.stringify({ error: "Geocode failed" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const feature = data?.features?.[0];
    // short_code looks like "US-CA", "US-NY", "US-IL"
    const shortCode: string | null = feature?.properties?.short_code ?? null;
    const regionName: string | null = feature?.text ?? null;

    return new Response(
      JSON.stringify({ shortCode, regionName }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("reverse-geocode-region error:", err);
    return new Response(JSON.stringify({ error: (err as Error)?.message || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
