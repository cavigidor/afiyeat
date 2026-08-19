import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface TicketmasterImage {
  url: string;
  ratio?: string;
  width?: number;
}

interface TicketmasterEvent {
  id: string;
  name: string;
  url: string;
  images?: TicketmasterImage[];
  dates?: {
    start?: { dateTime?: string; localDate?: string; localTime?: string };
    status?: { code?: string };
  };
  classifications?: Array<{
    segment?: { name?: string };
    genre?: { name?: string };
  }>;
  priceRanges?: Array<{ min?: number; max?: number; currency?: string }>;
  _embedded?: {
    venues?: Array<{
      name?: string;
      city?: { name?: string };
      state?: { stateCode?: string };
      address?: { line1?: string };
      location?: { latitude?: string; longitude?: string };
    }>;
  };
}

// Prefers a 16:9 image around 640px wide (good card-thumbnail size) - falls
// back to whatever's first if Ticketmaster didn't tag ratios the way we
// expect, rather than returning nothing.
function pickImage(images: TicketmasterImage[] | undefined): string | null {
  if (!images || images.length === 0) return null;
  const sixteenNine = images.filter((img) => img.ratio === "16_9");
  const pool = sixteenNine.length > 0 ? sixteenNine : images;
  const sorted = [...pool].sort(
    (a, b) => Math.abs((a.width || 0) - 640) - Math.abs((b.width || 0) - 640),
  );
  return sorted[0]?.url || images[0].url;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Same manual-JWT-check pattern as place-search/get-mapbox-token
    // (verify_jwt is off at the gateway level for this function too, so
    // this check is what actually gates access).
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      console.error("Missing or invalid authorization header");
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
    if (authError || !user) {
      console.error("Invalid authentication:", authError?.message);
      return new Response(
        JSON.stringify({ error: "Invalid authentication" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { latitude, longitude, keyword, radiusMiles, startDateTime, endDateTime, category } = await req.json();

    if (typeof latitude !== "number" || typeof longitude !== "number") {
      return new Response(
        JSON.stringify({ error: "latitude and longitude are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const apiKey = Deno.env.get("TICKETMASTER_API_KEY");
    if (!apiKey) {
      console.error("TICKETMASTER_API_KEY not configured");
      throw new Error("TICKETMASTER_API_KEY not configured");
    }

    const params = new URLSearchParams({
      apikey: apiKey,
      latlong: `${latitude},${longitude}`,
      radius: String(radiusMiles || 25),
      unit: "miles",
      sort: "date,asc",
      size: "40",
    });
    if (keyword && typeof keyword === "string" && keyword.trim().length > 0) {
      params.append("keyword", keyword.trim());
    }
    // Ticketmaster wants these as UTC "yyyy-MM-ddTHH:mm:ssZ" - the client
    // sends full ISO strings (Date#toISOString()), which already match
    // that shape once the milliseconds are stripped.
    if (startDateTime && typeof startDateTime === "string") {
      params.append("startDateTime", startDateTime.replace(/\.\d{3}Z$/, "Z"));
    }
    if (endDateTime && typeof endDateTime === "string") {
      params.append("endDateTime", endDateTime.replace(/\.\d{3}Z$/, "Z"));
    }
    // classificationName filters server-side by segment/genre (e.g. "Music",
    // "Sports") - passed through as-is from the category the user picked
    // from results already seen, so it always matches a real Ticketmaster
    // segment name.
    if (category && typeof category === "string" && category.trim().length > 0) {
      params.append("classificationName", category.trim());
    }

    const url = `https://app.ticketmaster.com/discovery/v2/events.json?${params.toString()}`;
    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      console.error("Ticketmaster API error:", data);
      throw new Error(data?.fault?.faultstring || "Ticketmaster API error");
    }

    const rawEvents: TicketmasterEvent[] = data._embedded?.events || [];

    const events = rawEvents.map((event) => {
      const venue = event._embedded?.venues?.[0];
      const priceRange = event.priceRanges?.[0];

      return {
        id: event.id,
        name: event.name,
        url: event.url,
        imageUrl: pickImage(event.images),
        startDateTime: event.dates?.start?.dateTime || null,
        localDate: event.dates?.start?.localDate || null,
        localTime: event.dates?.start?.localTime || null,
        isCancelled: event.dates?.status?.code === "cancelled",
        category: event.classifications?.[0]?.segment?.name || null,
        genre: event.classifications?.[0]?.genre?.name || null,
        venueName: venue?.name || null,
        venueAddress: venue?.address?.line1 || null,
        venueCity: venue?.city?.name || null,
        latitude: venue?.location?.latitude ? parseFloat(venue.location.latitude) : null,
        longitude: venue?.location?.longitude ? parseFloat(venue.location.longitude) : null,
        priceMin: priceRange?.min ?? null,
        priceMax: priceRange?.max ?? null,
        priceCurrency: priceRange?.currency ?? null,
      };
    });

    return new Response(
      JSON.stringify({ events }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    console.error("Event search error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
