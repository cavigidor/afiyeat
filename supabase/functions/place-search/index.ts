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
    const { query, latitude, longitude, sessionToken } = await req.json();
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

    // Use Mapbox Search Box API for better POI results
    const params = new URLSearchParams({
      q: query,
      access_token: mapboxToken,
      session_token: sessionToken || crypto.randomUUID(),
      types: "poi,address",
      limit: "10",
      language: "en",
      // Filter to food-related categories
      poi_category: "restaurant,cafe,bar,food,food_and_drink,bakery,coffee_shop,fast_food",
    });

    // Add proximity bias if location is provided
    if (latitude && longitude) {
      params.append("proximity", `${longitude},${latitude}`);
    }

    const searchUrl = `https://api.mapbox.com/search/searchbox/v1/suggest?${params.toString()}`;
    console.log("Search Box API URL:", searchUrl.replace(mapboxToken, "***"));
    
    const response = await fetch(searchUrl);
    const data = await response.json();

    if (!response.ok) {
      console.error("Search Box API error:", data);
      throw new Error(data.message || "Search Box API error");
    }

    console.log("Found", data.suggestions?.length || 0, "suggestions");

    // Map suggestions to our result format
    const results = (data.suggestions || []).map((suggestion: any) => ({
      id: suggestion.mapbox_id,
      name: suggestion.name || "Unknown",
      address: suggestion.full_address || suggestion.place_formatted || "",
      // Coordinates come from retrieve call, but we can use feature if available
      latitude: suggestion.feature?.geometry?.coordinates?.[1] || null,
      longitude: suggestion.feature?.geometry?.coordinates?.[0] || null,
      category: suggestion.poi_category?.[0] || suggestion.feature_type || null,
      mapboxId: suggestion.mapbox_id, // Keep for retrieve call
    }));

    return new Response(
      JSON.stringify({ results, sessionToken: sessionToken || crypto.randomUUID() }),
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
