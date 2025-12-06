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
    const { query, latitude, longitude } = await req.json();
    console.log("Search query:", query, "Location:", latitude, longitude);
    
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

    // Build search URL with proximity bias for nearby results
    let searchUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${mapboxToken}&types=poi,address&limit=10`;
    
    // Add proximity bias if location is provided - this prioritizes nearby results
    if (latitude && longitude) {
      searchUrl += `&proximity=${longitude},${latitude}`;
    }
    
    // Add fuzzy matching for better results
    searchUrl += `&fuzzyMatch=true`;

    console.log("Mapbox URL:", searchUrl.replace(mapboxToken, "***"));
    const response = await fetch(searchUrl);
    const data = await response.json();

    if (!response.ok || data.message) {
      console.error("Mapbox API error:", data.message || data);
      throw new Error(data.message || "Mapbox API error");
    }

    console.log("Found", data.features?.length || 0, "results");

    const results = (data.features || []).map((feature: any) => ({
      id: feature.id,
      name: feature.text || feature.place_name?.split(",")[0] || "Unknown",
      address: feature.place_name || "",
      latitude: feature.center?.[1] || 0,
      longitude: feature.center?.[0] || 0,
      category: feature.properties?.category || feature.place_type?.[0] || null,
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
