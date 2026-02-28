import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid authentication' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Get all user's restaurants with coordinates
    const { data: restaurants, error: fetchError } = await serviceClient
      .from('restaurants')
      .select('id, latitude, longitude')
      .eq('user_id', user.id)
      .not('latitude', 'is', null)
      .not('longitude', 'is', null);

    if (fetchError) throw fetchError;

    // Get all restaurant IDs that already have images
    const restaurantIds = (restaurants || []).map(r => r.id);
    if (restaurantIds.length === 0) {
      return new Response(
        JSON.stringify({ success: true, generated: 0, message: 'No restaurants with coordinates found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: existingImages } = await serviceClient
      .from('restaurant_images')
      .select('restaurant_id')
      .in('restaurant_id', restaurantIds);

    const restaurantsWithImages = new Set((existingImages || []).map(img => img.restaurant_id));
    const restaurantsNeedingImages = (restaurants || []).filter(r => !restaurantsWithImages.has(r.id));

    if (restaurantsNeedingImages.length === 0) {
      return new Response(
        JSON.stringify({ success: true, generated: 0, message: 'All restaurants already have images' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const mapboxToken = Deno.env.get("MAPBOX_TOKEN");
    if (!mapboxToken) throw new Error("MAPBOX_TOKEN not configured");

    let generated = 0;

    for (const restaurant of restaurantsNeedingImages) {
      try {
        const pin = `pin-l+e74c3c(${restaurant.longitude},${restaurant.latitude})`;
        const mapUrl = `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${pin}/${restaurant.longitude},${restaurant.latitude},15,0/600x400@2x?access_token=${mapboxToken}`;

        const mapResponse = await fetch(mapUrl);
        if (!mapResponse.ok) continue;

        const imageBuffer = new Uint8Array(await (await mapResponse.blob()).arrayBuffer());
        const fileName = `${user.id}/${restaurant.id}/map-preview.png`;

        const { error: uploadError } = await serviceClient.storage
          .from('restaurant-images')
          .upload(fileName, imageBuffer, { contentType: 'image/png', upsert: true });

        if (uploadError) { console.error("Upload error for", restaurant.id, uploadError); continue; }

        const storagePath = `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/restaurant-images/${fileName}`;

        await serviceClient.from('restaurant_images').insert({
          restaurant_id: restaurant.id,
          user_id: user.id,
          image_url: storagePath,
          caption: 'Map Preview',
        });

        generated++;
        console.log(`Generated map image for restaurant ${restaurant.id}`);
      } catch (err) {
        console.error(`Failed for restaurant ${restaurant.id}:`, err);
      }
    }

    return new Response(
      JSON.stringify({ success: true, generated, total: restaurantsNeedingImages.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    console.error("Backfill error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
