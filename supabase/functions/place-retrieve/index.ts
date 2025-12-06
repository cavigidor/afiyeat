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
    const { mapboxId, sessionToken } = await req.json();
    console.log("Retrieving place:", mapboxId);
    
    if (!mapboxId) {
      return new Response(
        JSON.stringify({ error: "mapboxId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const mapboxToken = Deno.env.get("MAPBOX_TOKEN");
    if (!mapboxToken) {
      console.error("MAPBOX_TOKEN not configured");
      throw new Error("MAPBOX_TOKEN not configured");
    }

    // Use Mapbox Search Box API retrieve endpoint to get full details
    const params = new URLSearchParams({
      access_token: mapboxToken,
      session_token: sessionToken || crypto.randomUUID(),
    });

    const retrieveUrl = `https://api.mapbox.com/search/searchbox/v1/retrieve/${encodeURIComponent(mapboxId)}?${params.toString()}`;
    console.log("Retrieve URL:", retrieveUrl.replace(mapboxToken, "***"));
    
    const response = await fetch(retrieveUrl);
    const data = await response.json();

    if (!response.ok) {
      console.error("Retrieve API error:", data);
      throw new Error(data.message || "Retrieve API error");
    }

    const feature = data.features?.[0];
    if (!feature) {
      throw new Error("Place not found");
    }

    console.log("Retrieved place:", feature.properties?.name);

    const result = {
      id: feature.properties?.mapbox_id || mapboxId,
      name: feature.properties?.name || "Unknown",
      address: feature.properties?.full_address || feature.properties?.place_formatted || "",
      latitude: feature.geometry?.coordinates?.[1] || 0,
      longitude: feature.geometry?.coordinates?.[0] || 0,
      category: feature.properties?.poi_category?.[0] || null,
    };

    return new Response(
      JSON.stringify({ result }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Place retrieve error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
