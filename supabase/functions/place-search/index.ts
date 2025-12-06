import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { query } = await req.json();
    
    if (!query || query.length < 2) {
      return new Response(
        JSON.stringify({ results: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const mapboxToken = Deno.env.get("MAPBOX_TOKEN");
    if (!mapboxToken) {
      throw new Error("MAPBOX_TOKEN not configured");
    }

    // Search for POIs (restaurants, cafes, etc.) using Mapbox Geocoding API
    const searchUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${mapboxToken}&types=poi&limit=5`;
    
    const response = await fetch(searchUrl);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "Mapbox API error");
    }

    const results = data.features.map((feature: any) => ({
      id: feature.id,
      name: feature.text,
      address: feature.place_name,
      latitude: feature.center[1],
      longitude: feature.center[0],
      category: feature.properties?.category || null,
    }));

    return new Response(
      JSON.stringify({ results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Place search error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
