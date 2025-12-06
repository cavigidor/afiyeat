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
    console.log("Search query received:", query);
    
    if (!query || query.length < 2) {
      return new Response(
        JSON.stringify({ results: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const mapboxToken = Deno.env.get("MAPBOX_TOKEN");
    if (!mapboxToken) {
      console.error("MAPBOX_TOKEN not configured");
      throw new Error("MAPBOX_TOKEN not configured");
    }

    // Search for places using Mapbox Geocoding API - include poi, address, and place types
    const searchUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${mapboxToken}&types=poi,address,place&limit=8`;
    
    console.log("Calling Mapbox API with URL:", searchUrl.replace(mapboxToken, "TOKEN_HIDDEN"));
    const response = await fetch(searchUrl);
    const data = await response.json();
    console.log("Mapbox response:", JSON.stringify(data).substring(0, 500));

    if (!response.ok || data.message) {
      console.error("Mapbox API error:", data.message || data);
      throw new Error(data.message || "Mapbox API error");
    }

    const results = (data.features || []).map((feature: any) => ({
      id: feature.id,
      name: feature.text || feature.place_name?.split(",")[0] || "Unknown",
      address: feature.place_name || "",
      latitude: feature.center?.[1] || 0,
      longitude: feature.center?.[0] || 0,
      category: feature.properties?.category || feature.place_type?.[0] || null,
    }));

    console.log("Returning results:", results.length);
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
