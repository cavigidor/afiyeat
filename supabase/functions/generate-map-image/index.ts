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

    const { latitude, longitude, restaurantId } = await req.json();

    if (!latitude || !longitude || !restaurantId) {
      return new Response(
        JSON.stringify({ error: 'latitude, longitude, and restaurantId are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const mapboxToken = Deno.env.get("MAPBOX_TOKEN");
    if (!mapboxToken) {
      throw new Error("MAPBOX_TOKEN not configured");
    }

    // Generate Mapbox Static Image URL with a pin marker
    const pin = `pin-l+e74c3c(${longitude},${latitude})`;
    const mapUrl = `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${pin}/${longitude},${latitude},15,0/600x400@2x?access_token=${mapboxToken}`;

    console.log("Fetching map image for:", { latitude, longitude, restaurantId });

    const mapResponse = await fetch(mapUrl);
    if (!mapResponse.ok) {
      const errorText = await mapResponse.text();
      console.error("Mapbox static image error:", errorText);
      throw new Error(`Failed to fetch map image: ${mapResponse.status}`);
    }

    const imageBlob = await mapResponse.blob();
    const imageBuffer = new Uint8Array(await imageBlob.arrayBuffer());

    // Upload to storage
    const fileName = `${user.id}/${restaurantId}/map-preview.png`;

    // Use service role client for storage upload
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { error: uploadError } = await serviceClient.storage
      .from('restaurant-images')
      .upload(fileName, imageBuffer, {
        contentType: 'image/png',
        upsert: true,
      });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      throw new Error(`Failed to upload map image: ${uploadError.message}`);
    }

    // Insert into restaurant_images table
    const storagePath = `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/restaurant-images/${fileName}`;

    const { error: insertError } = await serviceClient
      .from('restaurant_images')
      .insert({
        restaurant_id: restaurantId,
        user_id: user.id,
        image_url: storagePath,
        caption: 'Map Preview',
      });

    if (insertError) {
      console.error("Insert error:", insertError);
      throw new Error(`Failed to save image record: ${insertError.message}`);
    }

    console.log("Map image generated and saved successfully");

    return new Response(
      JSON.stringify({ success: true, image_url: storagePath }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Generate map image error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
